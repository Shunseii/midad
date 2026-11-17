import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import type { CorpusSource } from "./corpus";
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

  async exportBook() {
    this.guard();
    return structuredClone(this.files);
  }

  private guard() {
    this.calls += 1;
    if (!this.reachable) throw new Error("corpus unreachable");
  }
}

let corpus: FakeCorpus;
let library: Library;

beforeEach(() => {
  corpus = new FakeCorpus();
  library = createLibrary({ db: new DatabaseSync(":memory:"), corpus, now: () => 1000 });
});

const numbers = async (bookId = "b1") =>
  (await library.getBook(bookId))?.pages.map((p) => p.number);

describe("import", () => {
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

  it("stores the parsed page so reading returns matn and hashiya without glosses", async () => {
    const source = "الباب ٣\n\n---\n\n<ruby>الكلام<rt>شرح</rt></ruby> هو اللفظ(١).\n\n---\n\n### الحاشية\n(١) أي القصد.";
    corpus.files = [file({ file_id: "f1", page_number: 3, text: source })];
    await library.importBook({ corpusBookId: "b1" });
    const page = await library.getPage({ bookId: "b1", position: 1 });
    expect(page?.page).toEqual(parsePage(source));
    expect(page?.number).toBe(3);
    expect(JSON.stringify(page)).not.toContain("شرح");
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
    expect((await library.listBooks())[0]?.progress).toEqual({ position: 2, updatedAt: 1000 });
  });

  it("falls back to the corpus book title when the book has no work", async () => {
    corpus.book = { id: "b1", title: "نسخة مفردة", work: null as never };
    corpus.files = [file({ file_id: "f1", page_number: 1 })];
    await library.importBook({ corpusBookId: "b1" });
    expect((await library.listBooks())[0]).toMatchObject({ title: "نسخة مفردة", author: null });
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
