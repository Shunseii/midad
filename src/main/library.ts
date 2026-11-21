import type { DatabaseSync } from "node:sqlite";
import type { ExportFile } from "../shared/corpus";
import type {
  BookDetail,
  ImportResult,
  LibraryBook,
  ScrollAnchor,
  StoredPage,
  SyncPreview,
  SyncResult,
} from "../shared/library";
import { type Gloss, type GlossCorrection, type GlossKey, type Page, parsePage, withGlossCorrections } from "../shared/page";
import type { CorpusSource } from "./corpus";

/**
 * Midad's local library: imported books and their parsed pages. This is the
 * source of truth for reading, agent tools and Ask AI. Only importBook,
 * previewSync and syncBook talk to the corpus.
 *
 * Pages are parsed from `source` whenever they're read, so a parser fix reaches
 * every stored page without a migration. The `header`, `matn` and `hashiya`
 * columns keep the parse from import time and nothing reads them.
 */

/** Enough of a first line to fill the scrubber preview; the rest is cut off anyway. */
const FIRST_LINE_MAX = 160;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS books (
  book_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  author TEXT,
  edition TEXT,
  imported_at INTEGER NOT NULL,
  synced_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS pages (
  book_id TEXT NOT NULL REFERENCES books(book_id) ON DELETE CASCADE,
  file_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  number INTEGER,
  order_hint INTEGER,
  header TEXT,
  matn TEXT NOT NULL,
  hashiya TEXT NOT NULL,
  source TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (book_id, file_id)
);
CREATE INDEX IF NOT EXISTS pages_by_position ON pages (book_id, position);
CREATE TABLE IF NOT EXISTS progress (
  book_id TEXT PRIMARY KEY REFERENCES books(book_id) ON DELETE CASCADE,
  file_id TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  anchor TEXT
);
`;

/**
 * The reader's corrections of which words a gloss explains. Keyed by the page's corpus
 * file and where the book places the gloss, so a sync that rewrites the page keeps them.
 */
const GLOSS_CORRECTIONS = `
CREATE TABLE IF NOT EXISTS gloss_corrections (
  book_id TEXT NOT NULL,
  file_id TEXT NOT NULL,
  part TEXT NOT NULL,
  line INTEGER NOT NULL,
  book_from INTEGER NOT NULL,
  book_to INTEGER NOT NULL,
  text TEXT NOT NULL,
  word_from INTEGER NOT NULL,
  word_to INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (book_id, file_id, part, line, book_from, book_to, text),
  FOREIGN KEY (book_id, file_id) REFERENCES pages (book_id, file_id) ON DELETE CASCADE
);
`;

interface GlossCorrectionRow {
  part: Gloss["part"];
  line: number;
  book_from: number;
  book_to: number;
  text: string;
  word_from: number;
  word_to: number;
}

const toCorrection = (r: GlossCorrectionRow): GlossCorrection => ({
  part: r.part,
  line: r.line,
  book: { from: r.book_from, to: r.book_to },
  text: r.text,
  from: r.word_from,
  to: r.word_to,
});


const addProgressAnchor = (db: DatabaseSync) => {
  const columns = db.prepare("PRAGMA table_info(progress)").all() as { name: string }[];
  if (!columns.some((c) => c.name === "anchor")) db.exec("ALTER TABLE progress ADD COLUMN anchor TEXT");
};

const isScrollAnchor = (value: unknown): value is ScrollAnchor => {
  if (typeof value !== "object" || value === null) return false;
  const { part, line, word, offset } = value as Record<string, unknown>;
  return (part === "matn" || part === "hashiya") && Number.isInteger(line) && Number.isInteger(word) && typeof offset === "number" && Number.isFinite(offset);
};

const parseAnchor = (raw: string | null): ScrollAnchor | null => {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return isScrollAnchor(value) ? value : null;
  } catch {
    return null;
  }
};

/**
 * Progress used to be stored by page position, which a sync renumbers. Re-key each row by the
 * page at that position, or the nearest page if the position is out of range.
 */
const migrateProgressToFileId = (db: DatabaseSync) => {
  const columns = db.prepare("PRAGMA table_info(progress)").all() as { name: string }[];
  if (columns.some((c) => c.name === "file_id")) return;
  const rows = db.prepare("SELECT book_id, position, updated_at FROM progress").all() as {
    book_id: string;
    position: number;
    updated_at: number;
  }[];
  const nearestPage = db.prepare(
    "SELECT file_id FROM pages WHERE book_id = ? ORDER BY ABS(position - ?), position LIMIT 1",
  );
  db.exec("BEGIN");
  try {
    db.exec(`CREATE TABLE progress_by_page (
      book_id TEXT PRIMARY KEY REFERENCES books(book_id) ON DELETE CASCADE,
      file_id TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )`);
    const insert = db.prepare("INSERT INTO progress_by_page (book_id, file_id, updated_at) VALUES (?, ?, ?)");
    for (const row of rows) {
      const page = nearestPage.get(row.book_id, row.position) as { file_id: string } | undefined;
      if (page) insert.run(row.book_id, page.file_id, row.updated_at);
    }
    db.exec("DROP TABLE progress");
    db.exec("ALTER TABLE progress_by_page RENAME TO progress");
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
};

interface PageRow {
  book_id: string;
  file_id: string;
  position: number;
  number: number | null;
  order_hint: number | null;
  header: string | null;
  matn: string;
  hashiya: string;
  source: string;
}

interface BookRow {
  book_id: string;
  title: string;
  author: string | null;
  edition: string | null;
  imported_at: number;
  synced_at: number;
  page_count: number;
  progress_position: number | null;
  progress_updated_at: number | null;
  progress_anchor: string | null;
}

const byCorpusOrder = (
  a: { number: number | null; orderHint: number | null; fileId: string },
  b: { number: number | null; orderHint: number | null; fileId: string },
): number => {
  const nullsLast = (x: number | null, y: number | null) =>
    x === y ? 0 : x === null ? 1 : y === null ? -1 : x - y;
  return nullsLast(a.number, b.number) || nullsLast(a.orderHint, b.orderHint) || a.fileId.localeCompare(b.fileId);
};

const hasText = (f: ExportFile): f is ExportFile & { text: string } => typeof f.text === "string" && f.text.trim().length > 0;

export const createLibrary = ({
  db,
  corpus,
  now = Date.now,
}: {
  db: DatabaseSync;
  corpus: CorpusSource;
  now?: () => number;
}) => {
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);
  db.exec(GLOSS_CORRECTIONS);
  migrateProgressToFileId(db);
  addProgressAnchor(db);

  const transaction = <T>(fn: () => T): T => {
    db.exec("BEGIN");
    try {
      const result = fn();
      db.exec("COMMIT");
      return result;
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  };

  const insertPage = db.prepare(
    `INSERT INTO pages (book_id, file_id, position, number, order_hint, header, matn, hashiya, source, updated_at)
     VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const updatePage = db.prepare(
    `UPDATE pages SET number = ?, order_hint = ?, header = ?, matn = ?, hashiya = ?, source = ?, updated_at = ?
     WHERE book_id = ? AND file_id = ?`,
  );

  const writePage = (bookId: string, f: ExportFile & { text: string }, mode: "insert" | "update") => {
    const page = parsePage(f.text);
    const fields = [JSON.stringify(page.matn), JSON.stringify(page.hashiya), f.text, now()] as const;
    if (mode === "insert") {
      insertPage.run(bookId, f.file_id, f.page_number, f.order_hint, page.header, ...fields);
    } else {
      updatePage.run(f.page_number, f.order_hint, page.header, ...fields, bookId, f.file_id);
    }
  };

  const renumber = (bookId: string) => {
    const rows = db
      .prepare("SELECT file_id, number, order_hint FROM pages WHERE book_id = ?")
      .all(bookId) as unknown as Pick<PageRow, "file_id" | "number" | "order_hint">[];
    const ordered = rows
      .map((r) => ({ fileId: r.file_id, number: r.number, orderHint: r.order_hint }))
      .sort(byCorpusOrder);
    const setPosition = db.prepare("UPDATE pages SET position = ? WHERE book_id = ? AND file_id = ?");
    ordered.forEach((p, i) => setPosition.run(i + 1, bookId, p.fileId));
  };

  const corrections = ({ bookId, fileId }: { bookId: string; fileId: string }): GlossCorrection[] =>
    (
      db
        .prepare("SELECT part, line, book_from, book_to, text, word_from, word_to FROM gloss_corrections WHERE book_id = ? AND file_id = ?")
        .all(bookId, fileId) as unknown as GlossCorrectionRow[]
    ).map(toCorrection);

  const readPage = ({ bookId, fileId, source }: { bookId: string; fileId: string; source: string }): Page =>
    withGlossCorrections({ page: parsePage(source), corrections: corrections({ bookId, fileId }) });

  /** The page row and the book's own gloss a key names; throws when either is missing. */
  const glossAt = ({ bookId, position, key }: { bookId: string; position: number; key: GlossKey }) => {
    const row = db.prepare("SELECT file_id, source FROM pages WHERE book_id = ? AND position = ?").get(bookId, position) as
      | Pick<PageRow, "file_id" | "source">
      | undefined;
    if (!row) throw new Error(`Book ${bookId} has no page ${position} in the library.`);
    const page = parsePage(row.source);
    const gloss = page.glosses.find(
      (g) => g.part === key.part && g.line === key.line && g.text === key.text && g.from === key.book.from && g.to === key.book.to,
    );
    if (!gloss) throw new Error(`Page ${position} has no gloss "${key.text}" on ${key.part} line ${key.line}.`);
    return { fileId: row.file_id, page };
  };

  const deleteCorrection = ({ bookId, fileId, key }: { bookId: string; fileId: string; key: GlossKey }) =>
    db
      .prepare("DELETE FROM gloss_corrections WHERE book_id = ? AND file_id = ? AND part = ? AND line = ? AND book_from = ? AND book_to = ? AND text = ?")
      .run(bookId, fileId, key.part, key.line, key.book.from, key.book.to, key.text);

  const localPages = (bookId: string) =>
    db.prepare("SELECT file_id, position, source FROM pages WHERE book_id = ?").all(bookId) as unknown as Pick<
      PageRow,
      "file_id" | "position" | "source"
    >[];

  const bookExists = (bookId: string) =>
    db.prepare("SELECT 1 FROM books WHERE book_id = ?").get(bookId) !== undefined;

  const toBook = (r: BookRow): LibraryBook => ({
    bookId: r.book_id,
    title: r.title,
    author: r.author,
    edition: r.edition,
    pageCount: r.page_count,
    importedAt: r.imported_at,
    syncedAt: r.synced_at,
    progress:
      r.progress_position === null || r.progress_updated_at === null
        ? null
        : { position: r.progress_position, updatedAt: r.progress_updated_at, anchor: parseAnchor(r.progress_anchor) },
  });

  const BOOK_SELECT = `
    SELECT b.*, (SELECT COUNT(*) FROM pages p WHERE p.book_id = b.book_id) AS page_count,
           pp.position AS progress_position, pr.updated_at AS progress_updated_at,
           pr.anchor AS progress_anchor
    FROM books b
    LEFT JOIN progress pr ON pr.book_id = b.book_id
    LEFT JOIN pages pp ON pp.book_id = pr.book_id AND pp.file_id = pr.file_id`;

  const previewFrom = (bookId: string, files: ExportFile[]): SyncPreview => {
    const local = new Map(localPages(bookId).map((p) => [p.file_id, p]));
    const ready = files.filter(hasText);
    return {
      newPages: ready.filter((f) => !local.has(f.file_id)).map((f) => ({ fileId: f.file_id, number: f.page_number })),
      changedPages: ready.flatMap((f) => {
        const mine = local.get(f.file_id);
        return mine && mine.source !== f.text
          ? [{ fileId: f.file_id, number: f.page_number, position: mine.position }]
          : [];
      }),
      pending: files.length - ready.length,
    };
  };

  return {
    async importBook({ corpusBookId }: { corpusBookId: string }): Promise<ImportResult> {
      if (bookExists(corpusBookId)) {
        throw new Error(`Book ${corpusBookId} is already imported. Sync it to pull changes from the corpus.`);
      }
      const [meta, files] = await Promise.all([corpus.getBook(corpusBookId), corpus.exportBook(corpusBookId)]);
      const ready = files.filter(hasText);
      transaction(() => {
        const at = now();
        db.prepare(
          "INSERT INTO books (book_id, title, author, edition, imported_at, synced_at) VALUES (?, ?, ?, ?, ?, ?)",
        ).run(
          corpusBookId,
          meta.work?.name ?? meta.title,
          meta.work?.author ?? null,
          meta.work && meta.work.name !== meta.title ? meta.title : null,
          at,
          at,
        );
        for (const f of ready) writePage(corpusBookId, f, "insert");
        renumber(corpusBookId);
      });
      return { bookId: corpusBookId, imported: ready.length, pending: files.length - ready.length };
    },

    async previewSync({ bookId }: { bookId: string }): Promise<SyncPreview> {
      return previewFrom(bookId, await corpus.exportBook(bookId));
    },

    async syncBook(
      input: { bookId: string; mode: "new" } | { bookId: string; mode: "overwrite"; fileIds: string[] },
    ): Promise<SyncResult> {
      const { bookId } = input;
      if (!bookExists(bookId)) throw new Error(`Book ${bookId} is not in the library.`);
      const files = await corpus.exportBook(bookId);
      const preview = previewFrom(bookId, files);
      const byId = new Map(files.filter(hasText).map((f) => [f.file_id, f]));

      return transaction(() => {
        let added = 0;
        let overwritten = 0;
        if (input.mode === "new") {
          for (const { fileId } of preview.newPages) {
            const f = byId.get(fileId);
            if (f) {
              writePage(bookId, f, "insert");
              added += 1;
            }
          }
        } else {
          const local = new Set(localPages(bookId).map((p) => p.file_id));
          for (const fileId of input.fileIds) {
            const f = byId.get(fileId);
            if (f && local.has(fileId)) {
              writePage(bookId, f, "update");
              overwritten += 1;
            }
          }
        }
        renumber(bookId);
        db.prepare("UPDATE books SET synced_at = ? WHERE book_id = ?").run(now(), bookId);
        return { added, overwritten, pending: preview.pending };
      });
    },

    async listBooks(): Promise<LibraryBook[]> {
      const rows = db.prepare(`${BOOK_SELECT} ORDER BY COALESCE(pr.updated_at, b.imported_at) DESC`).all();
      return (rows as unknown as BookRow[]).map(toBook);
    },

    async getBook(bookId: string): Promise<BookDetail | null> {
      const row = db.prepare(`${BOOK_SELECT} WHERE b.book_id = ?`).get(bookId) as unknown as BookRow | undefined;
      if (!row) return null;
      const pages = db
        .prepare("SELECT file_id, position, number, source FROM pages WHERE book_id = ? ORDER BY position")
        .all(bookId) as unknown as Pick<PageRow, "file_id" | "position" | "number" | "source">[];
      return {
        ...toBook(row),
        pages: pages.map((p) => {
          const page = parsePage(p.source);
          return {
            position: p.position,
            number: p.number,
            fileId: p.file_id,
            header: page.header,
            headings: page.matn.flatMap((b) => (b.kind === "heading" ? [{ text: b.text, level: b.level }] : [])),
          };
        }),
      };
    },

    async getPage({ bookId, position }: { bookId: string; position: number }): Promise<StoredPage | null> {
      const row = db
        .prepare("SELECT * FROM pages WHERE book_id = ? AND position = ?")
        .get(bookId, position) as unknown as PageRow | undefined;
      if (!row) return null;
      return {
        bookId,
        position: row.position,
        number: row.number,
        fileId: row.file_id,
        page: readPage({ bookId, fileId: row.file_id, source: row.source }),
      };
    },

    /** Moves a gloss to other words of its line. Moving it back to the book's own words removes the correction. */
    async correctGloss({ bookId, position, key, from, to }: { bookId: string; position: number; key: GlossKey; from: number; to: number }): Promise<void> {
      const { fileId, page } = glossAt({ bookId, position, key });
      const text = key.part === "matn" ? page.matn.find((b) => b.line === key.line)?.text : page.hashiya[key.line - 1]?.text;
      const words = (text ?? "").split(/\s+/).filter(Boolean).length;
      if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from || to > words) {
        throw new Error(`A gloss on ${key.part} line ${key.line} covers words 1–${words}, not ${from}–${to}.`);
      }
      if (from === key.book.from && to === key.book.to) {
        deleteCorrection({ bookId, fileId, key });
        return;
      }
      db.prepare(
        `INSERT INTO gloss_corrections (book_id, file_id, part, line, book_from, book_to, text, word_from, word_to, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (book_id, file_id, part, line, book_from, book_to, text)
         DO UPDATE SET word_from = excluded.word_from, word_to = excluded.word_to, updated_at = excluded.updated_at`,
      ).run(bookId, fileId, key.part, key.line, key.book.from, key.book.to, key.text, from, to, now());
    },

    /** Puts a gloss back on the words the book gives it. */
    async resetGloss({ bookId, position, key }: { bookId: string; position: number; key: GlossKey }): Promise<void> {
      deleteCorrection({ bookId, fileId: glossAt({ bookId, position, key }).fileId, key });
    },

    /** The page's first line of main text, for the scrubber's preview; null when the page has none. */
    async getFirstLine({ bookId, position }: { bookId: string; position: number }): Promise<string | null> {
      const row = db.prepare("SELECT source FROM pages WHERE book_id = ? AND position = ?").get(bookId, position) as
        | Pick<PageRow, "source">
        | undefined;
      if (!row) return null;
      const first = parsePage(row.source).matn.find((b) => b.kind === "paragraph" && b.text.trim());
      return first?.text.trim().split("\n")[0]?.trim().slice(0, FIRST_LINE_MAX) ?? null;
    },

    /**
     * Without an anchor, a save on the page already stored keeps its anchor, so
     * reopening a book doesn't forget where on the page the reader was.
     */
    async setProgress({ bookId, position, anchor }: { bookId: string; position: number; anchor?: ScrollAnchor }): Promise<void> {
      const page = db.prepare("SELECT file_id FROM pages WHERE book_id = ? AND position = ?").get(bookId, position) as
        | Pick<PageRow, "file_id">
        | undefined;
      if (!page) throw new Error(`Book ${bookId} has no page ${position} in the library.`);
      db.prepare(
        `INSERT INTO progress (book_id, file_id, updated_at, anchor) VALUES (?, ?, ?, ?)
         ON CONFLICT(book_id) DO UPDATE SET
           anchor = CASE WHEN excluded.anchor IS NULL AND progress.file_id = excluded.file_id THEN progress.anchor ELSE excluded.anchor END,
           file_id = excluded.file_id,
           updated_at = excluded.updated_at`,
      ).run(bookId, page.file_id, now(), anchor ? JSON.stringify(anchor) : null);
    },
  };
};

export type Library = ReturnType<typeof createLibrary>;
