import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import type { CorpusSource, ExportProgress } from "./corpus";
import { createLibrary, type Library } from "./library";
import { parsePage } from "../shared/page";
import type { ExportFile } from "../shared/corpus";

const file = (over: Partial<ExportFile> & { file_id: string }): ExportFile => ({
  page_number: null,
  role: null,
  order_hint: null,
  state: "done",
  text: `صفحة ${over.file_id}`,
  ...over,
});

class FakeCorpus implements CorpusSource {
  files: ExportFile[] = [];
  calls = 0;
  reachable = true;
  book = { id: "b1", title: "نسخة القاهرة", work: { name: "متن الآجرومية", author: "ابن آجروم" } };

  async getBook(id: string) {
    this.guard();
    return { ...this.book, id };
  }

  async exportBook(_id: string, { onProgress }: { onProgress?: (progress: ExportProgress) => void } = {}) {
    this.guard();
    for (let done = 1; done <= this.files.length; done += 2) onProgress?.({ done, total: this.files.length });
    return structuredClone(this.files);
  }

  private guard() {
    this.calls += 1;
    if (!this.reachable) throw new Error("corpus unreachable");
  }
}

let corpus: FakeCorpus;
let library: Library;
let db: DatabaseSync;

beforeEach(() => {
  corpus = new FakeCorpus();
  db = new DatabaseSync(":memory:");
  library = createLibrary({ db, corpus, now: () => 1000 });
});

const numbers = async (bookId = "b1") =>
  (await library.getBook(bookId))?.pages.map((p) => p.number);

