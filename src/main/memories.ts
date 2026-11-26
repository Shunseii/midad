import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { Row } from "tinybase";
import { foldArabic } from "../shared/arabic";
import { isMemoryType, MEMORY_LIMITS, MEMORY_TYPES, type Memory, type MemoryAuthor, type MemoryInput, type MemoryType } from "../shared/memories";
import { migrateLegacyTable, openUserStore } from "./user-store";

/**
 * Ask AI's memory, kept in the user store so it syncs between devices like notes do. A memory is
 * global or tied to a book. Search runs on a local FTS5 index derived from the store and never
 * synced: before each search it is brought in line with the store, whoever changed it (this
 * process, another one, another device). It holds each memory's words folded as Arabic search
 * folds them, so harakat and hamza seats don't matter. Requires the library's schema.
 */

const SEARCH_SCHEMA = `
CREATE VIRTUAL TABLE IF NOT EXISTS memory_search USING fts5(id UNINDEXED, stamp UNINDEXED, name, description, body, tokenize = 'porter unicode61 remove_diacritics 2');
`;

/** Name, description and body, in the weights bm25 ranks a match by (the unindexed id and stamp come first). */
const RANK = "bm25(memory_search, 0, 0, 4.0, 2.0, 1.0)";

const DEFAULT_SEARCH_LIMIT = 10;

/** Which memories to see: global ones, one book's, or both. Without either, all of them. */
export interface MemoryFilter {
  global?: boolean;
  bookId?: string | null;
}

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

const checked = ({ name, description, type, body, bookId }: MemoryInput) => {
  const clean = { name: cleanMemoryName(name), description: oneLine(description), type, body: body.trim(), bookId: bookId ?? null };
  if (!clean.name) throw new Error("Give the memory a short name.");
  if (!clean.description) throw new Error("Give the memory a one-line description, written so a later search finds it.");
  if (!clean.body) throw new Error("The memory is empty.");
  if (!isMemoryType(type)) throw new Error(`The type is one of ${MEMORY_TYPES.join(", ")}.`);
  if (type === "book" && !clean.bookId) throw new Error("A book memory needs the book it's about (--book).");
  if (clean.description.length > MEMORY_LIMITS.description) throw new Error(`Keep the description to one line of at most ${MEMORY_LIMITS.description} characters.`);
  if (clean.body.length > MEMORY_LIMITS.body) throw new Error(`A memory holds one short fact, at most ${MEMORY_LIMITS.body} characters. Don't save page text.`);
  return clean;
};

/** The query's words, each matching as a prefix, any of them: ranked so memories matching more and rarer words come first. */
export const matchQuery = (query: string): string | null => {
  const words = indexed(query).match(/[\p{L}\p{N}]+/gu);
  return words ? words.map((w) => `"${w}"*`).join(" OR ") : null;
};

const searchText = (row: Row) => ({
  name: indexed(String(row.name).replace(/-/g, " ")),
  description: indexed(String(row.description)),
  body: indexed(String(row.body)),
});

const stampOf = (text: { name: string; description: string; body: string }) =>
  createHash("sha256").update(`${text.name}\u0000${text.description}\u0000${text.body}`).digest("hex").slice(0, 16);

const inFilter = ({ bookId, filter }: { bookId: string | null; filter: MemoryFilter | undefined }) => {
  if (!filter || (!filter.global && !filter.bookId)) return true;
  return bookId === null ? Boolean(filter.global) : bookId === filter.bookId;
};

interface LegacyMemoryRow {
  id: string;
  name: string;
  description: string;
  type: MemoryType;
  body: string;
  book_id: string | null;
  source: MemoryAuthor;
  created_at: number;
  updated_at: number;
}

/** Memories saved in a plain SQLite table by builds before the user store, copied in once with their ids. */
const legacyMemories = (db: DatabaseSync) =>
  (db.prepare("SELECT * FROM memories").all() as unknown as LegacyMemoryRow[]).map((m) => ({
    table: "memories" as const,
    id: m.id,
    row: {
      name: m.name,
      description: m.description,
      type: m.type,
      body: m.body,
      bookId: m.book_id,
      // The old table kept who wrote it last; that is the best guess at who wrote it first.
      author: m.source,
      editedAt: m.updated_at > m.created_at ? m.updated_at : null,
      createdAt: m.created_at,
      updatedAt: m.updated_at,
    },
    at: m.updated_at,
  }));

