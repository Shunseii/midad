import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import type { ExportFile } from "../shared/corpus";
import type { CorpusSource } from "./corpus";
import { createLibrary, type Library } from "./library";
import { createMarkers, type Markers } from "./markers";

const page = (fileId: string, pageNumber: number, text: string): ExportFile => ({
  file_id: fileId,
  page_number: pageNumber,
  role: null,
  order_hint: null,
  state: "done",
  text,
});

// Page 1 has matn lines 1–3, page 2 has one line.
const PAGE_1 = ["h", "", "---", "## باب الكلام", "الكلام هو اللفظ", "وأقسامه ثلاثة"].join("\n");
const PAGE_2 = "h\n\n---\nصفحة ثانية";

class FakeCorpus implements CorpusSource {
  files: ExportFile[] = [page("f1", 1, PAGE_1), page("f2", 2, PAGE_2)];
  async getBook(id: string) {
    return { id, title: "t", work: null };
  }
  async exportBook() {
    return structuredClone(this.files);
  }
}

let corpus: FakeCorpus;
let library: Library;
let markers: Markers;
let clock = 1000;

beforeEach(async () => {
  clock = 1000;
  corpus = new FakeCorpus();
  const db = new DatabaseSync(":memory:");
  library = createLibrary({ db, corpus, now: () => clock });
  markers = createMarkers({ db, now: () => clock });
  await library.importBook({ corpusBookId: "b1" });
});

describe("last-read marker", () => {
  it("is empty for a book without one", async () => {
    expect(await markers.get({ bookId: "b1" })).toBeNull();
  });

  it("returns the page and line it was set on", async () => {
    await markers.set({ bookId: "b1", position: 1, line: 3 });
    expect(await markers.get({ bookId: "b1" })).toEqual({ position: 1, line: 3, setAt: 1000 });
  });

  it("keeps one marker per book: setting it again moves it", async () => {
    await markers.set({ bookId: "b1", position: 1, line: 3 });
    clock = 2000;
    await markers.set({ bookId: "b1", position: 2, line: 1 });
    expect(await markers.get({ bookId: "b1" })).toEqual({ position: 2, line: 1, setAt: 2000 });
  });

  it.each([
    ["a matn line that isn't on the page", { position: 2, line: 2 }, /no matn line 2/],
    ["line zero", { position: 1, line: 0 }, /no matn line 0/],
    ["a page that isn't in the library", { position: 9, line: 1 }, /page 9/],
  ])("refuses %s", async (_label, at, message) => {
    await expect(markers.set({ bookId: "b1", ...at })).rejects.toThrow(message);
    expect(await markers.get({ bookId: "b1" })).toBeNull();
  });

  it("clears the marker", async () => {
    await markers.set({ bookId: "b1", position: 1, line: 2 });
    await markers.clear({ bookId: "b1" });
    expect(await markers.get({ bookId: "b1" })).toBeNull();
  });

  it("follows its page when a sync adds a page before it", async () => {
    await markers.set({ bookId: "b1", position: 2, line: 1 });
    corpus.files.push(page("f0", 0, "h\n\n---\nمقدمة"));
    await library.syncBook({ bookId: "b1", mode: "new" });
    expect(await markers.get({ bookId: "b1" })).toMatchObject({ position: 3, line: 1 });
  });
});
