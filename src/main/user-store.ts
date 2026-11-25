import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { type Cell, createIndexes, createMergeableStore, type Indexes, type MergeableContent, type MergeableStore, type Row } from "tinybase";

/**
 * The reader's own data (library membership, highlights, notes, harakat, bookmarks, the
 * last-read marker, progress, conversations) lives in a TinyBase MergeableStore, so copies
 * written by different processes and devices merge cell by cell, newest change first.
 *
 * Each process that writes it (the app, the midad CLI, the corpus MCP server) is its own
 * client: it saves only its own row of `sync_stores` and merges everyone else's. Book text
 * and pages stay in SQLite.
 */

export type ClientId = "app" | "cli" | "corpus";

export const SCHEMA_VERSION = 1;

/**
 * TinyBase silently skips stamps further ahead of this clock than this. Skipping one in a client's
 * own saved copy (after the clock was set back) would drop it from the next save for good, so
 * accept any skew: a fast clock only makes that device's edits win until real time catches up.
 */
const MAX_CLOCK_SKEW_SECONDS = 100 * 365 * 24 * 60 * 60;

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
`;

/** This library file's device id, shared by its app, CLI and MCP server, and never synced. */
const deviceIdOf = (db: DatabaseSync): string => {
  const existing = db.prepare("SELECT device_id FROM sync_device LIMIT 1").get() as { device_id: string } | undefined;
  if (existing) return existing.device_id;
  db.prepare("INSERT INTO sync_device (device_id) SELECT ? WHERE NOT EXISTS (SELECT 1 FROM sync_device)").run(randomUUID());
  return (db.prepare("SELECT device_id FROM sync_device LIMIT 1").get() as { device_id: string }).device_id;
};

/** A short hash of a page's source, stamped on everything pinned to its words. */
export const textRev = (source: string): string => createHash("sha256").update(source).digest("hex").slice(0, 16);

/**
 * A deleted cell is `undefined` in a MergeableStore, which plain JSON writes as `null`, a real
 * value, bringing deleted rows back. TinyBase's own persisters write it as this character instead.
 */
const UNDEFINED = "￼";

export const encodeContent = (content: MergeableContent): string =>
  JSON.stringify(content, (_key, value: unknown) => (value === undefined ? UNDEFINED : value));

const restoreUndefined = (value: unknown): unknown => {
  if (value === UNDEFINED) return undefined;
  if (Array.isArray(value)) return value.map(restoreUndefined);
  if (typeof value === "object" && value !== null) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, restoreUndefined(v)]));
  return value;
};

export const decodeContent = (text: string): MergeableContent => restoreUndefined(JSON.parse(text)) as MergeableContent;

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
};

export type UserTable = keyof typeof REQUIRED;

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

  const parse = decodeContent;

  const apply = (content: MergeableContent) => {
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

  /** Merges every other client's saved copy that changed since it was last merged. Returns whether any did. */
  const mergeOthers = (): boolean => {
    const rows = db.prepare("SELECT client_id, rev FROM sync_stores WHERE client_id != ?").all(clientId) as { client_id: string; rev: number }[];
    const changed = rows.filter((r) => seen.get(r.client_id) !== r.rev);
    for (const { client_id, rev } of changed) {
      const row = db.prepare("SELECT content FROM sync_stores WHERE client_id = ?").get(client_id) as { content: string };
      apply(parse(row.content));
      seen.set(client_id, rev);
    }
    if (changed.length > 0) afterMerge();
    return changed.length > 0;
  };

  /**
   * Writes this client's copy. Another process of the same kind (two CLI runs at once) may have
   * saved since, so its copy is merged in first, under the write lock, and nothing is lost.
   */
  const save = () => {
    saving++;
    try {
      locked(() => {
        const own = db.prepare("SELECT content, rev FROM sync_stores WHERE client_id = ?").get(clientId) as { content: string; rev: number } | undefined;
        let content = store.getMergeableContent();
        if (own && seen.get(clientId) !== own.rev) {
          // TinyBase ignores changes made while a transaction is finishing, so merge in a scratch
          // store, save that, and catch the live store up straight after.
          const theirs = parse(own.content);
          const merged = createMergeableStore(undefined, getNow, MAX_CLOCK_SKEW_SECONDS).setMergeableContent(theirs).applyMergeableChanges(content);
          content = merged.getMergeableContent();
          queueMicrotask(() => apply(theirs));
        }
        const rev = (own?.rev ?? 0) + 1;
        db.prepare(
          `INSERT INTO sync_stores (client_id, content, rev, saved_at) VALUES (?, ?, ?, ?)
           ON CONFLICT (client_id) DO UPDATE SET content = excluded.content, rev = excluded.rev, saved_at = excluded.saved_at`,
        ).run(clientId, encodeContent(content), rev, Date.now());
        seen.set(clientId, rev);
      });
    } finally {
      saving--;
    }
  };

  const own = db.prepare("SELECT content, rev FROM sync_stores WHERE client_id = ?").get(clientId) as { content: string; rev: number } | undefined;
  if (own) {
    apply(parse(own.content));
    seen.set(clientId, own.rev);
  }
  mergeOthers();

  // Every local change is saved before the call that made it returns, so a CLI run can exit straight after.
  store.addDidFinishTransactionListener(() => {
    const [tables, values] = store.getTransactionChanges();
    if (saving === 0 && applying === 0 && Object.keys(tables).length + Object.keys(values).length > 0) save();
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
const LEGACY_USER_TABLES = new Set(["highlights", "notes", "harakat", "markers", "bookmarks", "progress", "conversations", "turns"]);

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
  rows: () => { table: UserTable; id: string; row: Record<string, Cell> }[];
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
      user.store.transaction(() => {
        for (const { table: target, id, row } of rows()) user.store.setRow(target, id, row);
        user.store.setValue(`migrated:${table}`, Date.now());
        user.store.setValue("schemaVersion", SCHEMA_VERSION);
      });
    }
    // In the same transaction as the copy, so no old write can land between the two.
    guard();
  });
};
