import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import type { ExportFile } from "../shared/corpus";
import { createAnnotations } from "../main/annotations";
import type { CorpusSource } from "../main/corpus";
import { createLibrary } from "../main/library";
import { runCli } from "./run";

// Page 1: matn line 1 is a heading, line 2 has five words (word 4 carries an
// interlinear gloss), line 3 has three; one footnote with four words.
const PAGE_1 = [
  "باب الكلام",
  "",
  "---",
  "## باب الكلام",
  "الكلام هو اللفظ <ruby>المركب<rt>من كلمتين فأكثر</rt></ruby> المفيد",
  "بالوضع وأقسامه ثلاثة",
  "---",
  "### الحاشية",
  "(١) المراد بالوضع القصد هنا",
].join("\n");

const page = (fileId: string, pageNumber: number, text: string): ExportFile => ({
  file_id: fileId,
  page_number: pageNumber,
  role: null,
  order_hint: null,
  state: "done",
  text,
});

const corpus: CorpusSource = {
  getBook: async (id) => ({ id, title: id === "b1" ? "الآجرومية" : "دروس البلاغة", work: null }),
  exportBook: async (id) => (id === "b1" ? [page("f1", 1, PAGE_1), page("f2", 2, "h\n\n---\nصفحة ثانية")] : [page("g1", 1, "h\n\n---\nبلاغة")]),
};

let db: DatabaseSync;

beforeEach(async () => {
  db = new DatabaseSync(":memory:");
  const library = createLibrary({ db, corpus });
  await library.importBook({ corpusBookId: "b1" });
  await library.importBook({ corpusBookId: "b2" });
});

const run = async (...argv: string[]) => {
  let stdout = "";
  let stderr = "";
  const code = await runCli({ argv, db, stdout: (s) => (stdout += s), stderr: (s) => (stderr += s) });
  return { code, stdout, stderr };
};

const annotations = () => createAnnotations({ db }).listForPage({ bookId: "b1", position: 1 });

describe("reading", () => {
  it("lists the books in the library with their page counts", async () => {
    const { code, stdout } = await run("books");
    expect(code).toBe(0);
    expect(stdout).toContain("الآجرومية");
    expect(stdout).toContain("دروس البلاغة");
    expect(stdout).toMatch(/2 pages/);
  });

  it("prints a page as numbered matn lines and ḥāshiya footnotes", async () => {
    const { code, stdout } = await run("page", "b1", "1");
    expect(code).toBe(0);
    expect(stdout).toMatch(/^2\s+الكلام هو اللفظ المركب المفيد$/m);
    expect(stdout).toMatch(/^3\s+بالوضع وأقسامه ثلاثة$/m);
    expect(stdout).toMatch(/^ḥ1\s+.*المراد بالوضع القصد هنا$/m);
  });

  it("numbers the words when asked", async () => {
    const { stdout } = await run("page", "b1", "1", "--words");
    expect(stdout).toMatch(/^3\s+1:بالوضع 2:وأقسامه 3:ثلاثة$/m);
  });

  it("prints each interlinear gloss under its line without any tags, keeping the line's word numbers", async () => {
    const { stdout } = await run("page", "b1", "1", "--words");
    expect(stdout).toMatch(/^2\s+1:الكلام 2:هو 3:اللفظ 4:المركب 5:المفيد\n\s+gloss on word 4: المركب \(gloss: من كلمتين فأكثر\)$/m);
    expect(stdout).not.toMatch(/<|rt>|ruby/);
    expect((await run("lines", "b1", "1", "--line", "2")).stdout).toContain("(gloss: من كلمتين فأكثر)");
  });

  it("prints only the lines asked for", async () => {
    const { stdout } = await run("lines", "b1", "1", "--line", "3");
    expect(stdout).toContain("بالوضع");
    expect(stdout).not.toContain("المفيد");
  });

  it("finds a book by part of its title or the start of its id", async () => {
    expect((await run("page", "البلاغة", "1")).stdout).toContain("بلاغة");
    expect((await run("page", "b2", "1")).stdout).toContain("بلاغة");
  });

  it("gives JSON with --json", async () => {
    const { stdout } = await run("page", "b1", "1", "--json");
    const parsed = JSON.parse(stdout) as { position: number; matn: { line: number; text: string }[] };
    expect(parsed.position).toBe(1);
    expect(parsed.matn.find((l) => l.line === 3)?.text).toBe("بالوضع وأقسامه ثلاثة");
  });
});

