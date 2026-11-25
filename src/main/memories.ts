import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { foldArabic } from "../shared/arabic";
import { isMemoryType, MEMORY_LIMITS, MEMORY_TYPES, type Memory, type MemoryInput, type MemorySource, type MemoryType } from "../shared/memories";

/**
 * Ask AI's memory. A `book` memory belongs to its book and goes when the book does; the rest are
 * global. Searched by full text: the index holds each memory's words folded as Arabic search
 * folds them, so harakat and hamza seats don't matter. Requires the library's schema.
 */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN (${MEMORY_TYPES.map((t) => `'${t}'`).join(", ")})),
  body TEXT NOT NULL,
  book_id TEXT REFERENCES books(book_id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('reader', 'agent')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS memories_by_name ON memories (name, IFNULL(book_id, ''));
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(name, description, body, tokenize = 'porter unicode61 remove_diacritics 2');
CREATE TRIGGER IF NOT EXISTS memories_fts_delete AFTER DELETE ON memories BEGIN
  DELETE FROM memories_fts WHERE rowid = old.rowid;
END;
`;

/** Name, description and body, in the weights bm25 ranks a match by. */
const RANK = "bm25(memories_fts, 4.0, 2.0, 1.0)";

const DEFAULT_SEARCH_LIMIT = 10;

interface MemoryRow {
  rowid: number;
  id: string;
  name: string;
  description: string;
  type: MemoryType;
  body: string;
  book_id: string | null;
  book_title: string | null;
  source: MemorySource;
  created_at: number;
  updated_at: number;
}

const SELECT = `SELECT m.rowid, m.*, b.title AS book_title FROM memories m LEFT JOIN books b ON b.book_id = m.book_id`;

const toMemory = (row: MemoryRow): Memory => ({
  id: row.id,
  name: row.name,
  description: row.description,
  type: row.type,
  body: row.body,
  bookId: row.book_id,
  bookTitle: row.book_title,
  source: row.source,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const indexed = (text: string) => foldArabic(text).toLowerCase();

/** A short, lower-case, hyphenated name: "Transliterate terms" is transliterate-terms. */
export const cleanMemoryName = (name: string): string =>
  name
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MEMORY_LIMITS.name);

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

const checked = ({ name, description, type, body }: Omit<MemoryInput, "bookId">) => {
  const clean = { name: cleanMemoryName(name), description: oneLine(description), type, body: body.trim() };
  if (!clean.name) throw new Error("Give the memory a short name.");
  if (!clean.description) throw new Error("Give the memory a one-line description, written so a later search finds it.");
  if (!clean.body) throw new Error("The memory is empty.");
  if (!isMemoryType(type)) throw new Error(`The type is one of ${MEMORY_TYPES.join(", ")}.`);
  if (clean.description.length > MEMORY_LIMITS.description) throw new Error(`Keep the description to one line of at most ${MEMORY_LIMITS.description} characters.`);
  if (clean.body.length > MEMORY_LIMITS.body) throw new Error(`A memory holds one short fact, at most ${MEMORY_LIMITS.body} characters. Don't save page text.`);
  return clean;
};

/** The query's words, each matching as a prefix, any of them: ranked so memories matching more and rarer words come first. */
export const matchQuery = (query: string): string | null => {
  const words = indexed(query).match(/[\p{L}\p{N}]+/gu);
  return words ? words.map((w) => `"${w}"*`).join(" OR ") : null;
};

