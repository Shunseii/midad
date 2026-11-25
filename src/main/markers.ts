import type { DatabaseSync } from "node:sqlite";
import type { LastRead } from "../shared/library";
import { lineText, type Part, wordsOf } from "../shared/annotations";
import { parsePage } from "../shared/page";
import { migrateLegacyTable, openUserStore, textRev } from "./user-store";

/**
 * One last-read marker per book, on a word of a matn or ḥāshiya line. The reader marks
 * the screen row that word is on, so the mark survives reflowing the text. Kept in the user store
 * against the page's corpus file so it stays on the right page when a sync renumbers the book.
 * Requires the library's schema.
 */

const legacyMarkers = (db: DatabaseSync) => {
  const columns = db.prepare("PRAGMA table_info(markers)").all() as { name: string }[];
  if (!columns.some((c) => c.name === "word")) db.exec("ALTER TABLE markers ADD COLUMN word INTEGER NOT NULL DEFAULT 1");
  if (!columns.some((c) => c.name === "part")) db.exec("ALTER TABLE markers ADD COLUMN part TEXT NOT NULL DEFAULT 'matn'");
  const rows = db.prepare("SELECT m.*, p.source FROM markers m LEFT JOIN pages p ON p.book_id = m.book_id AND p.file_id = m.file_id").all() as {
    book_id: string;
    file_id: string;
    part: Part;
    line: number;
    word: number;
    set_at: number;
    source: string | null;
  }[];
  return rows.map((m) => ({
    table: "markers" as const,
    id: m.book_id,
    row: { fileId: m.file_id, part: m.part, line: m.line, word: m.word, setAt: m.set_at, textRev: m.source === null ? "" : textRev(m.source) },
  }));
};

export const createMarkers = ({ db, now = Date.now }: { db: DatabaseSync; now?: () => number }) => {
  const user = openUserStore({ db });
  migrateLegacyTable({ user, db, table: "markers", rows: () => legacyMarkers(db) });

  return {
    async get({ bookId }: { bookId: string }): Promise<LastRead | null> {
      const marker = user.row({ table: "markers", id: bookId });
      if (!marker) return null;
      const page = db.prepare("SELECT position FROM pages WHERE book_id = ? AND file_id = ?").get(bookId, String(marker.fileId)) as { position: number } | undefined;
      return page
        ? { position: page.position, part: marker.part as Part, line: Number(marker.line), word: Number(marker.word), setAt: Number(marker.setAt) }
        : null;
    },

    async set({
      bookId,
      position,
      part = "matn",
      line,
      word,
    }: {
      bookId: string;
      position: number;
      part?: Part;
      line: number;
      word: number;
    }): Promise<void> {
      const row = db.prepare("SELECT file_id, source FROM pages WHERE book_id = ? AND position = ?").get(bookId, position) as
        | { file_id: string; source: string }
        | undefined;
      if (!row) throw new Error(`Book ${bookId} has no page ${position} in the library.`);
      const page = parsePage(row.source);
      const text = lineText({ page, part, line });
      const name = part === "matn" ? "matn" : "ḥāshiya";
      if (text === null) throw new Error(`Page ${position} has no ${name} line ${line}.`);
      const count = wordsOf(text).length;
      if (word < 1 || word > count) throw new Error(`The ${name} line ${line} has ${count} words; there is no word ${word}.`);
      user.rewriteRow({ table: "markers", id: bookId, row: { fileId: row.file_id, part, line, word, setAt: now(), textRev: textRev(row.source) } });
    },

    async clear({ bookId }: { bookId: string }): Promise<void> {
      user.store.delRow("markers", bookId);
    },
  };
};

export type Markers = ReturnType<typeof createMarkers>;
