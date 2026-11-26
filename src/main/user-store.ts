import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { type Cell, createIndexes, createMergeableStore, type Indexes, type MergeableChanges, type MergeableContent, type MergeableStore, type Row } from "tinybase";
import { decodeContent, readChanges, ROWS_SCHEMA, writeChanges, writeContent } from "./user-store-rows";
import type { LetterRef } from "../shared/annotations";
import type { RemoteChanges } from "../shared/ipc";
import { MAX_CLOCK_SKEW_SECONDS } from "../shared/sync";

/**
 * The reader's own data (library membership, highlights, notes, harakat, bookmarks, the
 * last-read marker, progress, conversations, Ask AI's memories) lives in a TinyBase MergeableStore, so copies
 * written by different processes and devices merge cell by cell, newest change first.
 *
 * Each process that writes it (the app, the midad CLI, the corpus MCP server) is its own
 * client: it saves only its own rows of `sync_rows` (see user-store-rows.ts) and merges everyone
 * else's. Book text and pages stay in SQLite.
 */

export type ClientId = "app" | "cli" | "corpus";

export const SCHEMA_VERSION = 1;

/**
 * `sync_stores` has a row per client: `rev` is the seq of its latest save. `content` held the
 * whole copy as one blob before the copy was saved row by row; it's emptied once converted.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS sync_stores (
  client_id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  rev INTEGER NOT NULL,
  saved_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sync_device (
  device_id TEXT NOT NULL
);
${ROWS_SCHEMA}`;

/** This library file's device id, shared by its app, CLI and MCP server, and never synced. */
const deviceIdOf = (db: DatabaseSync): string => {
  const existing = db.prepare("SELECT device_id FROM sync_device LIMIT 1").get() as { device_id: string } | undefined;
  if (existing) return existing.device_id;
  db.prepare("INSERT INTO sync_device (device_id) SELECT ? WHERE NOT EXISTS (SELECT 1 FROM sync_device)").run(randomUUID());
  return (db.prepare("SELECT device_id FROM sync_device LIMIT 1").get() as { device_id: string }).device_id;
};

/** A short hash of a page's source, stamped on everything pinned to its words. */
export const textRev = (source: string): string => createHash("sha256").update(source).digest("hex").slice(0, 16);

export { decodeContent, encodeContent } from "./user-store-rows";

export const pageKey =({ bookId, fileId }: { bookId: string; fileId: string }) => `${bookId}\u0000${fileId}`;

/** Required cells for each table: a row missing any of them (left by a delete racing an edit) counts as deleted. */
const REQUIRED: Record<string, readonly string[]> = {
  library: ["addedAt"],
  highlights: ["bookId", "fileId", "span", "quote", "color", "author", "createdAt"],
  notes: ["bookId", "fileId", "kind", "span", "quote", "body", "author", "createdAt", "updatedAt"],
  harakat: ["bookId", "fileId", "part", "line", "word", "letter", "marks", "base", "author", "createdAt", "updatedAt"],
  markers: ["fileId", "part", "line", "word", "setAt"],
  bookmarks: ["bookId", "fileId", "name", "createdAt"],
  progress: ["fileId", "updatedAt", "anchor"],
  conversations: ["bookId", "title", "createdAt", "updatedAt"],
  turns: ["conversationId", "question", "quotes", "position", "selection", "answer", "status", "error", "createdAt", "seq"],
  memories: ["name", "description", "type", "body", "bookId", "author", "editedAt", "createdAt", "updatedAt"],
};

export type UserTable = keyof typeof REQUIRED;

/** The cells that say where a row sits, which undo history refers to. */
const LOCATION_CELLS = ["bookId", "fileId", "part", "line", "word", "letter"];

