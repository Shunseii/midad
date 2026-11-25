import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { Row } from "tinybase";
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
import { migrateLegacyTable, openUserStore, pageKey, textRev, type UserStore } from "./user-store";

/**
 * Highlights, notes and harakat, kept in the user store against the page's corpus file so they
 * stay on the right page when a sync renumbers the book. Requires the library's schema.
 */

interface AnchoredRow {
  id: string;
  book_id: string;
  span: string;
  quote: string;
  author: Author;
  created_at: number;
}

interface LegacyNoteRow extends AnchoredRow {
  file_id: string;
  kind: "words" | "line" | "page";
  body: string;
  updated_at: number;
  source: string | null;
}

interface LegacyHarakatRow {
  id: string;
  book_id: string;
  file_id: string;
  part: LetterRef["part"];
  line: number;
  word: number;
  letter: number;
  marks: string;
  base: string;
  author: Author;
  created_at: number;
  source: string | null;
}

interface PageRow {
  file_id: string;
  position: number;
  source: string;
}

/** A page has one page note, under this id on every device, so two devices adding it write one row. */
export const pageNoteId = ({ bookId, fileId }: { bookId: string; fileId: string }) => `${bookId}:${fileId}`;

const toPage = (row: PageRow): Page => parsePage(row.source);

const toAnchoredRow = ({ id, row }: { id: string; row: Row }): AnchoredRow => ({
  id,
  book_id: String(row.bookId),
  span: String(row.span),
  quote: String(row.quote),
  author: row.author as Author,
  created_at: Number(row.createdAt),
});

const toLetterRef = (row: Row): LetterRef => ({ part: row.part as LetterRef["part"], line: Number(row.line), word: Number(row.word), letter: Number(row.letter) });

const letterKey = (ref: { part?: unknown; line?: unknown; word?: unknown; letter?: unknown }) =>
  `${String(ref.part)}:${String(ref.line)}:${String(ref.word)}:${String(ref.letter)}`;

/** Newest first: the harakat a reader sees on a letter when two devices each set some. */
const newestFirst = ([idA, a]: [string, Row], [idB, b]: [string, Row]) => Number(b.updatedAt) - Number(a.updatedAt) || (idA < idB ? -1 : idA > idB ? 1 : 0);

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

const revOf = (source: string | null) => (source === null ? "" : textRev(source));

const legacyHighlights = (db: DatabaseSync) =>
  (
    db
      .prepare("SELECT h.*, p.source FROM highlights h LEFT JOIN pages p ON p.book_id = h.book_id AND p.file_id = h.file_id")
      .all() as unknown as (AnchoredRow & { file_id: string; color: string; source: string | null })[]
  ).map((h) => ({
    table: "highlights" as const,
    id: h.id,
    row: { bookId: h.book_id, fileId: h.file_id, span: h.span, quote: h.quote, color: h.color, author: h.author, createdAt: h.created_at, textRev: revOf(h.source) },
  }));

/** Notes from before the user store. Page notes take the page's own id, so a page note made on another device lands on the same row. */
const legacyNotes = (db: DatabaseSync) => {
  const columns = db.prepare("PRAGMA table_info(notes)").all() as unknown as { name: string }[];
  // Page notes have no words: their span and quote are stored as "null" and "".
  if (!columns.some((c) => c.name === "kind")) db.exec("ALTER TABLE notes ADD COLUMN kind TEXT NOT NULL DEFAULT 'words'");
  return (
    db.prepare("SELECT n.*, p.source FROM notes n LEFT JOIN pages p ON p.book_id = n.book_id AND p.file_id = n.file_id").all() as unknown as LegacyNoteRow[]
  ).map((n) => ({
    table: "notes" as const,
    id: n.kind === "page" ? pageNoteId({ bookId: n.book_id, fileId: n.file_id }) : n.id,
    row: {
      bookId: n.book_id,
      fileId: n.file_id,
      kind: n.kind,
      span: n.span,
      quote: n.quote,
      body: n.body,
      author: n.author,
      createdAt: n.created_at,
      updatedAt: n.updated_at,
      textRev: revOf(n.source),
    },
  }));
};

