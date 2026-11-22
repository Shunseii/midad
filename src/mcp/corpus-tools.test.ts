import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TextEditResult } from "../shared/corpus";
import type { StoredPage } from "../shared/library";
import { type CorpusTextApi, createCorpusTools, midadNote, ToolError, validateEdits } from "./corpus-tools";

const stored: StoredPage = { bookId: "wiqaya-1", position: 21, number: 40, fileId: "file-21", page: { header: null, matn: [], hashiya: [], glosses: [] } };

let corpus: { [K in keyof CorpusTextApi]: ReturnType<typeof vi.fn<CorpusTextApi[K]>> };
let syncPage: ReturnType<typeof vi.fn<(input: { bookId: string; fileId: string }) => Promise<void>>>;
let tools: ReturnType<typeof createCorpusTools>;

const edited = (overrides: Partial<Extract<TextEditResult, { kind: "edited" }>> = {}): TextEditResult => ({
  kind: "edited",
  changed: true,
  revisionId: "12",
  textEditedAt: 1700,
  ...overrides,
});

beforeEach(() => {
  corpus = {
    getText: vi.fn<CorpusTextApi["getText"]>(async () => ""),
    editText: vi.fn<CorpusTextApi["editText"]>(async () => edited()),
    textHistory: vi.fn<CorpusTextApi["textHistory"]>(async () => ({ textEditedAt: null, revisions: [] })),
  };
  syncPage = vi.fn(async () => {});
  tools = createCorpusTools({
    findPage: async ({ book, position }) => {
      if (book !== "الوقاية" || position !== 21) throw new Error(`No book matches "${book}".`);
      return stored;
    },
    bookTitle: async () => "شرح الوقاية",
    corpus,
    syncPage,
  });
});

describe("validateEdits", () => {
  it("accepts real replacements", () => {
    expect(validateEdits([{ old: "قال", new: "قالَ" }])).toEqual([{ old: "قال", new: "قالَ" }]);
  });

  it("refuses no edits, an empty old, or an edit that changes nothing", () => {
    expect(() => validateEdits([])).toThrow(ToolError);
    expect(() => validateEdits([{ old: "a", new: "b" }, { old: "", new: "x" }])).toThrow(/Edit 2 has an empty "old"/);
    expect(() => validateEdits([{ old: "a", new: "a" }])).toThrow(/Edit 1 changes nothing/);
  });
});

describe("midadNote", () => {
  it("always starts the note with midad:", () => {
    expect(midadNote("gloss on the wrong word")).toBe("midad: gloss on the wrong word");
    expect(midadNote("  midad: already prefixed ")).toBe("midad: already prefixed");
    expect(midadNote("")).toBe("midad: hand edit");
  });
});

