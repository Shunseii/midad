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
  files: ExportFile[] = [page("f1", 1, PAGE_1), page("f2", 2, "header\n\n---\nصفحة ثانية"), page("f3", 3, "header\n\n---\n[بيان التوحيد]")];
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

  it("lists nothing, without failing, for a page this device doesn't have", async () => {
    expect(await annotations.listForPage({ bookId: "not-imported", position: 3 })).toEqual({ highlights: [], notes: [], pageNote: null, harakat: [] });
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

describe("line notes", () => {
  it("cover every word of the line, and are listed with the word notes as line notes", async () => {
    await annotations.addNote({ bookId: "b1", position: 1, line: { part: "matn", line: 2 }, body: "the definition" });
    await annotations.addNote({ bookId: "b1", position: 1, span: matn(3, 1), body: "word" });
    const { notes, pageNote } = await onPage();
    expect(notes.map((n) => [n.kind, n.quote])).toEqual([
      ["line", "الكلام هو اللفظ المركب المفيد"],
      ["words", "بالوضع"],
    ]);
    expect(notes[0]?.span).toEqual(matn(2, 1, 5));
    expect(pageNote).toBeNull();
  });

  it("can be on a ḥāshiya footnote", async () => {
    await annotations.addNote({ bookId: "b1", position: 1, line: { part: "hashiya", line: 1 }, body: "x" });
    expect((await onPage()).notes[0]).toMatchObject({ kind: "line", quote: "المراد بالوضع القصد هنا" });
  });

  it("refuse a line with no words", async () => {
    await expect(annotations.addNote({ bookId: "b1", position: 1, line: { part: "matn", line: 9 }, body: "x" })).rejects.toThrow(/no words/);
  });

  it("keep covering the whole line when an overwrite lengthens it", async () => {
    await annotations.addNote({ bookId: "b1", position: 1, line: { part: "matn", line: 3 }, body: "x" });
    corpus.files[0] = page("f1", 1, PAGE_1.replace("بالوضع وأقسامه ثلاثة", "بالوضع وأقسامه ثلاثة أقسام"));
    await library.syncBook({ bookId: "b1", mode: "overwrite", fileIds: ["f1"] });
    expect((await onPage()).notes[0]?.span).toEqual(matn(3, 1, 4));
  });
});

describe("page notes", () => {
  it("are the page's own note, kept apart from the notes on its words", async () => {
    const n = await annotations.addNote({ bookId: "b1", position: 1, page: true, body: "  the chapter's opening  " });
    const { notes, pageNote } = await onPage();
    expect(notes).toHaveLength(0);
    expect(pageNote).toEqual({ id: n.id, bookId: "b1", position: 1, body: "the chapter's opening", author: "me", createdAt: 1000, updatedAt: 1000 });
    expect((await onPage(2)).pageNote).toBeNull();
  });

  it("are one per page", async () => {
    await annotations.addNote({ bookId: "b1", position: 1, page: true, body: "a" });
    await expect(annotations.addNote({ bookId: "b1", position: 1, page: true, body: "b" })).rejects.toThrow(/already has a page note/);
  });

  it("are edited and deleted like other notes", async () => {
    const n = await annotations.addNote({ bookId: "b1", position: 1, page: true, body: "a" });
    clock = 2000;
    await annotations.updateNote({ id: n.id, body: "b" });
    expect((await onPage()).pageNote).toMatchObject({ body: "b", updatedAt: 2000 });
    await annotations.deleteNote({ id: n.id });
    expect((await onPage()).pageNote).toBeNull();
  });

  it("stay on their page through an overwrite that changes every line", async () => {
    await annotations.addNote({ bookId: "b1", position: 1, page: true, body: "a" });
    corpus.files[0] = page("f1", 1, "header\n\n---\nنص جديد كله");
    await library.syncBook({ bookId: "b1", mode: "overwrite", fileIds: ["f1"] });
    expect((await onPage()).pageNote?.body).toBe("a");
  });
});

describe("a library from before line and page notes", () => {
  it("keeps its notes as word notes", async () => {
    const db = new DatabaseSync(":memory:");
    const old = createLibrary({ db, corpus, now: () => 1000 });
    await old.importBook({ corpusBookId: "b1" });
    db.exec(`CREATE TABLE notes (id TEXT PRIMARY KEY, book_id TEXT NOT NULL, file_id TEXT NOT NULL, span TEXT NOT NULL, quote TEXT NOT NULL,
      body TEXT NOT NULL, author TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`);
    db.prepare("INSERT INTO notes VALUES ('n1', 'b1', 'f1', ?, 'اللفظ', 'x', 'me', 1, 1)").run(JSON.stringify(matn(2, 3)));
    const migrated = createAnnotations({ db, now: () => 1000 });
    expect((await migrated.listForPage({ bookId: "b1", position: 1 })).notes[0]).toMatchObject({ id: "n1", kind: "words", quote: "اللفظ" });
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

describe("harakat", () => {
  const FATHA = String.fromCodePoint(0x064e);
  const KASRA = String.fromCodePoint(0x0650);
  const SHADDA = String.fromCodePoint(0x0651);
  // Matn line 2, word 3 is اللفظ: letters ا ل ل ف ظ.
  const at = { bookId: "b1", position: 1, part: "matn" as const, line: 2, word: 3 };

  it("lists marks set on a letter, with the letter they sit on", async () => {
    await annotations.setHarakat({ ...at, letter: 4, marks: FATHA });
    expect((await onPage()).harakat).toEqual([
      expect.objectContaining({ part: "matn", line: 2, word: 3, letter: 4, marks: FATHA, base: "ف", stale: false, author: "me" }),
    ]);
  });

  it("replaces the marks on a letter that already has some", async () => {
    await annotations.setHarakat({ ...at, letter: 3, marks: FATHA });
    await annotations.setHarakat({ ...at, letter: 3, marks: `${KASRA}${SHADDA}`, author: "agent" });
    const { harakat } = await onPage();
    expect(harakat).toHaveLength(1);
    expect(harakat[0]).toMatchObject({ marks: `${SHADDA}${KASRA}`, author: "agent" });
  });

  it.each([
    ["letter zero", { letter: 0, marks: FATHA }, /no letter/],
    ["a letter past the end of the word", { letter: 6, marks: FATHA }, /no letter/],
    ["a word that doesn't exist", { word: 9, letter: 1, marks: FATHA }, /no letter/],
    ["something that isn't a haraka", { letter: 1, marks: "ب" }, /isn't a haraka/],
    ["two vowels", { letter: 1, marks: `${FATHA}${KASRA}` }, /at most one/],
    ["punctuation, naming the word's first Arabic letter", { position: 3, line: 1, word: 1, letter: 1, marks: FATHA }, /"\[" is not an Arabic letter.*letter 2/],
  ])("refuses %s", async (_label, over, message) => {
    await expect(annotations.setHarakat({ ...at, ...over })).rejects.toThrow(message);
    expect((await onPage("position" in over ? over.position : 1)).harakat).toHaveLength(0);
  });

  it("removes a letter's marks, and refuses a letter without any", async () => {
    await annotations.setHarakat({ ...at, letter: 2, marks: FATHA });
    await annotations.removeHarakat({ ...at, letter: 2 });
    expect((await onPage()).harakat).toHaveLength(0);
    await expect(annotations.removeHarakat({ ...at, letter: 2 })).rejects.toThrow(/no harakat/i);
  });

  it("clears every mark inside a span, keeps the rest, and returns what it removed", async () => {
    await annotations.setHarakat({ ...at, letter: 2, marks: FATHA });
    await annotations.setHarakat({ ...at, letter: 4, marks: KASRA, author: "agent" });
    await annotations.setHarakat({ ...at, word: 1, letter: 2, marks: FATHA });
    const span = { part: "matn" as const, start: { line: 2, word: 2 }, end: { line: 2, word: 3 } };
    const removed = await annotations.clearHarakat({ bookId: "b1", position: 1, span });
    expect(removed).toEqual([
      { ref: { part: "matn", line: 2, word: 3, letter: 2 }, marks: FATHA },
      { ref: { part: "matn", line: 2, word: 3, letter: 4 }, marks: KASRA },
    ]);
    expect((await onPage()).harakat).toEqual([expect.objectContaining({ line: 2, word: 1, letter: 2 })]);
  });

  it("clears nothing, without failing, when the span has no marks", async () => {
    const span = { part: "matn" as const, start: { line: 2, word: 1 }, end: { line: 2, word: 3 } };
    expect(await annotations.clearHarakat({ bookId: "b1", position: 1, span })).toEqual([]);
  });

  it("stays fresh when an overwrite only adds corpus harakat, and goes stale when the letter changes", async () => {
    await annotations.setHarakat({ ...at, letter: 4, marks: FATHA });
    await annotations.setHarakat({ ...at, word: 1, letter: 2, marks: FATHA });
    corpus.files[0] = page("f1", 1, PAGE_1.replace("الكلام هو اللفظ", `الكتاب هو اللف${KASRA}ظ`));
    await library.syncBook({ bookId: "b1", mode: "overwrite", fileIds: ["f1"] });
    const byWord = Object.fromEntries((await onPage()).harakat.map((h) => [h.word, h.stale]));
    expect(byWord).toEqual({ 1: false, 3: false });
    corpus.files[0] = page("f1", 1, PAGE_1.replace("اللفظ", "اللقظ"));
    await library.syncBook({ bookId: "b1", mode: "overwrite", fileIds: ["f1"] });
    expect((await onPage()).harakat.find((h) => h.word === 3)?.stale).toBe(true);
  });
});

describe("book marks", () => {
  it("lists the pages with highlights, in the newest highlight's colour, and the pages with notes", async () => {
    await annotations.addHighlight({ bookId: "b1", position: 1, span: matn(2, 1), color: "green" });
    clock = 2000;
    await annotations.addHighlight({ bookId: "b1", position: 1, span: matn(2, 3), color: "pink" });
    await annotations.addHighlight({ bookId: "b1", position: 3, span: matn(1, 1), color: "blue" });
    await annotations.addNote({ bookId: "b1", position: 2, span: matn(1, 1), body: "a" });
    await annotations.addNote({ bookId: "b1", position: 2, span: matn(1, 2), body: "b" });
    expect(await annotations.bookMarks({ bookId: "b1" })).toEqual({
      highlights: [{ position: 1, color: "pink" }, { position: 3, color: "blue" }],
      notes: [2],
      pageNotes: [],
    });
  });

  it("lists pages with a page note among the noted pages, and on their own", async () => {
    await annotations.addNote({ bookId: "b1", position: 3, page: true, body: "summary" });
    await annotations.addNote({ bookId: "b1", position: 2, line: { part: "matn", line: 1 }, body: "line" });
    expect(await annotations.bookMarks({ bookId: "b1" })).toMatchObject({ notes: [2, 3], pageNotes: [3] });
  });

  it("is empty for a book without any", async () => {
    expect(await annotations.bookMarks({ bookId: "b1" })).toEqual({ highlights: [], notes: [], pageNotes: [] });
  });
});