const legacyHarakat = (db: DatabaseSync) =>
  (db.prepare("SELECT h.*, p.source FROM harakat h LEFT JOIN pages p ON p.book_id = h.book_id AND p.file_id = h.file_id").all() as unknown as LegacyHarakatRow[]).map((h) => ({
    table: "harakat" as const,
    id: h.id,
    row: {
      bookId: h.book_id,
      fileId: h.file_id,
      part: h.part,
      line: h.line,
      word: h.word,
      letter: h.letter,
      marks: h.marks,
      base: h.base,
      author: h.author,
      createdAt: h.created_at,
      updatedAt: h.created_at,
      textRev: revOf(h.source),
    },
  }));

/** The harakat rows on a page, grouped by the letter they sit on, newest first. */
const harakatByLetter = ({ user, bookId, fileId }: { user: UserStore; bookId: string; fileId: string }) => {
  const byLetter = new Map<string, [string, Row][]>();
  for (const entry of user.rows({ table: "harakat", ids: user.onPage({ table: "harakat", bookId, fileId }) })) {
    const key = letterKey(entry[1]);
    byLetter.set(key, [...(byLetter.get(key) ?? []), entry]);
  }
  for (const rows of byLetter.values()) rows.sort(newestFirst);
  return byLetter;
};

/**
 * After a merge or a realignment, two harakat rows can sit on one letter (each device set its own,
 * or a realignment moved one onto another). The newest stays; the others are deleted. Every client
 * picks the same one, so the deletes agree.
 */
export const tidyHarakat = (user: UserStore) => {
  const byLetter = new Map<string, [string, Row][]>();
  for (const entry of user.rows({ table: "harakat" })) {
    const key = `${pageKey({ bookId: String(entry[1].bookId), fileId: String(entry[1].fileId) })}\u0000${letterKey(entry[1])}`;
    byLetter.set(key, [...(byLetter.get(key) ?? []), entry]);
  }
  const losers = [...byLetter.values()].flatMap((rows) => rows.sort(newestFirst).slice(1).map(([id]) => id));
  if (losers.length === 0) return 0;
  user.store.transaction(() => {
    for (const id of losers) user.store.delRow("harakat", id);
  });
  return losers.length;
};

