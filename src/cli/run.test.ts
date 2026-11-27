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

const runIn = async ({ currentBook, argv }: { currentBook?: string; argv: string[] }) => {
  let stdout = "";
  let stderr = "";
  const code = await runCli({ argv, db, stdout: (s) => (stdout += s), stderr: (s) => (stderr += s), ...(currentBook ? { currentBook } : {}) });
  return { code, stdout, stderr };
};

const run = (...argv: string[]) => runIn({ argv });

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

describe("memory", () => {
  const add = (...extra: string[]) =>
    run("memory", "add", "--type", "preference", "--name", "transliterate", "--description", "Always transliterate Arabic terms", "--body", "Write kalām after الكلام.", ...extra);

  it("documents the memory commands in the help", async () => {
    const { stdout } = await run("--help");
    for (const command of ["memory list", "memory search", "memory get", "memory add", "memory update", "memory delete"]) expect(stdout).toContain(command);
  });

  it("prints just the memory help, with an example, for midad memory --help", async () => {
    const { code, stdout } = await run("memory", "add", "--help");
    expect(code).toBe(0);
    expect(stdout).toContain("Example:\n  midad memory add --type preference");
    expect(stdout).not.toContain("midad highlight add");
  });

  it("adds a memory as the agent and gets it in full", async () => {
    const added = await add("--json");
    expect(added.code).toBe(0);
    const memory = JSON.parse(added.stdout) as { id: string; author: string; bookId: string | null };
    expect(memory).toMatchObject({ author: "agent", bookId: null });
    const { stdout } = await run("memory", "get", memory.id);
    expect(stdout).toContain("name: transliterate");
    expect(stdout).toContain("scope: global");
    expect(stdout).toContain("written by: Ask AI");
    expect(stdout).toContain("Write kalām after الكلام.");
  });

  it("refuses a duplicate name and points at the memory to update", async () => {
    await add();
    const again = await add();
    expect(again.code).toBe(1);
    expect(again.stderr).toMatch(/already exists \([0-9a-f]{8}\)\. Update it/);
  });

  it("updates and deletes a memory", async () => {
    const id = (JSON.parse((await add("--json")).stdout) as { id: string }).id;
    expect((await run("memory", "update", id, "--body", "Write kalām (الكلام).")).stdout).toContain(`Updated memory ${id}`);
    expect((await run("memory", "get", id)).stdout).toContain("Write kalām (الكلام).");
    expect((await run("memory", "delete", id)).code).toBe(0);
    const gone = await run("memory", "get", id);
    expect(gone.code).toBe(1);
    expect(gone.stderr).toContain(`There is no memory ${id}`);
  });

  it("searches by any of the words, best match first", async () => {
    await add();
    await run("memory", "add", "--type", "reader", "--name", "level", "--description", "Second-year student of nahw", "--body", "Studies with a teacher.");
    const { stdout } = await run("memory", "search", "how", "to", "write", "terms");
    expect(stdout.split("\n")[0]).toContain("transliterate");
    expect(stdout).not.toContain("level");
    expect((await run("memory", "search", "zzz")).stdout).toBe("No memories match.\n");
    expect((await run("memory", "search")).code).toBe(2);
  });

  it("adds a memory globally unless --book names a book, even in a chat about one", async () => {
    const global = await runIn({ currentBook: "b1", argv: ["memory", "add", "--type", "preference", "--name", "terms", "--description", "Transliterate terms", "--body", "x"] });
    expect(global.stdout).toContain("global)");
    const book = await runIn({ currentBook: "b1", argv: ["memory", "add", "--book", "b1", "--type", "book", "--name", "goal", "--description", "Memorising the definitions for an exam", "--body", "Exam in spring."] });
    expect(book.stdout).toContain("for الآجرومية)");
    const byTitle = await run("memory", "add", "--book", "البلاغة", "--type", "feedback", "--name", "terms", "--description", "Use the author's terms", "--body", "y");
    expect(byTitle.stdout).toContain("for دروس البلاغة)");
    const noBook = await run("memory", "add", "--type", "book", "--name", "g", "--description", "d", "--body", "b");
    expect(noBook.stderr).toContain("needs the book");
  });

  it("lists and searches the chat's book and the global memories, or what --global or --book narrows it to", async () => {
    await run("memory", "add", "--type", "preference", "--name", "terms", "--description", "Transliterate exam terms", "--body", "x");
    await run("memory", "add", "--book", "b1", "--type", "book", "--name", "goal", "--description", "Memorising definitions for an exam", "--body", "y");
    await run("memory", "add", "--book", "b2", "--type", "book", "--name", "goal", "--description", "Reading for the exam examples", "--body", "z");
    const listed = (argv: string[], currentBook?: string) => runIn({ argv, ...(currentBook ? { currentBook } : {}) }).then((r) => r.stdout);

    const inChat = await listed(["memory", "list"], "b1");
    expect(inChat).toContain("[book: الآجرومية]");
    expect(inChat).toContain("[global]");
    expect(inChat).not.toContain("دروس البلاغة");
    expect((await listed(["memory", "list"])).split("\n").filter(Boolean)).toHaveLength(3);
    expect(await listed(["memory", "list", "--global"], "b1")).not.toContain("[book:");
    expect((await listed(["memory", "list", "--book", "b2"], "b1")).split("\n").filter(Boolean)).toEqual([expect.stringContaining("[book: دروس البلاغة]")]);
    expect((await listed(["memory", "list", "--all"], "b1")).split("\n").filter(Boolean)).toHaveLength(3);
    expect((await listed(["memory", "search", "exam", "--global"])).split("\n").filter(Boolean)).toEqual([expect.stringContaining("terms")]);
    expect((await listed(["memory", "search", "exam"], "b2")).split("\n").filter(Boolean)).toHaveLength(2);
    expect((await runIn({ argv: ["memory", "list", "--global", "--book", "b1"] })).code).toBe(2);
  });

  it("moves a memory between a book and global, and labels it edited by its first author", async () => {
    const id = (JSON.parse((await run("memory", "add", "--type", "feedback", "--name", "terms", "--description", "Use the author's terms", "--body", "x", "--json")).stdout) as { id: string }).id;
    expect((await run("memory", "update", id, "--book", "b1")).code).toBe(0);
    expect((await run("memory", "get", id)).stdout).toContain("scope: book b1 (الآجرومية)");
    await run("memory", "update", id, "--global");
    const shown = (await run("memory", "get", id)).stdout;
    expect(shown).toContain("scope: global");
    expect(shown).toContain("written by: Ask AI, edited");
  });

  it("rejects an unknown type", async () => {
    const { code, stderr } = await run("memory", "add", "--type", "note", "--name", "n", "--description", "d", "--body", "b");
    expect(code).toBe(1);
    expect(stderr).toContain("--type is one of reader, preference, feedback, book");
  });

  it("names the missing flags and shows the full form, rather than guessing", async () => {
    const { code, stderr } = await run("memory", "add", "--type", "reader", "--description", "Second-year student", "The reader is a second-year student.");
    expect(code).toBe(1);
    expect(stderr).toContain("Missing --name, --body.");
    expect(stderr).toContain("Use: midad memory add --type <reader|preference|feedback|book> --name <slug>");
  });
});