describe("import", () => {
  it("reports download progress, then saving, before the pages are stored", async () => {
    corpus.files = [1, 2, 3].map((n) => file({ file_id: `f${n}`, page_number: n }));
    const seen: { progress: unknown; stored: number }[] = [];
    await library.importBook({
      corpusBookId: "b1",
      onProgress: (progress) => {
        seen.push({ progress, stored: (db.prepare("SELECT COUNT(*) AS n FROM pages").get() as { n: number }).n });
      },
    });
    expect(seen).toEqual([
      { progress: { phase: "downloading", done: 1, total: 3 }, stored: 0 },
      { progress: { phase: "downloading", done: 3, total: 3 }, stored: 0 },
      { progress: { phase: "saving" }, stored: 0 },
    ]);
    expect(await numbers()).toEqual([1, 2, 3]);
  });

  it("stores a page the corpus finished with no text as a blank page, not as pending", async () => {
    corpus.files = [
      file({ file_id: "f1", page_number: 1 }),
      file({ file_id: "f2", page_number: 2, state: "done", text: "" }),
      file({ file_id: "f3", page_number: 3, state: "queued", text: "" }),
    ];
    const result = await library.importBook({ corpusBookId: "b1" });
    expect(result).toEqual({ bookId: "b1", imported: 2, pending: 1 });
    expect(await numbers()).toEqual([1, 2]);
    expect(await library.previewSync({ bookId: "b1" })).toMatchObject({ newPages: [], changedPages: [], pending: 1 });
  });

  it("offers a blank finished page that an older import skipped as new on sync", async () => {
    corpus.files = [file({ file_id: "f1", page_number: 1 })];
    await library.importBook({ corpusBookId: "b1" });
    corpus.files.push(file({ file_id: "f2", page_number: 2, state: "done", text: "" }));
    expect(await library.previewSync({ bookId: "b1" })).toMatchObject({ newPages: [{ fileId: "f2", number: 2 }], pending: 0 });
  });

  it("stores pages that have text and counts the rest as pending", async () => {
    corpus.files = [
      file({ file_id: "f1", page_number: 1 }),
      file({ file_id: "f2", page_number: 2, state: "processing", text: null }),
      file({ file_id: "f3", page_number: 3 }),
    ];
    const result = await library.importBook({ corpusBookId: "b1" });
    expect(result).toEqual({ bookId: "b1", imported: 2, pending: 1 });
    expect(await numbers()).toEqual([1, 3]);
  });

  it("orders pages by page number, then order hint, unnumbered last", async () => {
    corpus.files = [
      file({ file_id: "u", page_number: null, order_hint: 1 }),
      file({ file_id: "p2b", page_number: 2, order_hint: 2 }),
      file({ file_id: "p1", page_number: 1 }),
      file({ file_id: "p2a", page_number: 2, order_hint: 1 }),
    ];
    await library.importBook({ corpusBookId: "b1" });
    const book = await library.getBook("b1");
    expect(book?.pages.map((p) => p.fileId)).toEqual(["p1", "p2a", "p2b", "u"]);
    expect(book?.pages.map((p) => p.position)).toEqual([1, 2, 3, 4]);
  });

  it("reads the matn without glosses and returns each gloss beside it", async () => {
    const source = "الباب ٣\n\n---\n\n<ruby>الكلام<rt>شرح</rt></ruby> هو اللفظ(١).\n\n---\n\n### الحاشية\n(١) أي القصد.";
    corpus.files = [file({ file_id: "f1", page_number: 3, text: source })];
    await library.importBook({ corpusBookId: "b1" });
    const page = await library.getPage({ bookId: "b1", position: 1 });
    expect(page?.page).toEqual(parsePage(source));
    expect(page?.number).toBe(3);
    expect(page?.page.matn[0]?.text).toBe("الكلام هو اللفظ(١).");
    expect(page?.page.glosses).toEqual([{ part: "matn", line: 1, from: 1, to: 1, text: "شرح" }]);
  });

  it("parses pages from their source on every read, so an older import's parse doesn't show", async () => {
    const source = "الباب ٣\n\n---\n\n<ruby>الكلام<rt>شرح</rt></ruby> هو\n\n## باب";
    corpus.files = [file({ file_id: "f1", page_number: 3, text: source })];
    await library.importBook({ corpusBookId: "b1" });
    db.prepare("UPDATE pages SET header = '<b>', matn = ?").run(JSON.stringify([{ kind: "paragraph", text: "<ruby>الكلام</rt>", line: 1 }]));
    expect((await library.getPage({ bookId: "b1", position: 1 }))?.page).toEqual(parsePage(source));
    expect((await library.getBook("b1"))?.pages[0]).toMatchObject({ header: "الباب ٣", headings: [{ text: "باب", level: 2 }] });
    expect(await library.getFirstLine({ bookId: "b1", position: 1 })).toBe("الكلام هو");
  });

  it("refuses to import a book twice and leaves the first import alone", async () => {
    corpus.files = [file({ file_id: "f1", page_number: 1, text: "الأصل" })];
    await library.importBook({ corpusBookId: "b1" });
    corpus.files = [file({ file_id: "f1", page_number: 1, text: "تغيير" })];
    await expect(library.importBook({ corpusBookId: "b1" })).rejects.toThrow(/already imported/i);
    const page = await library.getPage({ bookId: "b1", position: 1 });
    expect(page?.page.matn[0]?.text).toBe("الأصل");
  });
});