export const createUserStore = ({ db, clientId, getNow = Date.now }: { db: DatabaseSync; clientId: ClientId; getNow?: () => number }) => {
  db.exec(SCHEMA);
  const store: MergeableStore = createMergeableStore(`${clientId}-${randomUUID()}`, getNow, MAX_CLOCK_SKEW_SECONDS);
  const indexes: Indexes = createIndexes(store);
  for (const table of ["highlights", "notes", "harakat", "bookmarks"]) {
    indexes.setIndexDefinition(table, table, (getCell) => pageKey({ bookId: String(getCell("bookId")), fileId: String(getCell("fileId")) }));
  }
  indexes.setIndexDefinition("turns", "turns", "conversationId");
  indexes.setIndexDefinition("conversations", "conversations", "bookId");

  const seen = new Map<string, number>();
  let saving = 0;
  let applying = 0;

  const apply = (content: MergeableContent | MergeableChanges) => {
    applying++;
    try {
      store.applyMergeableChanges(content);
    } finally {
      applying--;
    }
  };

  /** Holds SQLite's write lock while `fn` runs, unless the caller already holds a transaction. */
  const locked = <T>(fn: () => T): T => {
    if (db.isTransaction) return fn();
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      db.exec("COMMIT");
      return result;
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  };

  const mergeHooks = new Map<string, () => void>();
  /** Tidies what a merge can leave behind (two harakat on one letter). Writes made here are saved like any other. */
  const afterMerge = () => {
    for (const hook of mergeHooks.values()) hook();
  };

  /**
   * Merges the rows other processes saved since they were last merged: other clients', and this
   * client's own saved by another process of the same kind (this process's saves move its seen seq
   * past its own rows). Returns whether any were merged.
   */
  const mergeOthers = (): boolean => {
    const clients = db.prepare("SELECT client_id, rev FROM sync_stores").all() as { client_id: string; rev: number }[];
    let merged = false;
    for (const { client_id, rev } of clients) {
      if ((seen.get(client_id) ?? 0) >= rev) continue;
      const { changes, seq, count } = readChanges({ db, clientId: client_id, after: seen.get(client_id) ?? 0 });
      if (count > 0) {
        apply(changes);
        merged = true;
      }
      seen.set(client_id, Math.max(seq, rev));
    }
    if (merged) afterMerge();
    return merged;
  };

  /**
   * Saves what a transaction changed as this client's rows. Another process of the same kind (two
   * CLI runs at once) may have saved some since: they're merged cell by cell on disk, under the
   * write lock, so nothing is lost, and this process catches up with them straight after.
   */
  const save = (changes: MergeableChanges<true>) => {
    saving++;
    try {
      locked(() => {
        const own = db.prepare("SELECT rev FROM sync_stores WHERE client_id = ?").get(clientId) as { rev: number } | undefined;
        const lastSeen = seen.get(clientId) ?? 0;
        if (own && own.rev > lastSeen) {
          // TinyBase ignores changes made while a transaction is finishing, so apply them just after.
          const siblings = readChanges({ db, clientId, after: lastSeen });
          if (siblings.count > 0) queueMicrotask(() => apply(siblings.changes));
        }
        const seq = (own?.rev ?? 0) + 1;
        writeChanges({ db, clientId, changes, seq });
        db.prepare(
          `INSERT INTO sync_stores (client_id, content, rev, saved_at) VALUES (?, '', ?, ?)
           ON CONFLICT (client_id) DO UPDATE SET rev = excluded.rev, saved_at = excluded.saved_at`,
        ).run(clientId, seq, Date.now());
        seen.set(clientId, seq);
      });
    } finally {
      saving--;
    }
  };

  /**
   * Copies saved as one blob (by builds before row-by-row saving) become rows, once, under the
   * write lock: blob in, rows out, stamps byte for byte. A crash before the commit leaves the blob
   * to convert next time; a second process finds it already converted.
   */
  const convertBlobs = () =>
    locked(() => {
      const blobs = db.prepare("SELECT client_id, content, rev FROM sync_stores WHERE content != ''").all() as { client_id: string; content: string; rev: number }[];
      for (const { client_id, content, rev } of blobs) {
        writeContent({ db, clientId: client_id, content: decodeContent(content), seq: rev });
        db.prepare("UPDATE sync_stores SET content = '' WHERE client_id = ?").run(client_id);
      }
    });

  // Rows a merge changed, with where they were and are, for undo to forget (see remoteChanges).
  const mergeSources = new Set<() => boolean>();
  const merging = () => applying > 0 || [...mergeSources].some((isMerging) => isMerging());
  let touched: { table: string; id: string; before: Row; after: Row }[] = [];
  store.addRowListener(null, null, (_store, table, id, getCellChange) => {
    if (!merging() || !getCellChange) return;
    const before: Row = {};
    const after: Row = {};
    for (const cell of LOCATION_CELLS) {
      const [, was, is] = getCellChange(table, id, cell);
      if (was !== undefined) before[cell] = was;
      if (is !== undefined) after[cell] = is;
    }
    touched.push({ table, id, before, after });
  });

  if ((db.prepare("SELECT COUNT(*) AS n FROM sync_stores WHERE content != ''").get() as { n: number }).n > 0) convertBlobs();
  const own = readChanges({ db, clientId });
  if (own.count > 0) apply(own.changes);
  const ownRev = (db.prepare("SELECT rev FROM sync_stores WHERE client_id = ?").get(clientId) as { rev: number } | undefined)?.rev ?? 0;
  seen.set(clientId, Math.max(own.seq, ownRev));
  mergeOthers();
  touched = [];

  // Every local change is saved before the call that made it returns, so a CLI run can exit straight after.
  // These are the transaction's mergeable changes, as TinyBase hands them to its custom persisters.
  store.addDidFinishTransactionListener(() => {
    if (saving > 0 || applying > 0) return;
    const changes = store.getTransactionMergeableChanges(true);
    if (Object.keys(changes[0][0]).length + Object.keys(changes[1][0]).length > 0) save(changes);
  });

  const isComplete = ({ table, row }: { table: UserTable; row: Row }) => REQUIRED[table]?.every((cell) => row[cell] !== undefined) ?? false;

  return {
    clientId,
    deviceId: deviceIdOf(db),
    store,
    indexes,
    save,
    locked,
    mergeOthers,
    /**
     * Writes a whole row with every cell freshly stamped. TinyBase only stamps cells whose value
     * changes, so a plain setRow over a row another device deleted would bring back only the changed
     * cells; deleting and setting it in one transaction stamps them all.
     */
    rewriteRow: ({ table, id, row }: { table: UserTable; id: string; row: Row }) => {
      store.transaction(() => {
        store.delRow(table, id);
        store.setRow(table, id, row);
      });
    },
    /** Registers a tidy-up to run after merging other clients' or devices' changes. */
    afterMerge: ({ name, hook }: { name: string; hook: () => void }) => {
      mergeHooks.set(name, hook);
    },
    runAfterMerge: afterMerge,
    /** Marks changes applied while `isMerging` is true (a synchronizer loading) as coming from elsewhere. */
    mergingWhile: (isMerging: () => boolean) => {
      mergeSources.add(isMerging);
      return () => mergeSources.delete(isMerging);
    },
    /**
     * What merges changed since the last call, named the way undo history names things. A page a
     * row is on is looked up now, so a mark on a page this device doesn't have is left out.
     */
    takeRemoteChanges: (): RemoteChanges => {
      const taken = touched;
      touched = [];
      const positionOf = db.prepare("SELECT position FROM pages WHERE book_id = ? AND file_id = ?");
      const position = (row: Row) =>
        typeof row.bookId === "string" && typeof row.fileId === "string"
          ? ((positionOf.get(row.bookId, row.fileId) as { position: number } | undefined)?.position ?? null)
          : null;
      const changes: RemoteChanges = { highlights: [], notes: [], harakat: [], markers: [], bookmarks: [] };
      for (const { table, id, before, after } of taken) {
        if (table === "highlights" || table === "notes") changes[table].push(id);
        if (table === "markers") changes.markers.push(id);
        for (const row of [before, after]) {
          const at = position(row);
          if (at === null) continue;
          if (table === "bookmarks") changes.bookmarks.push({ bookId: String(row.bookId), position: at });
          if (table === "harakat")
            changes.harakat.push({ bookId: String(row.bookId), position: at, part: row.part as LetterRef["part"], line: Number(row.line), word: Number(row.word), letter: Number(row.letter) });
        }
      }
      return changes;
    },
    /** The row, or null when it doesn't exist or is missing cells (a delete that raced an edit). */
    row: ({ table, id }: { table: UserTable; id: string }): Row | null => {
      const row = store.getRow(table, id);
      return isComplete({ table, row }) ? row : null;
    },
    rows: ({ table, ids }: { table: UserTable; ids?: string[] }): [string, Row][] =>
      (ids ?? store.getRowIds(table)).flatMap((id) => {
        const row = store.getRow(table, id);
        return isComplete({ table, row }) ? [[id, row] as [string, Row]] : [];
      }),
    onPage: ({ table, bookId, fileId }: { table: "highlights" | "notes" | "harakat" | "bookmarks"; bookId: string; fileId: string }) =>
      indexes.getSliceRowIds(table, pageKey({ bookId, fileId })),
    /** Whether the legacy SQLite table has been copied in (on any client). */
    migrated: (table: string) => store.getValue(`migrated:${table}`) !== undefined,
  };
};

