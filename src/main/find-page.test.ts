import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import type { ExportFile } from "../shared/corpus";
import type { CorpusSource } from "./corpus";
import { createPageFinder } from "./find-page";
import { createLibrary } from "./library";

const file = ({ fileId, pageNumber }: { fileId: string; pageNumber: number }): ExportFile => ({
  file_id: fileId,
  page_number: pageNumber,
  role: null,
  order_hint: null,
  state: "done",
  text: `h\n\n---\nصفحة ${pageNumber}`,
});

const corpus: CorpusSource = {
  getBook: async (id) => ({ id, title: id === "wiqaya-1" ? "شرح الوقاية" : "شرح العقيدة الطحاوية", work: null }),
  exportBook: async (id) =>
    id === "wiqaya-1"
      ? [file({ fileId: "w-30", pageNumber: 30 }), file({ fileId: "w-10", pageNumber: 10 }), file({ fileId: "w-20", pageNumber: 20 })]
      : [file({ fileId: "t-1", pageNumber: 1 })],
};

let finder: ReturnType<typeof createPageFinder>;

beforeEach(async () => {
  const library = createLibrary({ db: new DatabaseSync(":memory:"), corpus });
  await library.importBook({ corpusBookId: "wiqaya-1" });
  await library.importBook({ corpusBookId: "tahawiya-1" });
  finder = createPageFinder({ library });
});

describe("findPage", () => {
  it("maps a book title and page position to the corpus file", async () => {
    const page = await finder.findPage({ book: "الوقاية", position: 2 });
    expect(page).toMatchObject({ bookId: "wiqaya-1", position: 2, number: 20, fileId: "w-20" });
  });

  it("finds a book by its id or the start of it", async () => {
    expect((await finder.findPage({ book: "wiqaya-1", position: 1 })).fileId).toBe("w-10");
    expect((await finder.findPage({ book: "taha", position: 1 })).fileId).toBe("t-1");
  });

  it("refuses an unknown or ambiguous book", async () => {
    await expect(finder.findPage({ book: "nope", position: 1 })).rejects.toThrow(/No book matches "nope"/);
    await expect(finder.findPage({ book: "شرح", position: 1 })).rejects.toThrow(/matches 2 books/);
  });

  it("refuses a page the book doesn't have", async () => {
    await expect(finder.findPage({ book: "الوقاية", position: 4 })).rejects.toThrow("شرح الوقاية has no page 4; it has 3.");
  });
});