export const createMemories = ({ db, now = Date.now }: { db: DatabaseSync; now?: () => number }) => {
  const user = openUserStore({ db });
  migrateLegacyTable({ user, db, table: "memories", rows: () => legacyMemories(db) });
  // The old builds' index; the new one is keyed by id rather than the old table's rowid.
  db.exec("DROP TRIGGER IF EXISTS memories_fts_delete; DROP TABLE IF EXISTS memories_fts;");
  db.exec(SEARCH_SCHEMA);

  const bookTitle = (bookId: string): string | null => {
    const local = db.prepare("SELECT title FROM books WHERE book_id = ?").get(bookId) as { title: string } | undefined;
    if (local) return local.title;
    const elsewhere = user.row({ table: "library", id: bookId });
    return typeof elsewhere?.title === "string" ? elsewhere.title : null;
  };

  const toMemory = ([id, row]: [string, Row]): Memory => {
    const bookId = typeof row.bookId === "string" ? row.bookId : null;
    return {
      id,
      name: String(row.name),
      description: String(row.description),
      type: row.type as MemoryType,
      body: String(row.body),
      bookId,
      bookTitle: bookId ? bookTitle(bookId) : null,
      author: row.author as MemoryAuthor,
      editedAt: typeof row.editedAt === "number" ? row.editedAt : null,
      createdAt: Number(row.createdAt),
      updatedAt: Number(row.updatedAt),
    };
  };

  const newestFirst = (a: Memory, b: Memory) => b.updatedAt - a.updatedAt || (a.id < b.id ? 1 : -1);

  const all = () => user.rows({ table: "memories" }).map(toMemory);

  /** Brings the local search index in line with the store: adds, changes and drops rows by their content stamp. */
  const syncIndex = () => {
    const indexedStamps = new Map((db.prepare("SELECT id, stamp FROM memory_search").all() as { id: string; stamp: string }[]).map((r) => [r.id, r.stamp]));
    const live = new Set<string>();
    const drop = db.prepare("DELETE FROM memory_search WHERE id = ?");
    const insert = db.prepare("INSERT INTO memory_search (id, stamp, name, description, body) VALUES (?, ?, ?, ?, ?)");
    const changes: (() => void)[] = [];
    for (const [id, row] of user.rows({ table: "memories" })) {
      live.add(id);
      const text = searchText(row);
      const stamp = stampOf(text);
      if (indexedStamps.get(id) === stamp) continue;
      changes.push(() => {
        drop.run(id);
        insert.run(id, stamp, text.name, text.description, text.body);
      });
    }
    for (const id of indexedStamps.keys()) if (!live.has(id)) changes.push(() => drop.run(id));
    if (changes.length) user.locked(() => changes.forEach((change) => change()));
  };

  const assertNameFree = ({ name, bookId, except }: { name: string; bookId: string | null; except?: string }) => {
    const taken = user.rows({ table: "memories" }).find(([id, row]) => id !== except && row.name === name && (row.bookId ?? null) === bookId);
    if (taken) throw new Error(`A memory named "${name}" already exists (${taken[0]}). Update it instead of adding another.`);
  };

  return {
    /** Memories matching the filter (all of them without one), newest first. */
    async list({ filter, type }: { filter?: MemoryFilter; type?: MemoryType } = {}): Promise<Memory[]> {
      user.mergeOthers();
      return all()
        .filter((m) => inFilter({ bookId: m.bookId, filter }) && (!type || m.type === type))
        .sort(newestFirst);
    },

    /** Memories matching the filter and any of the query's words, best match first. */
    async search({ query, filter, limit = DEFAULT_SEARCH_LIMIT }: { query: string; filter?: MemoryFilter; limit?: number }): Promise<Memory[]> {
      const match = matchQuery(query);
      if (!match) return [];
      user.mergeOthers();
      syncIndex();
      const ranked = db.prepare(`SELECT id FROM memory_search WHERE memory_search MATCH ? ORDER BY ${RANK}`).all(match) as { id: string }[];
      return ranked
        .flatMap(({ id }) => {
          const row = user.row({ table: "memories", id });
          return row ? [toMemory([id, row])] : [];
        })
        .filter((m) => inFilter({ bookId: m.bookId, filter }))
        .slice(0, limit);
    },

    async get({ id }: { id: string }): Promise<Memory | null> {
      user.mergeOthers();
      const row = user.row({ table: "memories", id });
      return row ? toMemory([id, row]) : null;
    },

    /** Saves a new memory. A name already used in the same scope is refused, so a fact is updated rather than saved twice. */
    async add({ author, ...input }: MemoryInput & { author: MemoryAuthor }): Promise<Memory> {
      user.mergeOthers();
      const clean = checked(input);
      assertNameFree({ name: clean.name, bookId: clean.bookId });
      let id = randomUUID().slice(0, 8);
      while (user.store.hasRow("memories", id)) id = randomUUID().slice(0, 8);
      const at = now();
      const row = { ...clean, author, editedAt: null, createdAt: at, updatedAt: at };
      user.rewriteRow({ table: "memories", id, row });
      return toMemory([id, row]);
    },

    /** Changes some of a memory's fields, or moves it between global and a book; it then shows as edited. */
    async update({ id, ...changes }: Partial<MemoryInput> & { id: string }): Promise<Memory> {
      user.mergeOthers();
      const current = user.row({ table: "memories", id });
      if (!current) throw new Error(`There is no memory ${id}.`);
      const clean = checked({
        name: changes.name ?? String(current.name),
        description: changes.description ?? String(current.description),
        type: changes.type ?? (current.type as MemoryType),
        body: changes.body ?? String(current.body),
        bookId: changes.bookId !== undefined ? changes.bookId : typeof current.bookId === "string" ? current.bookId : null,
      });
      assertNameFree({ name: clean.name, bookId: clean.bookId, except: id });
      const at = now();
      user.store.transaction(() => {
        for (const [cell, value] of Object.entries(clean)) if (current[cell] !== value) user.store.setCell("memories", id, cell, value);
        user.store.setPartialRow("memories", id, { editedAt: at, updatedAt: at });
      });
      return toMemory([id, user.store.getRow("memories", id)]);
    },

    /** Puts a deleted memory back as it was, for undo. */
    async restore({ memory }: { memory: Memory }): Promise<void> {
      if (user.row({ table: "memories", id: memory.id })) return;
      const { id, name, description, type, body, bookId, author, editedAt, createdAt, updatedAt } = memory;
      assertNameFree({ name, bookId });
      user.rewriteRow({ table: "memories", id, row: { name, description, type, body, bookId, author, editedAt, createdAt, updatedAt } });
    },

    async remove({ id }: { id: string }): Promise<void> {
      user.mergeOthers();
      if (!user.row({ table: "memories", id })) throw new Error(`There is no memory ${id}.`);
      user.store.delRow("memories", id);
    },
  };
};

export type Memories = ReturnType<typeof createMemories>;