export type UserStore = ReturnType<typeof createUserStore>;

const opened = new WeakMap<DatabaseSync, UserStore>();

/**
 * The user store for a library file, created once per connection. The entry point opens it
 * first with its client id; store modules then share it.
 */
export const openUserStore = ({ db, clientId = "app", getNow }: { db: DatabaseSync; clientId?: ClientId; getNow?: () => number }): UserStore => {
  const existing = opened.get(db);
  if (existing) return existing;
  const user = createUserStore({ db, clientId, ...(getNow ? { getNow } : {}) });
  opened.set(db, user);
  return user;
};

const hasTable = (db: DatabaseSync, name: string) => db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !== undefined;

/** The user-data tables from before the user store. `books` isn't one: it still holds the books' metadata. */
const LEGACY_USER_TABLES = new Set(["highlights", "notes", "harakat", "markers", "bookmarks", "progress", "conversations", "turns", "memories"]);

export const LEGACY_WRITE_ERROR = "Midad was updated, and this data has moved. Restart Midad (or update this build) to keep saving.";

/**
 * Once copied in, an old table is a backup nobody reads. A Midad build from before the user store
 * (an app left running across an update, or an old midad CLI) would keep writing to it and its
 * changes would silently vanish, so every write to it fails with a message saying why.
 */
