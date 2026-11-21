import type { DatabaseSync } from "node:sqlite";
import type { Bookmark } from "../shared/library";

/**
 * Page bookmarks: at most one per page, with an optional name. Stored against the page's corpus
 * file so a bookmark stays on its page when a sync renumbers the book. Requires the library's schema.
 */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS bookmarks (
  book_id TEXT NOT NULL,
  file_id TEXT NOT NULL,
  name TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (book_id, file_id),
  FOREIGN KEY (book_id, file_id) REFERENCES pages (book_id, file_id) ON DELETE CASCADE
);
`;

/** Bookmark names are kept short; blank names mean "no name". */
export const BOOKMARK_NAME_MAX = 120;

export const cleanBookmarkName = (name: string | null | undefined): string | null => {
  const trimmed = name?.replace(/\s+/g, " ").trim().slice(0, BOOKMARK_NAME_MAX) ?? "";
  return trimmed === "" ? null : trimmed;
};

export const createBookmarks = ({ db, now = Date.now }: { db: DatabaseSync; now?: () => number }) => {
  db.exec(SCHEMA);

  const fileAt = ({ bookId, position }: { bookId: string; position: number }) => {
    const row = db.prepare("SELECT file_id FROM pages WHERE book_id = ? AND position = ?").get(bookId, position) as { file_id: string } | undefined;
    if (!row) throw new Error(`Book ${bookId} has no page ${position} in the library.`);
    return row.file_id;
  };

  return {
    /** The book's bookmarks in page order. */
    async list({ bookId }: { bookId: string }): Promise<Bookmark[]> {
      const rows = db
        .prepare(
          `SELECT p.position, b.name, b.created_at FROM bookmarks b
           JOIN pages p ON p.book_id = b.book_id AND p.file_id = b.file_id
           WHERE b.book_id = ? ORDER BY p.position`,
        )
        .all(bookId) as { position: number; name: string | null; created_at: number }[];
      return rows.map((r) => ({ position: r.position, name: r.name, createdAt: r.created_at }));
    },

    /**
     * Adds or updates the page's bookmark. Without `createdAt` a new bookmark is stamped now and an
     * existing one keeps its date; undo passes the original date back.
     */
    async set({ bookId, position, name, createdAt }: { bookId: string; position: number; name?: string | null; createdAt?: number }): Promise<Bookmark> {
      const fileId = fileAt({ bookId, position });
      const clean = cleanBookmarkName(name);
      db.prepare(
        `INSERT INTO bookmarks (book_id, file_id, name, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (book_id, file_id) DO UPDATE SET name = excluded.name,
           created_at = CASE WHEN ? THEN excluded.created_at ELSE bookmarks.created_at END`,
      ).run(bookId, fileId, clean, createdAt ?? now(), createdAt === undefined ? 0 : 1);
      const row = db.prepare("SELECT created_at FROM bookmarks WHERE book_id = ? AND file_id = ?").get(bookId, fileId) as { created_at: number };
      return { position, name: clean, createdAt: row.created_at };
    },

    async remove({ bookId, position }: { bookId: string; position: number }): Promise<void> {
      db.prepare("DELETE FROM bookmarks WHERE book_id = ? AND file_id = ?").run(bookId, fileAt({ bookId, position }));
    },
  };
};

export type Bookmarks = ReturnType<typeof createBookmarks>;