describe("reading", () => {
  it("never touches the corpus once a book is imported", async () => {
    corpus.files = [file({ file_id: "f1", page_number: 1 })];
    await library.importBook({ corpusBookId: "b1" });
    corpus.reachable = false;
    const callsBefore = corpus.calls;
    await library.listBooks();
    await library.getBook("b1");
    await library.getPage({ bookId: "b1", position: 1 });
    expect(corpus.calls).toBe(callsBefore);
    expect((await library.getPage({ bookId: "b1", position: 1 }))?.fileId).toBe("f1");
  });

  it("lists books with work title, author, page count and no progress until set", async () => {
    corpus.files = [file({ file_id: "f1", page_number: 1 }), file({ file_id: "f2", page_number: 2 })];
    await library.importBook({ corpusBookId: "b1" });
    expect(await library.listBooks()).toEqual([
      expect.objectContaining({
        bookId: "b1",
        title: "متن الآجرومية",
        author: "ابن آجروم",
        pageCount: 2,
        progress: null,
      }),
    ]);
    await library.setProgress({ bookId: "b1", position: 2 });
    expect((await library.listBooks())[0]?.progress).toEqual({ position: 2, updatedAt: 1000, anchor: null });
  });

  it("falls back to the corpus book title when the book has no work", async () => {
    corpus.book = { id: "b1", title: "نسخة مفردة", work: null as never };
    corpus.files = [file({ file_id: "f1", page_number: 1 })];
    await library.importBook({ corpusBookId: "b1" });
    expect((await library.listBooks())[0]).toMatchObject({ title: "نسخة مفردة", author: null });
  });

  it("gives a page's first line of main text, skipping headings", async () => {
    corpus.files = [
      file({ file_id: "f1", page_number: 1, text: "## باب الكلام\nالكلام هو اللفظ\nالمركب المفيد" }),
      file({ file_id: "f2", page_number: 2, text: "## باب فقط" }),
    ];
    await library.importBook({ corpusBookId: "b1" });
    expect(await library.getFirstLine({ bookId: "b1", position: 1 })).toBe("الكلام هو اللفظ");
    expect(await library.getFirstLine({ bookId: "b1", position: 2 })).toBeNull();
    expect(await library.getFirstLine({ bookId: "b1", position: 9 })).toBeNull();
  });

  it("returns null for a page position that does not exist", async () => {
    corpus.files = [file({ file_id: "f1", page_number: 1 })];
    await library.importBook({ corpusBookId: "b1" });
    expect(await library.getPage({ bookId: "b1", position: 5 })).toBeNull();
    expect(await library.getPage({ bookId: "nope", position: 1 })).toBeNull();
  });
});

describe("sync", () => {
  beforeEach(async () => {
    corpus.files = [
      file({ file_id: "f1", page_number: 1, text: "الأولى" }),
      file({ file_id: "f3", page_number: 3, text: "الثالثة" }),
    ];
    await library.importBook({ corpusBookId: "b1" });
    corpus.files = [
      file({ file_id: "f1", page_number: 1, text: "الأولى مصححة" }),
      file({ file_id: "f2", page_number: 2, text: "الثانية" }),
      file({ file_id: "f3", page_number: 3, text: "الثالثة" }),
      file({ file_id: "f4", page_number: 4, state: "queued", text: null }),
    ];
  });

  it("previews new, changed and pending pages", async () => {
    const preview = await library.previewSync({ bookId: "b1" });
    expect(preview.newPages.map((p) => p.fileId)).toEqual(["f2"]);
    expect(preview.changedPages.map((p) => p.fileId)).toEqual(["f1"]);
    expect(preview.pending).toBe(1);
  });

  it("pulls only new pages and keeps local text of changed pages", async () => {
    const result = await library.syncBook({ bookId: "b1", mode: "new" });
    expect(result).toEqual({ added: 1, overwritten: 0, pending: 1 });
    expect(await numbers()).toEqual([1, 2, 3]);
    expect((await library.getPage({ bookId: "b1", position: 1 }))?.page.matn[0]?.text).toBe("الأولى");
  });

  it("renumbers positions so a new page slots into corpus order", async () => {
    await library.syncBook({ bookId: "b1", mode: "new" });
    const page2 = await library.getPage({ bookId: "b1", position: 2 });
    const page3 = await library.getPage({ bookId: "b1", position: 3 });
    expect(page2?.fileId).toBe("f2");
    expect(page3?.fileId).toBe("f3");
  });

  it("overwrites only the listed pages", async () => {
    corpus.files[2] = file({ file_id: "f3", page_number: 3, text: "الثالثة مصححة" });
    const result = await library.syncBook({ bookId: "b1", mode: "overwrite", fileIds: ["f1"] });
    expect(result).toEqual({ added: 0, overwritten: 1, pending: 1 });
    expect((await library.getPage({ bookId: "b1", position: 1 }))?.page.matn[0]?.text).toBe("الأولى مصححة");
    expect((await library.getPage({ bookId: "b1", position: 2 }))?.page.matn[0]?.text).toBe("الثالثة");
  });

  it("does not add a page when asked to overwrite one that was never imported", async () => {
    const result = await library.syncBook({ bookId: "b1", mode: "overwrite", fileIds: ["f2"] });
    expect(result.overwritten).toBe(0);
    expect(await numbers()).toEqual([1, 3]);
  });
});

