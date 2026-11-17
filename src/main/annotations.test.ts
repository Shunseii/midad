import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import type { Span } from "../shared/annotations";
import type { ExportFile } from "../shared/corpus";
import { type Annotations, createAnnotations } from "./annotations";
import type { CorpusSource } from "./corpus";
import { createLibrary, type Library } from "./library";

// Page 1: matn line 1 is a heading, line 2 has five words, line 3 has three;
// one footnote with four words.
const PAGE_1 = [
  "باب الكلام",
  "",
  "---",
  "## باب الكلام",
  "الكلام هو اللفظ المركب المفيد",
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

class FakeCorpus implements CorpusSource {
  files: ExportFile[] = [page("f1", 1, PAGE_1), page("f2", 2, "header\n\n---\nصفحة ثانية")];
  async getBook(id: string) {
    return { id, title: "t", work: null };
  }
  async exportBook() {
    return structuredClone(this.files);
  }
}

const matn = (line: number, from: number, to: number = from, endLine: number = line): Span => ({
  part: "matn",
  start: { line, word: from },
  end: { line: endLine, word: to },
});

let corpus: FakeCorpus;
let library: Library;
let annotations: Annotations;
let clock = 1000;

beforeEach(async () => {
  clock = 1000;
  corpus = new FakeCorpus();
  const db = new DatabaseSync(":memory:");
  library = createLibrary({ db, corpus, now: () => clock });
  annotations = createAnnotations({ db, now: () => clock });
  await library.importBook({ corpusBookId: "b1" });
});

const onPage = (position = 1) => annotations.listForPage({ bookId: "b1", position });

describe("highlights", () => {
  it("lists a new highlight on its page with the words it covers", async () => {
    await annotations.addHighlight({ bookId: "b1", position: 1, span: matn(2, 4, 5), color: "green" });
    const { highlights } = await onPage();
    expect(highlights).toHaveLength(1);
    expect(highlights[0]).toMatchObject({ color: "green", quote: "المركب المفيد", position: 1, stale: false, author: "me" });
  });

  it("quotes a span that crosses lines", async () => {
    const h = await annotations.addHighlight({ bookId: "b1", position: 1, span: matn(2, 5, 2, 3), color: "yellow" });
    expect(h.quote).toBe("المفيد بالوضع وأقسامه");
  });

  it("addresses ḥāshiya footnotes by their index", async () => {
    const span: Span = { part: "hashiya", start: { line: 1, word: 2 }, end: { line: 1, word: 3 } };
    const h = await annotations.addHighlight({ bookId: "b1", position: 1, span, color: "blue" });
    expect(h.quote).toBe("بالوضع القصد");
  });

  it.each([
    ["a line that doesn't exist", matn(9, 1)],
    ["a word past the end of the line", matn(3, 4)],
    ["word zero", matn(2, 0)],
    ["an end before the start", matn(2, 3, 2)],
  ])("refuses %s", async (_label, span) => {
    await expect(annotations.addHighlight({ bookId: "b1", position: 1, span, color: "yellow" })).rejects.toThrow();
    expect((await onPage()).highlights).toHaveLength(0);
  });

  it("refuses a page that isn't in the library", async () => {
    await expect(annotations.addHighlight({ bookId: "b1", position: 7, span: matn(2, 1), color: "yellow" })).rejects.toThrow(
      /page 7/,
    );
  });

  it("removes a highlight, and refuses an unknown id", async () => {
    const h = await annotations.addHighlight({ bookId: "b1", position: 1, span: matn(2, 1), color: "pink" });
    await annotations.removeHighlight({ id: h.id });
    expect((await onPage()).highlights).toHaveLength(0);
    await expect(annotations.removeHighlight({ id: h.id })).rejects.toThrow(/no highlight/i);
  });

  it("lists only the page's own highlights, in reading order", async () => {
    await annotations.addHighlight({ bookId: "b1", position: 1, span: matn(3, 1), color: "pink" });
    await annotations.addHighlight({ bookId: "b1", position: 1, span: matn(2, 2), color: "yellow" });
    await annotations.addHighlight({ bookId: "b1", position: 2, span: matn(1, 1), color: "blue" });
    expect((await onPage()).highlights.map((h) => h.quote)).toEqual(["هو", "بالوضع"]);
    expect((await onPage(2)).highlights.map((h) => h.quote)).toEqual(["صفحة"]);
  });
});

describe("notes", () => {
  it("adds, edits and deletes a note", async () => {
    const n = await annotations.addNote({ bookId: "b1", position: 1, span: matn(2, 3), body: "lafẓ: utterance", author: "agent" });
    expect((await onPage()).notes[0]).toMatchObject({ body: "lafẓ: utterance", quote: "اللفظ", author: "agent", updatedAt: 1000 });

    clock = 2000;
    await annotations.updateNote({ id: n.id, body: "lafẓ: what the tongue utters" });
    expect((await onPage()).notes[0]).toMatchObject({ body: "lafẓ: what the tongue utters", createdAt: 1000, updatedAt: 2000 });

    await annotations.deleteNote({ id: n.id });
    expect((await onPage()).notes).toHaveLength(0);
  });

  it("refuses an empty body on add and on edit", async () => {
    await expect(annotations.addNote({ bookId: "b1", position: 1, span: matn(2, 1), body: "  " })).rejects.toThrow();
    const n = await annotations.addNote({ bookId: "b1", position: 1, span: matn(2, 1), body: "x" });
    await expect(annotations.updateNote({ id: n.id, body: "" })).rejects.toThrow();
    expect((await onPage()).notes[0]?.body).toBe("x");
  });

  it("refuses to edit or delete an unknown note", async () => {
    await expect(annotations.updateNote({ id: "nope", body: "x" })).rejects.toThrow(/no note/i);
    await expect(annotations.deleteNote({ id: "nope" })).rejects.toThrow(/no note/i);
  });
});

describe("after sync", () => {
  it("follows its page when a new page shifts positions", async () => {
    await annotations.addNote({ bookId: "b1", position: 1, span: matn(2, 1), body: "x" });
    corpus.files.push(page("f0", 0, "header\n\n---\nمقدمة"));
    await library.syncBook({ bookId: "b1", mode: "new" });
    expect((await onPage(1)).notes).toHaveLength(0);
    expect((await onPage(2)).notes[0]).toMatchObject({ position: 2, quote: "الكلام" });
  });

  it("is marked stale when an overwrite changes the words under it, and not otherwise", async () => {
    await annotations.addHighlight({ bookId: "b1", position: 1, span: matn(2, 1), color: "yellow" });
    await annotations.addHighlight({ bookId: "b1", position: 1, span: matn(3, 1), color: "green" });
    corpus.files[0] = page("f1", 1, PAGE_1.replace("الكلام هو", "الكلامُ هو"));
    await library.syncBook({ bookId: "b1", mode: "overwrite", fileIds: ["f1"] });
    const stale = (await onPage()).highlights.map((h) => [h.quote, h.stale]);
    expect(stale).toEqual([
      ["الكلام", true],
      ["بالوضع", false],
    ]);
  });

  it("is marked stale when an overwrite removes the words it covered", async () => {
    await annotations.addHighlight({ bookId: "b1", position: 1, span: matn(3, 3), color: "yellow" });
    corpus.files[0] = page("f1", 1, PAGE_1.replace("بالوضع وأقسامه ثلاثة", "بالوضع"));
    await library.syncBook({ bookId: "b1", mode: "overwrite", fileIds: ["f1"] });
    expect((await onPage()).highlights[0]?.stale).toBe(true);
  });
});