describe("edit", () => {
  it("edits the page's corpus file, then syncs that page", async () => {
    const text = await tools.edit({ book: "الوقاية", page: 21, edits: [{ old: "الماءِ", new: "الماءُ" }], note: "misread haraka" });

    expect(corpus.editText).toHaveBeenCalledWith({ bookId: "wiqaya-1", fileId: "file-21", edits: [{ old: "الماءِ", new: "الماءُ" }], note: "midad: misread haraka" });
    expect(syncPage).toHaveBeenCalledWith({ bookId: "wiqaya-1", fileId: "file-21" });
    expect(text).toBe("Edited شرح الوقاية page 21 (printed 40). corpus_restore with rev 12 undoes it. The reader shows the change now.");
  });

  it("validates before calling the corpus", async () => {
    await expect(tools.edit({ book: "الوقاية", page: 21, edits: [], note: "x" })).rejects.toThrow(ToolError);
    expect(corpus.editText).not.toHaveBeenCalled();
  });

  it("passes on a page lookup error", async () => {
    await expect(tools.edit({ book: "nope", page: 21, edits: [{ old: "a", new: "b" }], note: "x" })).rejects.toThrow(/No book matches "nope"/);
  });

  it("explains a failed edit (422) and doesn't sync", async () => {
    corpus.editText.mockResolvedValue({ kind: "failed", failedEdit: 1, reason: "not found" });
    await expect(tools.edit({ book: "الوقاية", page: 21, edits: [{ old: "a", new: "b" }, { old: "c", new: "d" }], note: "x" })).rejects.toThrow(
      /Edit 2 didn't apply \(not found\), so nothing was changed/,
    );
    expect(syncPage).not.toHaveBeenCalled();
  });

  it("says to re-read and retry on a conflict (409)", async () => {
    corpus.editText.mockResolvedValue({ kind: "conflict", message: "changed during edit" });
    await expect(tools.edit({ book: "الوقاية", page: 21, edits: [{ old: "a", new: "b" }], note: "x" })).rejects.toThrow(/Read the page again with corpus_text and retry/);
    expect(syncPage).not.toHaveBeenCalled();
  });

  it("doesn't sync when nothing changed", async () => {
    corpus.editText.mockResolvedValue(edited({ changed: false, revisionId: null }));
    expect(await tools.edit({ book: "الوقاية", page: 21, edits: [{ old: "a", new: "b" }], note: "x" })).toMatch(/Nothing changed/);
    expect(syncPage).not.toHaveBeenCalled();
  });

  it("still reports the edit when the sync fails", async () => {
    syncPage.mockRejectedValue(new Error("offline"));
    expect(await tools.edit({ book: "الوقاية", page: 21, edits: [{ old: "a", new: "b" }], note: "x" })).toMatch(/The edit is saved, but the reader couldn't update yet \(offline\)/);
  });
});

describe("history", () => {
  it("lists the revisions with their revs", async () => {
    corpus.textHistory.mockResolvedValue({
      textEditedAt: Date.UTC(2026, 10, 21, 14, 3),
      revisions: [
        { id: "12", change: "edit", model: null, note: "midad: misread haraka", createdAt: Date.UTC(2026, 10, 21, 14, 3) },
        { id: "3", change: "ocr", model: "gemini-3", note: null, createdAt: Date.UTC(2026, 10, 20, 9, 0) },
      ],
    });
    const text = await tools.history({ book: "الوقاية", page: 21 });
    expect(corpus.textHistory).toHaveBeenCalledWith({ bookId: "wiqaya-1", fileId: "file-21" });
    expect(text).toContain("rev 12\t2026-11-21 14:03\tedit\tmidad: misread haraka");
    expect(text).toContain("rev 3\t2026-11-20 09:00\tre-OCR (gemini-3)");
  });

  it("says when there are no changes", async () => {
    expect(await tools.history({ book: "الوقاية", page: 21 })).toBe("شرح الوقاية page 21 (printed 40) has no recorded changes.");
  });
});

describe("restore", () => {
  it("replaces the whole current text with the text before rev, then syncs", async () => {
    corpus.getText.mockImplementation(async ({ rev }) => (rev === "12" ? "النص القديم" : "النص الجديد"));
    corpus.editText.mockResolvedValue(edited({ revisionId: "13" }));

    const text = await tools.restore({ book: "الوقاية", page: 21, rev: "12" });

    expect(corpus.editText).toHaveBeenCalledWith({
      bookId: "wiqaya-1",
      fileId: "file-21",
      edits: [{ old: "النص الجديد", new: "النص القديم" }],
      note: "midad: restore rev 12",
    });
    expect(syncPage).toHaveBeenCalledOnce();
    expect(text).toBe("Restored شرح الوقاية page 21 (printed 40). corpus_restore with rev 13 undoes this restore. The reader shows the change now.");
  });

  it("does nothing when the page already matches", async () => {
    corpus.getText.mockResolvedValue("same");
    expect(await tools.restore({ book: "الوقاية", page: 21, rev: "12" })).toMatch(/nothing to restore/);
    expect(corpus.editText).not.toHaveBeenCalled();
  });
});

describe("text", () => {
  it("reads the page's corpus text, optionally before a rev", async () => {
    corpus.getText.mockResolvedValue("نص");
    expect(await tools.text({ book: "الوقاية", page: 21, rev: "12" })).toBe("نص");
    expect(corpus.getText).toHaveBeenCalledWith({ bookId: "wiqaya-1", fileId: "file-21", rev: "12" });
  });
});
