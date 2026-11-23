import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  type Author,
  type BookMarks,
  compareSpans,
  type Highlight,
  type HighlightColor,
  type LetterRef,
  lineSpan,
  lineText,
  type Note,
  type NoteTarget,
  type PageAnnotations,
  type PageNote,
  quoteSpan,
  type Span,
  spanContains,
  type UserHarakat,
  wordsOf,
} from "../shared/annotations";
import { isArabicLetter, lettersOf, normalizeMarks } from "../shared/harakat";
import { type Page, parsePage } from "../shared/page";

/**
 * Highlights and notes, stored against the page's corpus file so they stay on
 * the right page when a sync renumbers the book. Requires the library's schema.
 */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS highlights (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  file_id TEXT NOT NULL,
  span TEXT NOT NULL,
  quote TEXT NOT NULL,
  color TEXT NOT NULL,
  author TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (book_id, file_id) REFERENCES pages (book_id, file_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS highlights_by_page ON highlights (book_id, file_id);
CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  file_id TEXT NOT NULL,
  span TEXT NOT NULL,
  quote TEXT NOT NULL,
  body TEXT NOT NULL,
  author TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (book_id, file_id) REFERENCES pages (book_id, file_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS notes_by_page ON notes (book_id, file_id);
CREATE TABLE IF NOT EXISTS harakat (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  file_id TEXT NOT NULL,
  part TEXT NOT NULL,
  line INTEGER NOT NULL,
  word INTEGER NOT NULL,
  letter INTEGER NOT NULL,
  marks TEXT NOT NULL,
  base TEXT NOT NULL,
  author TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (book_id, file_id, part, line, word, letter),
  FOREIGN KEY (book_id, file_id) REFERENCES pages (book_id, file_id) ON DELETE CASCADE
);
`;

interface AnchoredRow {
  id: string;
  book_id: string;
  span: string;
  quote: string;
  author: Author;
  created_at: number;
}
type HighlightRow = AnchoredRow & { color: HighlightColor };
type NoteRow = AnchoredRow & { kind: "words" | "line" | "page"; body: string; updated_at: number };

interface HarakatRow {
  id: string;
  book_id: string;
  part: LetterRef["part"];
  line: number;
  word: number;
  letter: number;
  marks: string;
  base: string;
  author: Author;
  created_at: number;
}

interface PageRow {
  file_id: string;
  position: number;
  source: string;
}

const toPage = (row: PageRow): Page => parsePage(row.source);

const isStale = ({ page, span, quote }: { page: Page; span: Span; quote: string }): boolean => {
  try {
    return quoteSpan({ page, span }) !== quote;
  } catch {
    return true;
  }
};

const wordAt = ({ page, ref }: { page: Page; ref: LetterRef }): string | undefined => {
  const text = lineText({ page, part: ref.part, line: ref.line });
  return text === null ? undefined : wordsOf(text)[ref.word - 1];
};

/** The base letter at a LetterRef, or null when the page has no such letter. */
const letterAt = ({ page, ref }: { page: Page; ref: LetterRef }): string | null => {
  const word = wordAt({ page, ref });
  return (word && lettersOf(word)[ref.letter - 1]?.base) ?? null;
};


const describeRef = (ref: LetterRef) => `${ref.part} line ${ref.line}, word ${ref.word}, letter ${ref.letter}`;

const requireBody = (body: string): string => {
  const trimmed = body.trim();
  if (!trimmed) throw new Error("A note needs some text. Delete the note instead of emptying it.");
  return trimmed;
};

export const createAnnotations = ({ db, now = Date.now }: { db: DatabaseSync; now?: () => number }) => {
  db.exec(SCHEMA);
  const noteColumns = db.prepare("PRAGMA table_info(notes)").all() as unknown as { name: string }[];
  // Page notes have no words: their span and quote are stored as "null" and "".
  if (!noteColumns.some((c) => c.name === "kind")) db.exec("ALTER TABLE notes ADD COLUMN kind TEXT NOT NULL DEFAULT 'words'");

  const pageAt = ({ bookId, position }: { bookId: string; position: number }): PageRow => {
    const row = db
      .prepare("SELECT file_id, position, source FROM pages WHERE book_id = ? AND position = ?")
      .get(bookId, position) as unknown as PageRow | undefined;
    if (!row) throw new Error(`Book ${bookId} has no page ${position} in the library.`);
    return row;
  };

  const anchored = ({ row, page, position }: { row: AnchoredRow; page: Page; position: number }) => {
    const span = JSON.parse(row.span) as Span;
    return {
      id: row.id,
      bookId: row.book_id,
      position,
      span,
      quote: row.quote,
      stale: isStale({ page, span, quote: row.quote }),
      author: row.author,
      createdAt: row.created_at,
    };
  };

  const deleteOne = ({ table, id, label }: { table: "highlights" | "notes"; id: string; label: string }) => {
    const { changes } = db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
    if (changes === 0) throw new Error(`There is no ${label} with id ${id}.`);
  };

  return {
    async listForPage({ bookId, position }: { bookId: string; position: number }): Promise<PageAnnotations> {
      const row = pageAt({ bookId, position });
      const page = toPage(row);
      const highlights = (
        db.prepare("SELECT * FROM highlights WHERE book_id = ? AND file_id = ?").all(bookId, row.file_id) as unknown as HighlightRow[]
      ).map((h): Highlight => ({ ...anchored({ row: h, page, position }), color: h.color }));
      const noteRows = db.prepare("SELECT * FROM notes WHERE book_id = ? AND file_id = ?").all(bookId, row.file_id) as unknown as NoteRow[];
      const notes = noteRows.flatMap((n): Note[] =>
        n.kind === "page" ? [] : [{ ...anchored({ row: n, page, position }), kind: n.kind, body: n.body, updatedAt: n.updated_at }],
      );
      const pageRow = noteRows.find((n) => n.kind === "page");
      const pageNote: PageNote | null = pageRow
        ? { id: pageRow.id, bookId, position, body: pageRow.body, author: pageRow.author, createdAt: pageRow.created_at, updatedAt: pageRow.updated_at }
        : null;
      const inReadingOrder = (a: { span: Span; createdAt: number }, b: { span: Span; createdAt: number }) =>
        compareSpans(a.span, b.span) || a.createdAt - b.createdAt;
      const harakat = (
        db
          .prepare("SELECT * FROM harakat WHERE book_id = ? AND file_id = ? ORDER BY part, line, word, letter")
          .all(bookId, row.file_id) as unknown as HarakatRow[]
      ).map(
        (h): UserHarakat => ({
          id: h.id,
          bookId,
          position,
          part: h.part,
          line: h.line,
          word: h.word,
          letter: h.letter,
          marks: h.marks,
          base: h.base,
          stale: letterAt({ page, ref: h }) !== h.base,
          author: h.author,
          createdAt: h.created_at,
        }),
      );
      return { highlights: highlights.sort(inReadingOrder), notes: notes.sort(inReadingOrder), pageNote, harakat };
    },

    /** Which pages of a book have highlights (with the newest one's colour) and notes, for the scrubber's dots. */
    async bookMarks({ bookId }: { bookId: string }): Promise<BookMarks> {
      const highlightRows = db
        .prepare(
          `SELECT p.position, h.color FROM highlights h JOIN pages p ON p.book_id = h.book_id AND p.file_id = h.file_id
           WHERE h.book_id = ? ORDER BY p.position, h.created_at DESC`,
        )
        .all(bookId) as unknown as { position: number; color: HighlightColor }[];
      const noteRows = db
        .prepare(
          `SELECT DISTINCT p.position FROM notes n JOIN pages p ON p.book_id = n.book_id AND p.file_id = n.file_id
           WHERE n.book_id = ? ORDER BY p.position`,
        )
        .all(bookId) as unknown as { position: number }[];
      const pageNoteRows = db
        .prepare(
          `SELECT p.position FROM notes n JOIN pages p ON p.book_id = n.book_id AND p.file_id = n.file_id
           WHERE n.book_id = ? AND n.kind = 'page' ORDER BY p.position`,
        )
        .all(bookId) as unknown as { position: number }[];
      const highlights = highlightRows.filter((h, i) => h.position !== highlightRows[i - 1]?.position);
      return {
        highlights: highlights.map((h) => ({ position: h.position, color: h.color })),
        notes: noteRows.map((n) => n.position),
        pageNotes: pageNoteRows.map((n) => n.position),
      };
    },

    async addHighlight({
      bookId,
      position,
      span,
      color,
      author = "me",
    }: {
      bookId: string;
      position: number;
      span: Span;
      color: HighlightColor;
      author?: Author;
    }): Promise<Highlight> {
      const row = pageAt({ bookId, position });
      const quote = quoteSpan({ page: toPage(row), span });
      const highlight: Highlight = { id: randomUUID(), bookId, position, span, quote, stale: false, color, author, createdAt: now() };
      db.prepare(
        "INSERT INTO highlights (id, book_id, file_id, span, quote, color, author, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(highlight.id, bookId, row.file_id, JSON.stringify(span), quote, color, author, highlight.createdAt);
      return highlight;
    },

    async removeHighlight({ id }: { id: string }): Promise<void> {
      deleteOne({ table: "highlights", id, label: "highlight" });
    },

    /** Adds a note on some words, a whole line, or the page. A page has at most one page note. */
    async addNote({
      bookId,
      position,
      body,
      author = "me",
      ...target
    }: NoteTarget & {
      bookId: string;
      position: number;
      body: string;
      author?: Author;
    }): Promise<Note | PageNote> {
      const text = requireBody(body);
      const row = pageAt({ bookId, position });
      const at = now();
      const insert = db.prepare(
        "INSERT INTO notes (id, book_id, file_id, kind, span, quote, body, author, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      );
      if ("page" in target) {
        const existing = db.prepare("SELECT id FROM notes WHERE book_id = ? AND file_id = ? AND kind = 'page'").get(bookId, row.file_id) as { id: string } | undefined;
        if (existing) throw new Error(`Page ${position} already has a page note (${existing.id}). Update it instead.`);
        const note: PageNote = { id: randomUUID(), bookId, position, body: text, author, createdAt: at, updatedAt: at };
        insert.run(note.id, bookId, row.file_id, "page", "null", "", text, author, at, at);
        return note;
      }
      const page = toPage(row);
      const kind = "line" in target ? "line" : "words";
      const span = "line" in target ? lineSpan({ page, ...target.line }) : target.span;
      if (!span) throw new Error(`That line of page ${position} has no words to note.`);
      const quote = quoteSpan({ page, span });
      const note: Note = { id: randomUUID(), bookId, position, kind, span, quote, stale: false, body: text, author, createdAt: at, updatedAt: at };
      insert.run(note.id, bookId, row.file_id, kind, JSON.stringify(span), quote, text, author, at, at);
      return note;
    },

    async updateNote({ id, body }: { id: string; body: string }): Promise<void> {
      const text = requireBody(body);
      const { changes } = db.prepare("UPDATE notes SET body = ?, updated_at = ? WHERE id = ?").run(text, now(), id);
      if (changes === 0) throw new Error(`There is no note with id ${id}.`);
    },

    async deleteNote({ id }: { id: string }): Promise<void> {
      deleteOne({ table: "notes", id, label: "note" });
    },

    /** Sets the reader's marks on one letter, replacing any marks they already put there. */
    async setHarakat({
      bookId,
      position,
      marks,
      author = "me",
      ...ref
    }: LetterRef & { bookId: string; position: number; marks: string; author?: Author }): Promise<void> {
      const normalized = normalizeMarks(marks);
      const row = pageAt({ bookId, position });
      const base = letterAt({ page: toPage(row), ref });
      if (base === null) throw new Error(`Page ${position} has no letter at ${describeRef(ref)}.`);
      if (!isArabicLetter(base)) {
        const word = wordAt({ page: toPage(row), ref });
        const first = word ? lettersOf(word).findIndex((l) => isArabicLetter(l.base)) : -1;
        const hint = first === -1 ? "" : ` The word's first Arabic letter is letter ${first + 1}.`;
        throw new Error(`"${base}" is not an Arabic letter, so it can't take harakat (${describeRef(ref)}).${hint}`);
      }
      db.prepare(
        `INSERT INTO harakat (id, book_id, file_id, part, line, word, letter, marks, base, author, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (book_id, file_id, part, line, word, letter)
         DO UPDATE SET marks = excluded.marks, base = excluded.base, author = excluded.author`,
      ).run(randomUUID(), bookId, row.file_id, ref.part, ref.line, ref.word, ref.letter, normalized, base, author, now());
    },

    async removeHarakat({ bookId, position, ...ref }: LetterRef & { bookId: string; position: number }): Promise<void> {
      const row = pageAt({ bookId, position });
      const { changes } = db
        .prepare("DELETE FROM harakat WHERE book_id = ? AND file_id = ? AND part = ? AND line = ? AND word = ? AND letter = ?")
        .run(bookId, row.file_id, ref.part, ref.line, ref.word, ref.letter);
      if (changes === 0) throw new Error(`There are no harakat of yours at ${describeRef(ref)} on page ${position}.`);
    },

    /**
     * Removes every mark the reader or the agent put on letters inside the span, in one go.
     * Returns what it removed so it can be put back. Marks on letters a sync replaced are left alone.
     */
    async clearHarakat({ bookId, position, span }: { bookId: string; position: number; span: Span }): Promise<{ ref: LetterRef; marks: string }[]> {
      const row = pageAt({ bookId, position });
      const page = toPage(row);
      quoteSpan({ page, span });
      const inSpan = (db.prepare("SELECT * FROM harakat WHERE book_id = ? AND file_id = ? AND part = ? ORDER BY line, word, letter").all(bookId, row.file_id, span.part) as unknown as HarakatRow[])
        .filter((h) => spanContains({ span, part: h.part, ref: h }) && letterAt({ page, ref: h }) === h.base);
      const remove = db.prepare("DELETE FROM harakat WHERE id = ?");
      db.exec("BEGIN");
      try {
        for (const h of inSpan) remove.run(h.id);
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
      return inSpan.map((h) => ({ ref: { part: h.part, line: h.line, word: h.word, letter: h.letter }, marks: h.marks }));
    },
  };
};

export type Annotations = ReturnType<typeof createAnnotations>;