const guardLegacyTable = ({ db, table }: { db: DatabaseSync; table: string }) => {
  if (!LEGACY_USER_TABLES.has(table)) return;
  for (const op of ["INSERT", "UPDATE", "DELETE"]) {
    db.exec(`CREATE TRIGGER IF NOT EXISTS midad_legacy_${table}_${op.toLowerCase()} BEFORE ${op} ON ${table}
      BEGIN SELECT RAISE(ABORT, '${LEGACY_WRITE_ERROR}'); END`);
  }
};

/**
 * Copies a table from before the user store, once, keeping its ids, so two processes doing it at
 * once write the same rows. The copy happens under the write lock after merging the other clients,
 * so a copy another client already made (and anything deleted since) is never brought back. The old
 * table is left as it was, as a backup.
 */
/**
 * The copied rows as mergeable content stamped with when each row last changed, not with now. A
 * device migrating an older copy of the same library (from a backup, or one that sat unopened)
 * must not overrule edits and deletes made since on a device that migrated first. Rows are stamped
 * oldest first, because a TinyBase clock never runs backwards. The HLC id is this device's, so
 * rows stamped at the same moment on two devices settle the same way everywhere, and identical
 * copies, having identical values, agree whichever wins.
 */
const stampedAtLastChange = ({ user, rows }: { user: UserStore; rows: { table: UserTable; id: string; row: Record<string, Cell>; at: number }[] }) => {
  let clock = 0;
  const scratch = createMergeableStore(`legacy-${user.deviceId}`, () => clock, MAX_CLOCK_SKEW_SECONDS);
  for (const { table, id, row, at } of [...rows].sort((x, y) => x.at - y.at)) {
    clock = Number.isFinite(at) ? at : 0;
    scratch.setRow(table, id, row);
  }
  return scratch.getMergeableContent();
};

export const migrateLegacyTable = ({
  user,
  db,
  table,
  rows,
  alsoCopies = [],
}: {
  user: UserStore;
  db: DatabaseSync;
  table: string;
  /** Each row with `at`, when it last changed as far as its own columns tell. */
  rows: () => { table: UserTable; id: string; row: Record<string, Cell>; at: number }[];
  /** Other old tables this copy reads (turns, with conversations), guarded with it. */
  alsoCopies?: string[];
}) => {
  if (!hasTable(db, table)) return;
  const guard = () => {
    for (const name of [table, ...alsoCopies]) if (hasTable(db, name)) guardLegacyTable({ db, table: name });
  };
  if (user.migrated(table)) {
    guard();
    return;
  }
  user.locked(() => {
    user.mergeOthers();
    if (!user.migrated(table)) {
      const copied = stampedAtLastChange({ user, rows: rows() });
      user.store.transaction(() => {
        user.store.applyMergeableChanges(copied);
        user.store.setValue(`migrated:${table}`, Date.now());
        user.store.setValue("schemaVersion", SCHEMA_VERSION);
      });
    }
    // In the same transaction as the copy, so no old write can land between the two.
    guard();
  });
};
