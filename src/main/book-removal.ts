import { rmSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { BookRemoval } from "../shared/library";
import { deleteLegacyRows, openUserStore, type UserStore, type UserTable } from "./user-store";

/**
 * Removing a book from the library: its pages and scans on this device, and every row of the
 * reader's own data tied to it in the user store, deleted the store's normal way so the removal
 * reaches their other devices. Global memories and the corpus are left alone. Requires the
 * library's schema.
 */

const SAFE_ID = /^[\w-]+$/;

const hasTable = ({ db, name }: { db: DatabaseSync; name: string }) => db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !== undefined;

/** The book's rows in each table, including ones a delete racing an edit left incomplete. */
const rowsOf = ({ user, bookId }: { user: UserStore; bookId: string }): Partial<Record<UserTable, string[]>> => {
  const { store } = user;
  const withBook = (table: UserTable) => store.getRowIds(table).filter((id) => store.getCell(table, id, "bookId") === bookId);
  const keyedByBook = (table: UserTable) => (store.hasRow(table, bookId) ? [bookId] : []);
  const conversations = new Set(withBook("conversations"));
  return {
    library: keyedByBook("library"),
    progress: keyedByBook("progress"),
    markers: keyedByBook("markers"),
    highlights: withBook("highlights"),
    notes: withBook("notes"),
    harakat: withBook("harakat"),
    bookmarks: withBook("bookmarks"),
    conversations: [...conversations],
    turns: store.getRowIds("turns").filter((id) => conversations.has(String(store.getCell("turns", id, "conversationId")))),
    memories: withBook("memories"),
  };
};

/** Deletes what this device alone keeps for a book: its pages and import record, old backup rows and chat sessions. Runs inside a transaction. */
const dropLocalRows = ({ db, bookId, conversationIds = [], memoryIds = [] }: { db: DatabaseSync; bookId: string; conversationIds?: string[]; memoryIds?: string[] }) => {
  deleteLegacyRows({ db, bookId });
  if (hasTable({ db, name: "conversation_sessions" })) {
    const drop = db.prepare("DELETE FROM conversation_sessions WHERE conversation_id = ?");
    for (const id of conversationIds) drop.run(id);
  }
  if (hasTable({ db, name: "memory_search" })) {
    const drop = db.prepare("DELETE FROM memory_search WHERE id = ?");
    for (const id of memoryIds) drop.run(id);
  }
  db.prepare("DELETE FROM pages WHERE book_id = ?").run(bookId);
  db.prepare("DELETE FROM books WHERE book_id = ?").run(bookId);
};

const dropScans = ({ scansDir, bookId }: { scansDir: string | undefined; bookId: string }) => {
  if (scansDir && SAFE_ID.test(bookId)) rmSync(join(scansDir, bookId), { recursive: true, force: true });
};

/** Drops this device's copy of a book removed elsewhere, whose user-store rows are already gone. */
export const dropRemovedBook = ({ db, user, bookId, scansDir }: { db: DatabaseSync; user: UserStore; bookId: string; scansDir?: string }) => {
  user.locked(() => dropLocalRows({ db, bookId }));
  dropScans({ scansDir, bookId });
};

export const createBookRemoval = ({ db, scansDir }: { db: DatabaseSync; scansDir?: string }) => {
  const user = openUserStore({ db });

  const summarise = (bookId: string): BookRemoval | null => {
    const local = db.prepare("SELECT title, (SELECT COUNT(*) FROM pages WHERE book_id = ?) AS pages FROM books WHERE book_id = ?").get(bookId, bookId) as
      | { title: string; pages: number }
      | undefined;
    const entry = user.store.getRow("library", bookId);
    if (!local && !user.row({ table: "library", id: bookId })) return null;
    const rows = rowsOf({ user, bookId });
    const count = (table: UserTable) => user.rows({ table, ids: rows[table] ?? [] }).length;
    return {
      bookId,
      title: local?.title ?? (typeof entry.title === "string" ? entry.title : null),
      pages: local?.pages ?? 0,
      highlights: count("highlights"),
      notes: count("notes"),
      harakat: count("harakat"),
      bookmarks: count("bookmarks"),
      conversations: count("conversations"),
      memories: count("memories"),
    };
  };

  return {
    /** What removing the book would delete, or null when it isn't in the library. Changes nothing. */
    async preview({ bookId }: { bookId: string }): Promise<BookRemoval | null> {
      user.mergeOthers();
      return summarise(bookId);
    },

    /** Removes the book here and, through sync, on the reader's other devices. Returns what went. */
    async remove({ bookId }: { bookId: string }): Promise<BookRemoval> {
      const removed = user.locked(() => {
        user.mergeOthers();
        const summary = summarise(bookId);
        if (!summary) throw new Error(`Book ${bookId} is not in the library.`);
        const rows = rowsOf({ user, bookId });
        dropLocalRows({ db, bookId, conversationIds: rows.conversations ?? [], memoryIds: rows.memories ?? [] });
        user.store.transaction(() => {
          for (const [table, ids] of Object.entries(rows)) for (const id of ids ?? []) user.store.delRow(table, id);
        });
        return summary;
      });
      dropScans({ scansDir, bookId });
      return removed;
    },
  };
};

export type BookRemovals = ReturnType<typeof createBookRemoval>;