describe("progress across syncs", () => {
  const progressOf = async () => (await library.getBook("b1"))?.progress?.position;

  beforeEach(async () => {
    corpus.files = [
      file({ file_id: "f2", page_number: 2 }),
      file({ file_id: "f4", page_number: 4 }),
      file({ file_id: "f6", page_number: 6 }),
    ];
    await library.importBook({ corpusBookId: "b1" });
    await library.setProgress({ bookId: "b1", position: 2 });
  });

  it("follows the page when new pages are inserted before it", async () => {
    corpus.files.push(file({ file_id: "f1", page_number: 1 }), file({ file_id: "f3", page_number: 3 }));
    await library.syncBook({ bookId: "b1", mode: "new" });
    expect(await progressOf()).toBe(4);
    expect((await library.getPage({ bookId: "b1", position: 4 }))?.fileId).toBe("f4");
    expect((await library.listBooks())[0]?.progress).toEqual({ position: 4, updatedAt: 1000, anchor: null });
  });

  it("stays put when new pages are inserted after it", async () => {
    corpus.files.push(file({ file_id: "f5", page_number: 5 }), file({ file_id: "f7", page_number: 7 }));
    await library.syncBook({ bookId: "b1", mode: "new" });
    expect(await progressOf()).toBe(2);
  });

  it("survives an overwrite sync", async () => {
    corpus.files[1] = file({ file_id: "f4", page_number: 4, text: "مصححة" });
    await library.syncBook({ bookId: "b1", mode: "overwrite", fileIds: ["f4"] });
    expect(await progressOf()).toBe(2);
  });

  it("reports no progress once its page is gone, without failing", async () => {
    db.prepare("DELETE FROM pages WHERE book_id = 'b1' AND file_id = 'f4'").run();
    expect((await library.getBook("b1"))?.progress).toBeNull();
    expect((await library.listBooks())[0]?.progress).toBeNull();
  });

  it("refuses progress on a page the book does not have", async () => {
    await expect(library.setProgress({ bookId: "b1", position: 9 })).rejects.toThrow(/no page 9/);
    expect(await progressOf()).toBe(2);
  });
});

describe("place on the page", () => {
  const anchor = { part: "matn" as const, line: 7, word: 2, offset: 31.5 };
  const anchorOf = async () => (await library.getBook("b1"))?.progress?.anchor;

  beforeEach(async () => {
    corpus.files = [file({ file_id: "f1", page_number: 1 }), file({ file_id: "f2", page_number: 2 })];
    await library.importBook({ corpusBookId: "b1" });
  });

  it("saves the anchor word with progress", async () => {
    await library.setProgress({ bookId: "b1", position: 2, anchor });
    expect((await library.listBooks())[0]?.progress).toEqual({ position: 2, updatedAt: 1000, anchor });
  });

  it("keeps the anchor when the same page is saved again without one", async () => {
    await library.setProgress({ bookId: "b1", position: 2, anchor });
    await library.setProgress({ bookId: "b1", position: 2 });
    expect(await anchorOf()).toEqual(anchor);
  });

  it("drops the anchor on a different page", async () => {
    await library.setProgress({ bookId: "b1", position: 2, anchor });
    await library.setProgress({ bookId: "b1", position: 1 });
    expect(await anchorOf()).toBeNull();
  });

  it("replaces the anchor with a newer one", async () => {
    await library.setProgress({ bookId: "b1", position: 2, anchor });
    await library.setProgress({ bookId: "b1", position: 2, anchor: { ...anchor, line: 9 } });
    expect(await anchorOf()).toEqual({ ...anchor, line: 9 });
  });

  it("ignores a stored anchor it can't read", async () => {
    await library.setProgress({ bookId: "b1", position: 2, anchor });
    db.prepare("UPDATE progress SET anchor = ?").run('{"part":"elsewhere","line":1}');
    expect(await anchorOf()).toBeNull();
    db.prepare("UPDATE progress SET anchor = ?").run("not json");
    expect(await anchorOf()).toBeNull();
  });

  it("adds the anchor column to an existing progress table", async () => {
    const old = new DatabaseSync(":memory:");
    old.exec(`
      CREATE TABLE books (book_id TEXT PRIMARY KEY, title TEXT NOT NULL, author TEXT, edition TEXT,
        imported_at INTEGER NOT NULL, synced_at INTEGER NOT NULL);
      CREATE TABLE progress (book_id TEXT PRIMARY KEY REFERENCES books(book_id) ON DELETE CASCADE,
        file_id TEXT NOT NULL, updated_at INTEGER NOT NULL);
    `);
    createLibrary({ db: old, corpus: new FakeCorpus() });
    const columns = old.prepare("PRAGMA table_info(progress)").all() as { name: string }[];
    expect(columns.map((c) => c.name)).toContain("anchor");
  });
});