describe("writing", () => {
  it("adds a highlight as the agent and prints its id", async () => {
    const { code, stdout } = await run("highlight", "add", "b1", "1", "--line", "2", "--words", "4-5", "--color", "green", "--json");
    expect(code).toBe(0);
    const { highlights } = await annotations();
    expect(highlights[0]).toMatchObject({ quote: "المركب المفيد", color: "green", author: "agent" });
    expect(JSON.parse(stdout)).toMatchObject({ id: highlights[0]?.id });
  });

  it("names a span across lines with --from and --to", async () => {
    await run("highlight", "add", "b1", "1", "--from", "2:5", "--to", "3:1");
    expect((await annotations()).highlights[0]?.quote).toBe("المفيد بالوضع");
  });

  it("addresses the ḥāshiya with --hashiya", async () => {
    await run("note", "add", "b1", "1", "--hashiya", "--line", "1", "--words", "2", "--body", "wad': convention");
    expect((await annotations()).notes[0]).toMatchObject({ quote: "بالوضع", span: { part: "hashiya" }, author: "agent" });
  });

  it("adds, edits and deletes a note", async () => {
    const added = JSON.parse((await run("note", "add", "b1", "1", "--line", "2", "--words", "3", "--body", "utterance", "--json")).stdout) as { id: string };
    await run("note", "update", added.id, "--body", "what the tongue utters");
    expect((await annotations()).notes[0]?.body).toBe("what the tongue utters");
    await run("note", "delete", added.id);
    expect((await annotations()).notes).toHaveLength(0);
  });

  it("sets harakat by name and removes them", async () => {
    const { code } = await run("harakat", "set", "b1", "1", "--line", "2", "--word", "3", "--letter", "3", "--marks", "kasra+shadda");
    expect(code).toBe(0);
    expect((await annotations()).harakat[0]).toMatchObject({ letter: 3, marks: "ِّ", author: "agent" });
    await run("harakat", "remove", "b1", "1", "--line", "2", "--word", "3", "--letter", "3");
    expect((await annotations()).harakat).toHaveLength(0);
  });

  it("clears every added mark inside a span", async () => {
    await run("harakat", "set", "b1", "1", "--line", "2", "--word", "3", "--letter", "3", "--marks", "kasra");
    await run("harakat", "set", "b1", "1", "--line", "2", "--word", "1", "--letter", "2", "--marks", "fatha");
    const { code, stdout } = await run("harakat", "clear", "b1", "1", "--line", "2", "--words", "2-3");
    expect(code).toBe(0);
    expect(stdout).toContain("1 letter");
    expect((await annotations()).harakat).toEqual([expect.objectContaining({ word: 1, letter: 2 })]);
  });

  it("lists a page's annotations with their ids", async () => {
    await run("highlight", "add", "b1", "1", "--line", "2", "--words", "1");
    const { highlights } = await annotations();
    const { stdout } = await run("annotations", "b1", "1");
    expect(stdout).toContain(highlights[0]?.id);
    expect(stdout).toContain("الكلام");
  });
});

describe("refusals", () => {
  it.each([
    ["an unknown book", ["page", "nope", "1"], /No book matches "nope"/],
    ["an ambiguous book", ["page", "b", "1"], /matches 2 books/],
    ["a page that doesn't exist", ["page", "b1", "9"], /no page 9/],
    ["a span that doesn't fit", ["highlight", "add", "b1", "1", "--line", "3", "--words", "4"], /has 3 words/],
    ["a missing span", ["highlight", "add", "b1", "1"], /--line/],
    ["an unknown haraka", ["harakat", "set", "b1", "1", "--line", "2", "--word", "1", "--letter", "1", "--marks", "zamma"], /zamma/],
  ])("explains %s on stderr and exits 1", async (_label, argv, message) => {
    const { code, stderr } = await run(...argv);
    expect(code).toBe(1);
    expect(stderr).toMatch(message);
    expect((await annotations()).highlights).toHaveLength(0);
  });

  it("prints usage and exits 2 for an unknown command", async () => {
    const { code, stderr } = await run("frobnicate");
    expect(code).toBe(2);
    expect(stderr).toMatch(/Usage/);
  });
});
