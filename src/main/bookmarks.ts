import type { DatabaseSync } from "node:sqlite";
import type { Bookmark } from "../shared/library";
import { migrateLegacyTable, openUserStore } from "./user-store";

/**
 * Page bookmarks: at most one per page, with an optional name. Kept in the user store against the
 * page's corpus file so a bookmark stays on its page when a sync renumbers the book. Requires the
 * library's schema.
 */

/** Bookmark names are kept short; blank names mean "no name". */
export const BOOKMARK_NAME_MAX = 120;

export const cleanBookmarkName = (name: string | null | undefined): string | null => {
  const trimmed = name?.replace(/\s+/g, " ").trim().slice(0, BOOKMARK_NAME_MAX) ?? "";
  return trimmed === "" ? null : trimmed;
};

/** One bookmark per page, under the same id on every device. */
const bookmarkId = ({ bookId, fileId }: { bookId: string; fileId: string }) => `${bookId}:${fileId}`;

const legacyBookmarks = (db: DatabaseSync) =>
  (db.prepare("SELECT * FROM bookmarks").all() as { book_id: string; file_id: string; name: string | null; created_at: number }[]).map((b) => ({
    table: "bookmarks" as const,
    id: bookmarkId({ bookId: b.book_id, fileId: b.file_id }),
    row: { bookId: b.book_id, fileId: b.file_id, name: b.name, createdAt: b.created_at },
  }));

export const createBookmarks = ({ db, now = Date.now }: { db: DatabaseSync; now?: () => number }) => {
  const user = openUserStore({ db });
  migrateLegacyTable({ user, db, table: "bookmarks", rows: () => legacyBookmarks(db) });

  const fileAt = ({ bookId, position }: { bookId: string; position: number }) => {
    const row = db.prepare("SELECT file_id FROM pages WHERE book_id = ? AND position = ?").get(bookId, position) as { file_id: string } | undefined;
    if (!row) throw new Error(`Book ${bookId} has no page ${position} in the library.`);
    return row.file_id;
  };

  return {
    /** The book's bookmarks in page order. */
    async list({ bookId }: { bookId: string }): Promise<Bookmark[]> {
      const positions = new Map(
        (db.prepare("SELECT file_id, position FROM pages WHERE book_id = ?").all(bookId) as { file_id: string; position: number }[]).map((p) => [p.file_id, p.position]),
      );
      return user
        .rows({ table: "bookmarks" })
        .flatMap(([, b]) => {
          const position = b.bookId === bookId ? positions.get(String(b.fileId)) : undefined;
          return position === undefined ? [] : [{ position, name: b.name === null ? null : String(b.name), createdAt: Number(b.createdAt) }];
        })
        .sort((a, b) => a.position - b.position);
    },

    /**
     * Adds or updates the page's bookmark. Without `createdAt` a new bookmark is stamped now and an
     * existing one keeps its date; undo passes the original date back.
     */
    async set({ bookId, position, name, createdAt }: { bookId: string; position: number; name?: string | null; createdAt?: number }): Promise<Bookmark> {
      const fileId = fileAt({ bookId, position });
      const clean = cleanBookmarkName(name);
      const id = bookmarkId({ bookId, fileId });
      const existing = user.row({ table: "bookmarks", id });
      const date = createdAt ?? (existing ? Number(existing.createdAt) : now());
      user.store.setRow("bookmarks", id, { bookId, fileId, name: clean, createdAt: date });
      return { position, name: clean, createdAt: date };
    },

    async remove({ bookId, position }: { bookId: string; position: number }): Promise<void> {
      user.store.delRow("bookmarks", bookmarkId({ bookId, fileId: fileAt({ bookId, position }) }));
    },
  };
};

export type Bookmarks = ReturnType<typeof createBookmarks>;