describe("progress migration from position to page", () => {
  it("keys existing progress rows by the page at their position, and is idempotent", async () => {
    const old = new DatabaseSync(":memory:");
    old.exec(`
      CREATE TABLE books (book_id TEXT PRIMARY KEY, title TEXT NOT NULL, author TEXT, edition TEXT,
        imported_at INTEGER NOT NULL, synced_at INTEGER NOT NULL);
      CREATE TABLE pages (book_id TEXT NOT NULL REFERENCES books(book_id) ON DELETE CASCADE, file_id TEXT NOT NULL,
        position INTEGER NOT NULL, number INTEGER, order_hint INTEGER, header TEXT, matn TEXT NOT NULL,
        hashiya TEXT NOT NULL, source TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (book_id, file_id));
      CREATE TABLE progress (book_id TEXT PRIMARY KEY REFERENCES books(book_id) ON DELETE CASCADE,
        position INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      INSERT INTO books VALUES ('a', 'A', NULL, NULL, 1, 1), ('b', 'B', NULL, NULL, 1, 1);
      INSERT INTO pages VALUES
        ('a', 'a1', 1, 1, NULL, NULL, '[]', '[]', 'x', 1),
        ('a', 'a2', 2, 2, NULL, NULL, '[]', '[]', 'x', 1),
        ('b', 'b1', 1, 1, NULL, NULL, '[]', '[]', 'x', 1),
        ('b', 'b2', 2, 2, NULL, NULL, '[]', '[]', 'x', 1);
      INSERT INTO progress VALUES ('a', 2, 500), ('b', 7, 600);
    `);
    const progressById = async () =>
      Object.fromEntries((await migrated.listBooks()).map((b) => [b.bookId, b.progress]));

    let migrated = createLibrary({ db: old, corpus: new FakeCorpus() });
    expect(await progressById()).toEqual({
      a: { position: 2, updatedAt: 500, anchor: null },
      b: { position: 2, updatedAt: 600, anchor: null },
    });
    expect(old.prepare("SELECT book_id, file_id FROM progress ORDER BY book_id").all()).toEqual([
      { book_id: "a", file_id: "a2" },
      { book_id: "b", file_id: "b2" },
    ]);

    migrated = createLibrary({ db: old, corpus: new FakeCorpus() });
    expect(await progressById()).toEqual({
      a: { position: 2, updatedAt: 500, anchor: null },
      b: { position: 2, updatedAt: 600, anchor: null },
    });
  });
});

describe("book index", () => {
  it("gives the book's contents from its printed index of topics, pointing at the pages", async () => {
    corpus.files = [
      ...Array.from({ length: 30 }, (_, i) => file({ file_id: `p${i + 1}`, page_number: i + 1, text: `صفحة ${i + 1}` })),
      file({ file_id: "idx", page_number: 31, text: "فهرس الموضوعات ٣١\n\n---\n\n## فهرس الموضوعات\n\nالمقدمة ........ ٢\nكتاب الطهارة ........ ١٠ | كتاب الصلاة ........ ٢٠" }),
    ];
    await library.importBook({ corpusBookId: "b1" });
    expect((await library.getBook("b1"))?.index).toEqual([
      { text: "المقدمة", number: 2, position: 2 },
      { text: "كتاب الطهارة", number: 10, position: 10 },
      { text: "كتاب الصلاة", number: 20, position: 20 },
    ]);
  });

  it("is null for a book without one", async () => {
    corpus.files = [file({ file_id: "f1", page_number: 1 })];
    await library.importBook({ corpusBookId: "b1" });
    expect((await library.getBook("b1"))?.index).toBeNull();
  });
});

