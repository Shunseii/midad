import type { DatabaseSync } from "node:sqlite";
import type { LastRead } from "../shared/library";
import type { MatnBlock } from "../shared/page";

/**
 * One last-read marker per book, on a matn line. Stored against the page's
 * corpus file so it stays on the right page when a sync renumbers the book.
 * Requires the library's schema.
 */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS markers (
  book_id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL,
  line INTEGER NOT NULL,
  set_at INTEGER NOT NULL,
  FOREIGN KEY (book_id, file_id) REFERENCES pages (book_id, file_id) ON DELETE CASCADE
);
`;

export const createMarkers = ({ db, now = Date.now }: { db: DatabaseSync; now?: () => number }) => {
  db.exec(SCHEMA);

  return {
    async get({ bookId }: { bookId: string }): Promise<LastRead | null> {
      const row = db
        .prepare(
          `SELECT p.position, m.line, m.set_at FROM markers m
           JOIN pages p ON p.book_id = m.book_id AND p.file_id = m.file_id
           WHERE m.book_id = ?`,
        )
        .get(bookId) as { position: number; line: number; set_at: number } | undefined;
      return row ? { position: row.position, line: row.line, setAt: row.set_at } : null;
    },

    async set({ bookId, position, line }: { bookId: string; position: number; line: number }): Promise<void> {
      const row = db.prepare("SELECT file_id, matn FROM pages WHERE book_id = ? AND position = ?").get(bookId, position) as
        | { file_id: string; matn: string }
        | undefined;
      if (!row) throw new Error(`Book ${bookId} has no page ${position} in the library.`);
      const matn = JSON.parse(row.matn) as MatnBlock[];
      if (!matn.some((b) => b.line === line)) throw new Error(`Page ${position} has no matn line ${line}.`);
      db.prepare(
        `INSERT INTO markers (book_id, file_id, line, set_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (book_id) DO UPDATE SET file_id = excluded.file_id, line = excluded.line, set_at = excluded.set_at`,
      ).run(bookId, row.file_id, line, now());
    },

    async clear({ bookId }: { bookId: string }): Promise<void> {
      db.prepare("DELETE FROM markers WHERE book_id = ?").run(bookId);
    },
  };
};

export type Markers = ReturnType<typeof createMarkers>;