export const createAnnotations = ({ db, now = Date.now }: { db: DatabaseSync; now?: () => number }) => {
  const user = openUserStore({ db });
  migrateLegacyTable({ user, db, table: "highlights", rows: () => legacyHighlights(db) });
  migrateLegacyTable({ user, db, table: "notes", rows: () => legacyNotes(db) });
  migrateLegacyTable({ user, db, table: "harakat", rows: () => legacyHarakat(db) });
  user.afterMerge({ name: "harakat", hook: () => tidyHarakat(user) });

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

  const positionsOf = (bookId: string) =>
    new Map((db.prepare("SELECT file_id, position FROM pages WHERE book_id = ?").all(bookId) as { file_id: string; position: number }[]).map((p) => [p.file_id, p.position]));

  const harakatAtLetter = ({ bookId, fileId, ref }: { bookId: string; fileId: string; ref: LetterRef }) =>
    harakatByLetter({ user, bookId, fileId }).get(letterKey(ref)) ?? [];

  return {
    async listForPage({ bookId, position }: { bookId: string; position: number }): Promise<PageAnnotations> {
      const row = pageAt({ bookId, position });
      const page = toPage(row);
      const onPage = (table: "highlights" | "notes") => user.rows({ table, ids: user.onPage({ table, bookId, fileId: row.file_id }) });
      const highlights = onPage("highlights").map(([id, h]): Highlight => ({ ...anchored({ row: toAnchoredRow({ id, row: h }), page, position }), color: h.color as HighlightColor }));
      const noteRows = onPage("notes");
      const notes = noteRows.flatMap(([id, n]): Note[] =>
        n.kind === "page"
          ? []
          : [{ ...anchored({ row: toAnchoredRow({ id, row: n }), page, position }), kind: n.kind as Note["kind"], body: String(n.body), updatedAt: Number(n.updatedAt) }],
      );
      const pageRow = noteRows.filter(([, n]) => n.kind === "page").sort(newestFirst)[0];
      const pageNote: PageNote | null = pageRow
        ? {
            id: pageRow[0],
            bookId,
            position,
            body: String(pageRow[1].body),
            author: pageRow[1].author as Author,
            createdAt: Number(pageRow[1].createdAt),
            updatedAt: Number(pageRow[1].updatedAt),
          }
        : null;
      const inReadingOrder = (a: { span: Span; createdAt: number }, b: { span: Span; createdAt: number }) => compareSpans(a.span, b.span) || a.createdAt - b.createdAt;
      const harakat = [...harakatByLetter({ user, bookId, fileId: row.file_id }).values()]
        .flatMap((rows) => rows.slice(0, 1))
        .map(
          ([id, h]): UserHarakat => ({
            id,
            bookId,
            position,
            ...toLetterRef(h),
            marks: String(h.marks),
            base: String(h.base),
            stale: letterAt({ page, ref: toLetterRef(h) }) !== h.base,
            author: h.author as Author,
            createdAt: Number(h.createdAt),
          }),
        )
        .sort((a, b) => (a.part < b.part ? -1 : a.part > b.part ? 1 : a.line - b.line || a.word - b.word || a.letter - b.letter));
      return { highlights: highlights.sort(inReadingOrder), notes: notes.sort(inReadingOrder), pageNote, harakat };
    },

    /** Which pages of a book have highlights (with the newest one's colour) and notes, for the scrubber's dots. */
    async bookMarks({ bookId }: { bookId: string }): Promise<BookMarks> {
      const positions = positionsOf(bookId);
      const placed = (table: "highlights" | "notes") =>
        user.rows({ table }).flatMap(([, row]) => {
          const position = row.bookId === bookId ? positions.get(String(row.fileId)) : undefined;
          return position === undefined ? [] : [{ position, row }];
        });
      const highlightRows = placed("highlights").sort((a, b) => a.position - b.position || Number(b.row.createdAt) - Number(a.row.createdAt));
      const highlights = highlightRows.filter((h, i) => h.position !== highlightRows[i - 1]?.position);
      const notes = placed("notes");
      const distinct = (list: number[]) => [...new Set(list)].sort((a, b) => a - b);
      return {
        highlights: highlights.map((h) => ({ position: h.position, color: h.row.color as HighlightColor })),
        notes: distinct(notes.map((n) => n.position)),
        pageNotes: distinct(notes.filter((n) => n.row.kind === "page").map((n) => n.position)),
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
      user.store.setRow("highlights", highlight.id, {
        bookId,
        fileId: row.file_id,
        span: JSON.stringify(span),
        quote,
        color,
        author,
        createdAt: highlight.createdAt,
        textRev: textRev(row.source),
      });
      return highlight;
    },

    async removeHighlight({ id }: { id: string }): Promise<void> {
      if (!user.row({ table: "highlights", id })) throw new Error(`There is no highlight with id ${id}.`);
      user.store.delRow("highlights", id);
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
      const base = { bookId, fileId: row.file_id, body: text, author, createdAt: at, updatedAt: at, textRev: textRev(row.source) };
      if ("page" in target) {
        const id = pageNoteId({ bookId, fileId: row.file_id });
        const existing = user.rows({ table: "notes", ids: user.onPage({ table: "notes", bookId, fileId: row.file_id }) }).find(([, n]) => n.kind === "page");
        if (existing) throw new Error(`Page ${position} already has a page note (${existing[0]}). Update it instead.`);
        user.store.setRow("notes", id, { ...base, kind: "page", span: "null", quote: "" });
        return { id, bookId, position, body: text, author, createdAt: at, updatedAt: at };
      }
      const page = toPage(row);
      const kind = "line" in target ? "line" : "words";
      const span = "line" in target ? lineSpan({ page, ...target.line }) : target.span;
      if (!span) throw new Error(`That line of page ${position} has no words to note.`);
      const quote = quoteSpan({ page, span });
      const note: Note = { id: randomUUID(), bookId, position, kind, span, quote, stale: false, body: text, author, createdAt: at, updatedAt: at };
      user.store.setRow("notes", note.id, { ...base, kind, span: JSON.stringify(span), quote });
      return note;
    },

    /** Rewrites the whole note, so an edit made after another device deleted it brings the note back whole. */
    async updateNote({ id, body }: { id: string; body: string }): Promise<void> {
      const text = requireBody(body);
      const existing = user.row({ table: "notes", id });
      if (!existing) throw new Error(`There is no note with id ${id}.`);
      user.store.setRow("notes", id, { ...existing, body: text, updatedAt: now() });
    },

    async deleteNote({ id }: { id: string }): Promise<void> {
      if (!user.row({ table: "notes", id })) throw new Error(`There is no note with id ${id}.`);
      user.store.delRow("notes", id);
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
      const [current, ...others] = harakatAtLetter({ bookId, fileId: row.file_id, ref });
      const at = now();
      user.store.transaction(() => {
        for (const [id] of others) user.store.delRow("harakat", id);
        user.store.setRow("harakat", current?.[0] ?? randomUUID(), {
          bookId,
          fileId: row.file_id,
          ...ref,
          marks: normalized,
          base,
          author,
          createdAt: current ? Number(current[1].createdAt) : at,
          updatedAt: at,
          textRev: textRev(row.source),
        });
      });
    },

    async removeHarakat({ bookId, position, ...ref }: LetterRef & { bookId: string; position: number }): Promise<void> {
      const row = pageAt({ bookId, position });
      const onLetter = harakatAtLetter({ bookId, fileId: row.file_id, ref });
      if (onLetter.length === 0) throw new Error(`There are no harakat of yours at ${describeRef(ref)} on page ${position}.`);
      user.store.transaction(() => {
        for (const [id] of onLetter) user.store.delRow("harakat", id);
      });
    },

    /**
     * Removes every mark the reader or the agent put on letters inside the span, in one go.
     * Returns what it removed so it can be put back. Marks on letters a sync replaced are left alone.
     */
    async clearHarakat({ bookId, position, span }: { bookId: string; position: number; span: Span }): Promise<{ ref: LetterRef; marks: string }[]> {
      const row = pageAt({ bookId, position });
      const page = toPage(row);
      quoteSpan({ page, span });
      const inSpan = [...harakatByLetter({ user, bookId, fileId: row.file_id }).values()]
        .filter((rows) => {
          const ref = toLetterRef(rows[0]?.[1] ?? {});
          return ref.part === span.part && spanContains({ span, part: ref.part, ref }) && letterAt({ page, ref }) === rows[0]?.[1].base;
        })
        .sort((a, b) => {
          const [x, y] = [toLetterRef(a[0]?.[1] ?? {}), toLetterRef(b[0]?.[1] ?? {})];
          return x.line - y.line || x.word - y.word || x.letter - y.letter;
        });
      user.store.transaction(() => {
        for (const rows of inSpan) for (const [id] of rows) user.store.delRow("harakat", id);
      });
      return inSpan.map((rows) => ({ ref: toLetterRef(rows[0]?.[1] ?? {}), marks: String(rows[0]?.[1].marks) }));
    },
  };
};

export type Annotations = ReturnType<typeof createAnnotations>;
