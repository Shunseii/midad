import type { DatabaseSync } from "node:sqlite";
import type { ExportFile, FileState } from "../shared/corpus";
import type {
  BookDetail,
  ImportProgress,
  ImportResult,
  LibraryBook,
  ScrollAnchor,
  StoredPage,
  SyncPreview,
  SyncResult,
} from "../shared/library";
import { lineSpan, type Span } from "../shared/annotations";
import type { TextEdit } from "../shared/corpus";
import { bookIndex } from "../shared/fihris";
import type { SyncInput } from "../shared/ipc";
import { realignPage, type WordAt } from "../shared/realign";
import { parsePage } from "../shared/page";
import type { CorpusSource } from "./corpus";
import { openUserStore, textRev } from "./user-store";

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

const TRANSCRIBED: readonly FileState[] = ["done", "needs_review", "approved"];

/** A page to store: one with text, or one the corpus finished with nothing on it to transcribe (a blank page, or one left out by the book's instructions). */
const isReady = (f: ExportFile): f is ExportFile & { text: string } =>
  typeof f.text === "string" && (f.text.trim().length > 0 || TRANSCRIBED.includes(f.state));

export const createLibrary = ({
  db,
  corpus,
  now = Date.now,
  onRepinned,
}: {
  db: DatabaseSync;
  corpus: CorpusSource;
  now?: () => number;
  /** Called between moving the user store's pins and writing the new text: a seam for crash tests. */
  onRepinned?: () => void;
}) => {
  const user = openUserStore({ db });
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);
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

  const hasTable = (name: string) => db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !== undefined;

  /**
   * Moves what the reader pinned to words on a page (highlights, notes, harakat, the last-read
   * marker, the saved reading place) to the same words in its new text. Pins whose words can't be
   * followed stay where they were, for the "Text changed" check to flag.
   */
  const realignerFor = ({ before, after, edits }: { before: string; after: string; edits: TextEdit[] | null }) =>
    realignPage({ before: { source: before, page: parsePage(before) }, after: { source: after, page: parsePage(after) }, edits });

  /**
   * Moves the pins kept in the user store. Only rows pinned to the "before" text move, and each is
   * stamped with the "after" text's rev, so running it again (after a crash, or on another device
   * that already received the moved rows) moves nothing twice.
   */
  const repinUserStore = ({ bookId, fileId, before, after, edits }: { bookId: string; fileId: string; before: string; after: string; edits: TextEdit[] | null }) => {
    const realign = realignerFor({ before, after, edits });
    const [beforeRev, afterRev] = [textRev(before), textRev(after)];
    const pinnedBefore = (row: { textRev?: unknown }) => row.textRev === beforeRev || row.textRev === "" || row.textRev === undefined;
    user.store.transaction(() => {
      for (const [id, row] of user.rows({ table: "highlights", ids: user.onPage({ table: "highlights", bookId, fileId }) })) {
        if (!pinnedBefore(row)) continue;
        const moved = realign.span(JSON.parse(String(row.span)) as Span);
        if (moved) user.store.setCell("highlights", id, "span", JSON.stringify(moved));
        user.store.setCell("highlights", id, "textRev", afterRev);
      }
    });
  };

  const moveMarks = ({ bookId, fileId, before, after, edits }: { bookId: string; fileId: string; before: string; after: string; edits: TextEdit[] | null }) => {
    const realign = realignerFor({ before, after, edits });
    const afterPage = parsePage(after);
    for (const table of ["notes"]) {
      if (!hasTable(table)) continue;
      const kind = table === "notes" ? "kind" : "'words' AS kind";
      const rows = db.prepare(`SELECT id, span, ${kind} FROM ${table} WHERE book_id = ? AND file_id = ?`).all(bookId, fileId) as unknown as { id: string; span: string; kind: string }[];
      const update = db.prepare(`UPDATE ${table} SET span = ? WHERE id = ?`);
      for (const row of rows) {
        if (row.kind === "page") continue;
        const moved = realign.span(JSON.parse(row.span) as Span);
        // A line note keeps covering its whole line, wherever the line's words went.
        const span = moved && row.kind === "line" ? (lineSpan({ page: afterPage, part: moved.part, line: moved.start.line }) ?? moved) : moved;
        if (span) update.run(JSON.stringify(span), row.id);
      }
    }
    if (hasTable("harakat")) {
      const rows = db.prepare("SELECT id, part, line, word FROM harakat WHERE book_id = ? AND file_id = ?").all(bookId, fileId) as unknown as ({ id: string } & WordAt)[];
      const update = db.prepare("UPDATE OR REPLACE harakat SET part = ?, line = ?, word = ? WHERE id = ?");
      for (const row of rows) {
        const moved = realign.word(row);
        if (moved) update.run(moved.part, moved.line, moved.word, row.id);
      }
    }
    if (hasTable("markers")) {
      const row = db.prepare("SELECT part, line, word FROM markers WHERE book_id = ? AND file_id = ?").get(bookId, fileId) as unknown as WordAt | undefined;
      const moved = row && realign.word(row);
      if (moved) db.prepare("UPDATE markers SET part = ?, line = ?, word = ? WHERE book_id = ?").run(moved.part, moved.line, moved.word, bookId);
    }
    const progress = db.prepare("SELECT anchor FROM progress WHERE book_id = ? AND file_id = ?").get(bookId, fileId) as { anchor: string | null } | undefined;
    const anchor = progress?.anchor ? parseAnchor(progress.anchor) : null;
    const movedAnchor = anchor && realign.word(anchor);
    if (anchor && movedAnchor) db.prepare("UPDATE progress SET anchor = ? WHERE book_id = ?").run(JSON.stringify({ ...anchor, ...movedAnchor }), bookId);
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
    const ready = files.filter(isReady);
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
    async importBook({ corpusBookId, onProgress }: { corpusBookId: string; onProgress?: (progress: ImportProgress) => void }): Promise<ImportResult> {
      if (bookExists(corpusBookId)) {
        throw new Error(`Book ${corpusBookId} is already imported. Sync it to pull changes from the corpus.`);
      }
      const [meta, files] = await Promise.all([
        corpus.getBook(corpusBookId),
        corpus.exportBook(corpusBookId, { onProgress: (p) => onProgress?.({ phase: "downloading", ...p }) }),
      ]);
      onProgress?.({ phase: "saving" });
      // Lets the saving step reach the window before the write holds the main process.
      await new Promise((resolve) => setImmediate(resolve));
      const ready = files.filter(isReady);
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

    async syncBook(input: SyncInput): Promise<SyncResult> {
      const { bookId } = input;
      if (!bookExists(bookId)) throw new Error(`Book ${bookId} is not in the library.`);
      const files = await corpus.exportBook(bookId);
      const preview = previewFrom(bookId, files);
      const byId = new Map(files.filter(isReady).map((f) => [f.file_id, f]));

      // The user store's pins move first: if the process dies before the text is written, the next
      // sync sees the page still changed and moves only what is still pinned to the old text.
      if (input.mode === "overwrite") {
        const local = new Map(localPages(bookId).map((p) => [p.file_id, p.source]));
        for (const fileId of input.fileIds) {
          const f = byId.get(fileId);
          const before = local.get(fileId);
          if (f && before !== undefined && before !== f.text) repinUserStore({ bookId, fileId, before, after: f.text, edits: input.edits?.[fileId] ?? null });
        }
        onRepinned?.();
      }

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
          const local = new Map(localPages(bookId).map((p) => [p.file_id, p.source]));
          for (const fileId of input.fileIds) {
            const f = byId.get(fileId);
            const before = local.get(fileId);
            if (f && before !== undefined) {
              writePage(bookId, f, "update");
              if (before !== f.text) moveMarks({ bookId, fileId, before, after: f.text, edits: input.edits?.[fileId] ?? null });
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
      const parsed = pages.map((p) => ({ row: p, page: parsePage(p.source) }));
      return {
        ...toBook(row),
        pages: parsed.map(({ row: p, page }) => ({
          position: p.position,
          number: p.number,
          fileId: p.file_id,
          header: page.header,
          headings: page.matn.flatMap((b) => (b.kind === "heading" ? [{ text: b.text, level: b.level }] : [])),
        })),
        index: bookIndex(
          parsed.map(({ row: p, page }) => ({
            position: p.position,
            number: p.number,
            header: page.header,
            headings: page.matn.flatMap((b) => (b.kind === "heading" ? [b.text] : [])),
            lines: page.matn.flatMap((b) => (b.kind === "heading" ? [] : [b.text])),
          })),
        ),
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
        page: parsePage(row.source),
      };
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
