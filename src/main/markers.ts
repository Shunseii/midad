import type { DatabaseSync } from "node:sqlite";
import type { LastRead } from "../shared/library";
import { wordsOf } from "../shared/annotations";
import type { MatnBlock } from "../shared/page";

/**
 * One last-read marker per book, on a word of a matn line. The reader marks
 * the screen row that word is on, so the mark survives reflowing the text. Stored against the page's
 * corpus file so it stays on the right page when a sync renumbers the book.
 * Requires the library's schema.
 */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS markers (
  book_id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL,
  line INTEGER NOT NULL,
  word INTEGER NOT NULL DEFAULT 1,
  set_at INTEGER NOT NULL,
  FOREIGN KEY (book_id, file_id) REFERENCES pages (book_id, file_id) ON DELETE CASCADE
);
`;

export const createMarkers = ({ db, now = Date.now }: { db: DatabaseSync; now?: () => number }) => {
  db.exec(SCHEMA);
  const columns = db.prepare("PRAGMA table_info(markers)").all() as { name: string }[];
  if (!columns.some((c) => c.name === "word")) db.exec("ALTER TABLE markers ADD COLUMN word INTEGER NOT NULL DEFAULT 1");

  return {
    async get({ bookId }: { bookId: string }): Promise<LastRead | null> {
      const row = db
        .prepare(
          `SELECT p.position, m.line, m.word, m.set_at FROM markers m
           JOIN pages p ON p.book_id = m.book_id AND p.file_id = m.file_id
           WHERE m.book_id = ?`,
        )
        .get(bookId) as { position: number; line: number; word: number; set_at: number } | undefined;
      return row ? { position: row.position, line: row.line, word: row.word, setAt: row.set_at } : null;
    },

    async set({ bookId, position, line, word }: { bookId: string; position: number; line: number; word: number }): Promise<void> {
      const row = db.prepare("SELECT file_id, matn FROM pages WHERE book_id = ? AND position = ?").get(bookId, position) as
        | { file_id: string; matn: string }
        | undefined;
      if (!row) throw new Error(`Book ${bookId} has no page ${position} in the library.`);
      const matn = JSON.parse(row.matn) as MatnBlock[];
      const block = matn.find((b) => b.line === line);
      if (!block) throw new Error(`Page ${position} has no matn line ${line}.`);
      const count = wordsOf(block.text).length;
      if (word < 1 || word > count) throw new Error(`Matn line ${line} has ${count} words; there is no word ${word}.`);
      db.prepare(
        `INSERT INTO markers (book_id, file_id, line, word, set_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (book_id) DO UPDATE SET file_id = excluded.file_id, line = excluded.line, word = excluded.word, set_at = excluded.set_at`,
      ).run(bookId, row.file_id, line, word, now());
    },

    async clear({ bookId }: { bookId: string }): Promise<void> {
      db.prepare("DELETE FROM markers WHERE book_id = ?").run(bookId);
    },
  };
};

export type Markers = ReturnType<typeof createMarkers>;
