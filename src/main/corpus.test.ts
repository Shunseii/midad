import { afterEach, describe, expect, it, vi } from "vitest";
import { CorpusError, createCorpusClient } from "./corpus";

const client = createCorpusClient({ endpoint: "https://corpus.test/", key: "secret" });
const page = { bookId: "book 1", fileId: "file-1" };
const fileUrl = "https://corpus.test/api/books/book%201/files/file-1";

const mockFetch = (response: Response) => {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("editText", () => {
  it("PATCHes the edits and note and returns the new revision", async () => {
    const fetchMock = mockFetch(json(200, { success: true, file_id: "file-1", changed: true, revision_id: 12, text_edited_at: 1700 }));
    const result = await client.editText({ ...page, edits: [{ old: "قال", new: "قالَ" }], note: "midad: fix" });

    expect(result).toEqual({ kind: "edited", changed: true, revisionId: "12", textEditedAt: 1700 });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(`${fileUrl}/text`);
    expect(init?.method).toBe("PATCH");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer secret");
    expect(JSON.parse(String(init?.body))).toEqual({ edits: [{ old: "قال", new: "قالَ" }], note: "midad: fix" });
  });

  it("reports which edit failed on 422", async () => {
    mockFetch(json(422, { success: false, error: "Edit 1 not found; nothing was applied", failed_edit: 1, reason: "not found" }));
    const result = await client.editText({ ...page, edits: [{ old: "a", new: "b" }, { old: "c", new: "d" }], note: "midad: x" });
    expect(result).toEqual({ kind: "failed", failedEdit: 1, reason: "not found" });
  });

  it("reports a conflict on 409", async () => {
    mockFetch(new Response("page changed during edit", { status: 409 }));
    const result = await client.editText({ ...page, edits: [{ old: "a", new: "b" }], note: "midad: x" });
    expect(result).toEqual({ kind: "conflict", message: "page changed during edit" });
  });

  it("throws a CorpusError on other failures", async () => {
    mockFetch(json(401, { success: false, error: "Unauthorized" }));
    await expect(client.editText({ ...page, edits: [{ old: "a", new: "b" }], note: "midad: x" })).rejects.toBeInstanceOf(CorpusError);
  });
});

describe("textHistory", () => {
  it("returns the revisions newest first", async () => {
    const fetchMock = mockFetch(
      json(200, {
        success: true,
        file_id: "file-1",
        text_edited_at: 1700,
        revisions: [
          { id: 12, change: "edit", model: null, note: "midad: fix", created_at: 1700 },
          { id: 3, change: "ocr", model: "gemini", note: null, created_at: 1000 },
        ],
      }),
    );
    const history = await client.textHistory(page);

    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${fileUrl}/text/history`);
    expect(history).toEqual({
      textEditedAt: 1700,
      revisions: [
        { id: "12", change: "edit", model: null, note: "midad: fix", createdAt: 1700 },
        { id: "3", change: "ocr", model: "gemini", note: null, createdAt: 1000 },
      ],
    });
  });
});

describe("getText", () => {
  it("reads the current text", async () => {
    const fetchMock = mockFetch(new Response("النص الحالي"));
    expect(await client.getText(page)).toBe("النص الحالي");
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${fileUrl}/text`);
  });

  it("reads the text before a revision", async () => {
    const fetchMock = mockFetch(new Response("النص السابق"));
    expect(await client.getText({ ...page, rev: "12" })).toBe("النص السابق");
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${fileUrl}/text?rev=12`);
  });

  it("throws on a missing revision", async () => {
    mockFetch(new Response("not found", { status: 404 }));
    await expect(client.getText({ ...page, rev: "99" })).rejects.toMatchObject({ status: 404 });
  });
});

describe("exportBook", () => {
  const exported = (id: string) => ({ file_id: id, page_number: null, role: null, order_hint: null, state: "done", text: id });

  it("fetches the book in batches, following the cursor, and reports progress after each", async () => {
    const batches = [
      { files: [exported("a"), exported("b")], files_total: 3, next_cursor: "p 2/x" },
      { files: [exported("c")], files_total: 3, next_cursor: null },
    ];
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => json(200, { success: true, book_id: "book 1", ...batches.shift() }));
    vi.stubGlobal("fetch", fetchMock);
    const progress: { done: number; total: number }[] = [];
    const files = await client.exportBook("book 1", { onProgress: (p) => progress.push(p) });
    expect(files.map((f) => f.file_id)).toEqual(["a", "b", "c"]);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "https://corpus.test/api/books/book%201/export?limit=50",
      "https://corpus.test/api/books/book%201/export?limit=50&cursor=p%202%2Fx",
    ]);
    expect(progress).toEqual([
      { done: 2, total: 3 },
      { done: 3, total: 3 },
    ]);
  });

  it("uses the latest total, and never reports more done than total", async () => {
    const batches = [
      { files: [exported("a")], files_total: 1, next_cursor: "c1" },
      { files: [exported("b")], files_total: 1, next_cursor: null },
    ];
    vi.stubGlobal("fetch", vi.fn(async () => json(200, { success: true, ...batches.shift() })));
    const progress: { done: number; total: number }[] = [];
    await client.exportBook("b", { onProgress: (p) => progress.push(p) });
    expect(progress).toEqual([
      { done: 1, total: 1 },
      { done: 2, total: 2 },
    ]);
  });

  it("fails the whole export when a batch fails", async () => {
    const responses = [json(200, { success: true, files: [exported("a")], files_total: 2, next_cursor: "c1" }), json(400, { success: false, error: "bad cursor" })];
    vi.stubGlobal("fetch", vi.fn(async () => responses.shift()));
    await expect(client.exportBook("b")).rejects.toBeInstanceOf(CorpusError);
  });
});
