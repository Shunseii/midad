import type { BookWithStatus, CorpusBookListing, ExportFile, TextEdit, TextEditResult, TextHistory, Work } from "../shared/corpus";

/** Files fetched so far out of the book's latest file count. */
export interface ExportProgress {
  done: number;
  total: number;
}

/** What the library needs from a book source. The corpus is the only one today. */
export interface CorpusSource {
  getBook(id: string): Promise<{ id: string; title: string; work: { name: string; author: string | null } | null }>;
  exportBook(id: string, options?: { onProgress?: (progress: ExportProgress) => void }): Promise<ExportFile[]>;
}

/** Files per export request; each batch reports progress. */
export const EXPORT_BATCH = 50;

export class CorpusError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "CorpusError";
  }
}

const READY_STATES = ["done", "needs_review", "approved"] as const;

export const createCorpusClient = ({ endpoint, key }: { endpoint: string; key: string }) => {
  const base = endpoint.replace(/\/+$/, "");

  const get = async <T>(path: string): Promise<T> => {
    const res = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${key}` } });
    if (!res.ok) throw new CorpusError(res.status, `${res.status} ${await res.text().catch(() => res.statusText)}`);
    return (await res.json()) as T;
  };

  const fail = async (res: Response) => new CorpusError(res.status, `${res.status} ${await res.text().catch(() => res.statusText)}`);

  const filePath = ({ bookId, fileId }: { bookId: string; fileId: string }) =>
    `${base}/api/books/${encodeURIComponent(bookId)}/files/${encodeURIComponent(fileId)}`;

  const listWorks = async () => (await get<{ works: Work[] }>("/api/works")).works;

  const client = {
    async listBooks(): Promise<CorpusBookListing[]> {
      const [books, works] = await Promise.all([
        get<{ books: BookWithStatus[] }>("/api/books").then((r) => r.books),
        listWorks(),
      ]);
      const workById = new Map(works.map((w) => [w.id, w]));
      return books.map((b) => {
        const work = b.work_id ? workById.get(b.work_id) : undefined;
        return {
          id: b.id,
          title: work?.name ?? b.title,
          author: work?.author ?? null,
          workTitle: work && b.title !== work.name ? b.title : null,
          pagesTotal: b.files_total,
          pagesReady: READY_STATES.reduce((n, s) => n + (b.counts[s] ?? 0), 0),
        };
      });
    },

    async getBook(id: string) {
      const book = (await get<{ book: BookWithStatus }>(`/api/books/${id}`)).book;
      const work = book.work_id ? (await listWorks()).find((w) => w.id === book.work_id) : undefined;
      return {
        id: book.id,
        title: book.title,
        work: work ? { name: work.name, author: work.author ?? null } : null,
      };
    },

    /** The book's files in batches, so a long book reports progress as it arrives. */
    async exportBook(id: string, { onProgress }: { onProgress?: (progress: ExportProgress) => void } = {}): Promise<ExportFile[]> {
      const files = new Map<string, ExportFile>();
      let cursor: string | null = null;
      do {
        const query: string = cursor === null ? "" : `&cursor=${encodeURIComponent(cursor)}`;
        const batch = await get<{ files: ExportFile[]; files_total: number; next_cursor: string | null }>(
          `/api/books/${encodeURIComponent(id)}/export?limit=${EXPORT_BATCH}${query}`,
        );
        for (const f of batch.files) files.set(f.file_id, f);
        cursor = batch.next_cursor;
        onProgress?.({ done: files.size, total: Math.max(batch.files_total, files.size) });
      } while (cursor !== null);
      return [...files.values()];
    },

    /** The page's original scan image. */
    async fetchScan({ bookId, fileId }: { bookId: string; fileId: string }): Promise<{ bytes: Uint8Array; contentType: string }> {
      const res = await fetch(`${base}/api/books/${encodeURIComponent(bookId)}/files/${encodeURIComponent(fileId)}/image`, {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!res.ok) throw new CorpusError(res.status, `${res.status} ${await res.text().catch(() => res.statusText)}`);
      return { bytes: new Uint8Array(await res.arrayBuffer()), contentType: res.headers.get("content-type")?.split(";")[0] ?? "image/jpeg" };
    },

    /** The page's current text, or with `rev` the text just before that change. */
    async getText({ bookId, fileId, rev }: { bookId: string; fileId: string; rev?: string }): Promise<string> {
      const query = rev === undefined ? "" : `?rev=${encodeURIComponent(rev)}`;
      const res = await fetch(`${filePath({ bookId, fileId })}/text${query}`, { headers: { Authorization: `Bearer ${key}` } });
      if (!res.ok) throw await fail(res);
      return res.text();
    },

    /** Hand-edits the page's text. All or nothing: a failed edit or a conflict changes nothing. */
    async editText({ bookId, fileId, edits, note }: { bookId: string; fileId: string; edits: TextEdit[]; note: string }): Promise<TextEditResult> {
      const res = await fetch(`${filePath({ bookId, fileId })}/text`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({ edits, note }),
      });
      if (res.status === 422) {
        const body = (await res.json()) as { failed_edit: number; reason: string };
        return { kind: "failed", failedEdit: body.failed_edit, reason: body.reason };
      }
      if (res.status === 409) return { kind: "conflict", message: await res.text().catch(() => res.statusText) };
      if (!res.ok) throw await fail(res);
      const body = (await res.json()) as { changed: boolean; revision_id: string | number | null; text_edited_at: number | null };
      return {
        kind: "edited",
        changed: body.changed,
        revisionId: body.revision_id === null ? null : String(body.revision_id),
        textEditedAt: body.text_edited_at,
      };
    },

    async textHistory({ bookId, fileId }: { bookId: string; fileId: string }): Promise<TextHistory> {
      const res = await fetch(`${filePath({ bookId, fileId })}/text/history`, { headers: { Authorization: `Bearer ${key}` } });
      if (!res.ok) throw await fail(res);
      const body = (await res.json()) as {
        text_edited_at: number | null;
        revisions: { id: string | number; change: "edit" | "ocr"; model: string | null; note: string | null; created_at: number }[];
      };
      return {
        textEditedAt: body.text_edited_at,
        revisions: body.revisions.map((r) => ({ id: String(r.id), change: r.change, model: r.model ?? null, note: r.note ?? null, createdAt: r.created_at })),
      };
    },

    async ping(): Promise<void> {
      await get("/api/books");
    },
  };

  return client satisfies CorpusSource;
};

export type CorpusClient = ReturnType<typeof createCorpusClient>;