export const createMemories = ({ db, now = Date.now }: { db: DatabaseSync; now?: () => number }) => {
  db.exec(SCHEMA);

  const row = (id: string) => db.prepare(`${SELECT} WHERE m.id = ?`).get(id) as MemoryRow | undefined;

  const reindex = (r: MemoryRow) => {
    db.prepare("DELETE FROM memories_fts WHERE rowid = ?").run(r.rowid);
    db.prepare("INSERT INTO memories_fts (rowid, name, description, body) VALUES (?, ?, ?, ?)").run(r.rowid, indexed(r.name.replace(/-/g, " ")), indexed(r.description), indexed(r.body));
  };

  const scopeFor = ({ type, bookId }: { type: MemoryType; bookId: string | null | undefined }) => {
    if (type !== "book") return null;
    if (!bookId) throw new Error("A book memory needs the book it's about.");
    if (!db.prepare("SELECT 1 FROM books WHERE book_id = ?").get(bookId)) throw new Error(`There is no book ${bookId} in the library.`);
    return bookId;
  };

  const assertNameFree = ({ name, bookId, except }: { name: string; bookId: string | null; except?: string }) => {
    const taken = db.prepare("SELECT id FROM memories WHERE name = ? AND IFNULL(book_id, '') = ? AND id != ?").get(name, bookId ?? "", except ?? "") as
      | { id: string }
      | undefined;
    if (taken) throw new Error(`A memory named "${name}" already exists (${taken.id}). Update it instead of adding another.`);
  };

  /** Memories a chat about `bookId` sees: the global ones and that book's. */
  const inScope = "(m.book_id IS NULL OR m.book_id = ?)";

  return {
    /**
     * Memories a chat about the book sees (global ones only for null), newest first. `all` lists
     * every book's too, for Settings.
     */
    async list({ bookId = null, type, all = false }: { bookId?: string | null; type?: MemoryType; all?: boolean } = {}): Promise<Memory[]> {
      const where = [all ? "1" : inScope, type ? "m.type = ?" : "1"].join(" AND ");
      const params = [...(all ? [] : [bookId ?? ""]), ...(type ? [type] : [])];
      const rows = db.prepare(`${SELECT} WHERE ${where} ORDER BY m.updated_at DESC, m.rowid DESC`).all(...params) as unknown as MemoryRow[];
      return rows.map(toMemory);
    },

    /** Memories in the chat's scope matching any of the query's words, best match first. */
    async search({ query, bookId = null, limit = DEFAULT_SEARCH_LIMIT }: { query: string; bookId?: string | null; limit?: number }): Promise<Memory[]> {
      const match = matchQuery(query);
      if (!match) return [];
      const rows = db
        .prepare(
          `${SELECT} JOIN memories_fts ON memories_fts.rowid = m.rowid
           WHERE memories_fts MATCH ? AND ${inScope}
           ORDER BY ${RANK}, m.updated_at DESC LIMIT ?`,
        )
        .all(match, bookId ?? "", limit) as unknown as MemoryRow[];
      return rows.map(toMemory);
    },

    async get({ id }: { id: string }): Promise<Memory | null> {
      const found = row(id);
      return found ? toMemory(found) : null;
    },

    /** Saves a new memory. A name already used in the same scope is refused, so a fact is updated rather than saved twice. */
    async add({ source, ...input }: MemoryInput & { source: MemorySource }): Promise<Memory> {
      const clean = checked(input);
      const bookId = scopeFor({ type: clean.type, bookId: input.bookId });
      assertNameFree({ name: clean.name, bookId });
      let id = randomUUID().slice(0, 8);
      while (row(id)) id = randomUUID().slice(0, 8);
      const at = now();
      db.prepare(
        "INSERT INTO memories (id, name, description, type, body, book_id, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(id, clean.name, clean.description, clean.type, clean.body, bookId, source, at, at);
      const saved = row(id) as MemoryRow;
      reindex(saved);
      return toMemory(saved);
    },

    /** Changes some of a memory's fields and marks who wrote it last. */
    async update({
      id,
      source,
      ...changes
    }: Partial<MemoryInput> & { id: string; source: MemorySource }): Promise<Memory> {
      const current = row(id);
      if (!current) throw new Error(`There is no memory ${id}.`);
      const clean = checked({
        name: changes.name ?? current.name,
        description: changes.description ?? current.description,
        type: changes.type ?? current.type,
        body: changes.body ?? current.body,
      });
      const bookId = scopeFor({ type: clean.type, bookId: changes.bookId ?? current.book_id });
      assertNameFree({ name: clean.name, bookId, except: id });
      db.prepare("UPDATE memories SET name = ?, description = ?, type = ?, body = ?, book_id = ?, source = ?, updated_at = ? WHERE id = ?").run(
        clean.name,
        clean.description,
        clean.type,
        clean.body,
        bookId,
        source,
        now(),
        id,
      );
      const saved = row(id) as MemoryRow;
      reindex(saved);
      return toMemory(saved);
    },

    async remove({ id }: { id: string }): Promise<void> {
      if (db.prepare("DELETE FROM memories WHERE id = ?").run(id).changes === 0) throw new Error(`There is no memory ${id}.`);
    },
  };
};

export type Memories = ReturnType<typeof createMemories>;
