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
