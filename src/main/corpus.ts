import type { BookWithStatus, CorpusBookListing, ExportFile, Work } from "../shared/corpus";

/** What the library needs from a book source. The corpus is the only one today. */
export interface CorpusSource {
  getBook(id: string): Promise<{ id: string; title: string; work: { name: string; author: string | null } | null }>;
  exportBook(id: string): Promise<ExportFile[]>;
}

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

    async exportBook(id: string): Promise<ExportFile[]> {
      return (await get<{ files: ExportFile[] }>(`/api/books/${id}/export`)).files;
    },

    async ping(): Promise<void> {
      await get("/api/books");
    },
  };

  return client satisfies CorpusSource;
};

export type CorpusClient = ReturnType<typeof createCorpusClient>;
