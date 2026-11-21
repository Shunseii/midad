import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import type { ExportFile } from "../shared/corpus";
import { cleanBookmarkName, createBookmarks, type Bookmarks } from "./bookmarks";
import type { CorpusSource } from "./corpus";
import { createLibrary, type Library } from "./library";

const page = (fileId: string, pageNumber: number): ExportFile => ({
  file_id: fileId,
  page_number: pageNumber,
  role: null,
  order_hint: null,
  state: "done",
  text: `h\n\n---\nصفحة ${pageNumber}`,
});

class FakeCorpus implements CorpusSource {
  files: ExportFile[] = [page("f2", 2), page("f4", 4), page("f6", 6)];
  async getBook(id: string) {
    return { id, title: "t", work: null };
  }
  async exportBook() {
    return structuredClone(this.files);
  }
}

let corpus: FakeCorpus;
let library: Library;
let bookmarks: Bookmarks;
let clock = 1000;

beforeEach(async () => {
  clock = 1000;
  corpus = new FakeCorpus();
  const db = new DatabaseSync(":memory:");
  library = createLibrary({ db, corpus, now: () => clock });
  bookmarks = createBookmarks({ db, now: () => clock });
  await library.importBook({ corpusBookId: "b1" });
});

describe("bookmarks", () => {
  it("lists a book's bookmarks in page order", async () => {
    await bookmarks.set({ bookId: "b1", position: 3 });
    clock = 2000;
    await bookmarks.set({ bookId: "b1", position: 1, name: "البداية" });
    expect(await bookmarks.list({ bookId: "b1" })).toEqual([
      { position: 1, name: "البداية", createdAt: 2000 },
      { position: 3, name: null, createdAt: 1000 },
    ]);
  });

  it("keeps one bookmark per page: renaming keeps the date it was added", async () => {
    await bookmarks.set({ bookId: "b1", position: 2, name: "أ" });
    clock = 5000;
    expect(await bookmarks.set({ bookId: "b1", position: 2, name: "ب" })).toEqual({ position: 2, name: "ب", createdAt: 1000 });
    expect(await bookmarks.list({ bookId: "b1" })).toHaveLength(1);
  });

  it("puts back the original date when undo restores a bookmark", async () => {
    await bookmarks.set({ bookId: "b1", position: 2, createdAt: 42 });
    expect((await bookmarks.list({ bookId: "b1" }))[0]?.createdAt).toBe(42);
  });

  it("removes a bookmark", async () => {
    await bookmarks.set({ bookId: "b1", position: 2 });
    await bookmarks.remove({ bookId: "b1", position: 2 });
    expect(await bookmarks.list({ bookId: "b1" })).toEqual([]);
  });

  it("stays on its page when a sync inserts pages before it", async () => {
    await bookmarks.set({ bookId: "b1", position: 1 });
    corpus.files.push(page("f1", 1));
    await library.syncBook({ bookId: "b1", mode: "new" });
    expect((await bookmarks.list({ bookId: "b1" }))[0]?.position).toBe(2);
  });

  it("refuses a page the book doesn't have", async () => {
    await expect(bookmarks.set({ bookId: "b1", position: 9 })).rejects.toThrow(/no page 9/);
  });
});

describe("cleanBookmarkName", () => {
  it("treats a blank name as no name and tidies spaces", () => {
    expect(cleanBookmarkName("   ")).toBeNull();
    expect(cleanBookmarkName(undefined)).toBeNull();
    expect(cleanBookmarkName("  باب   الفاعل ")).toBe("باب الفاعل");
  });
});