describe("book remove", () => {
  const books = async () => (await run("books")).stdout;

  it("without --yes, lists what would go with counts, changes nothing and exits non-zero", async () => {
    await run("note", "add", "b1", "1", "--line", "2", "--words", "1-2", "--body", "a note");
    const { code, stdout } = await run("book", "remove", "الآجرومية");
    expect(code).toBe(1);
    expect(stdout).toContain("Would remove الآجرومية (b1): 2 pages · 1 note.");
    expect(stdout).toContain("--yes");
    expect(await books()).toContain("b1");
    expect((await annotations()).notes).toHaveLength(1);
  });

  it("with --yes, removes the book and everything about it, leaving the other", async () => {
    await run("highlight", "add", "b1", "1", "--line", "2", "--words", "1-2");
    const { code, stdout } = await run("book", "remove", "b1", "--yes", "--json");
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ removed: true, bookId: "b1", pages: 2, highlights: 1 });
    expect(await books()).not.toContain("b1");
    expect(await books()).toContain("b2");
    expect((await run("page", "b1", "1")).code).toBe(1);
  });

  it("gives the dry run as JSON too", async () => {
    const { code, stdout } = await run("book", "remove", "b2", "--json");
    expect(code).toBe(1);
    expect(JSON.parse(stdout)).toMatchObject({ removed: false, bookId: "b2", pages: 1, notes: 0 });
  });

  it("refuses inside Ask AI, whatever the flags", async () => {
    const { code, stderr } = await runIn({ currentBook: "b1", argv: ["book", "remove", "b2", "--yes"] });
    expect(code).toBe(1);
    expect(stderr).toContain("Ask AI can't remove books");
    expect(await books()).toContain("b2");
  });

  it("lists it under its own heading in the help, apart from the agent's commands", async () => {
    const { stdout } = await run("--help");
    expect(stdout).toMatch(/Library management \(not for agents\)\n {2}midad book remove <book> \[--yes\]/);
  });
});

describe("book pin and unpin", () => {
  const shelf = async () => (JSON.parse((await run("books", "--json")).stdout) as { bookId: string; pinnedAt: number | null }[]).map((b) => [b.bookId, b.pinnedAt !== null]);

  it("pins a book to the top of the list, and unpins it", async () => {
    const before = await shelf();
    const last = before.at(-1)?.[0];
    const lastTitle = last === "b1" ? "الآجرومية" : "دروس البلاغة";
    expect((await run("book", "pin", String(last))).stdout).toBe(`Pinned ${lastTitle} (${last}).\n`);
    expect((await shelf())[0]).toEqual([last, true]);
    expect((await run("book", "unpin", String(last), "--json")).stdout).toContain('"pinned": false');
    expect(await shelf()).toEqual(before);
  });

  it("refuses inside Ask AI", async () => {
    const { code, stderr } = await runIn({ currentBook: "b1", argv: ["book", "pin", "b2"] });
    expect(code).toBe(1);
    expect(stderr).toContain("Ask AI can't pin books");
    expect((await shelf()).every(([, pinned]) => !pinned)).toBe(true);
  });
});
