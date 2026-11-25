import type { DatabaseSync } from "node:sqlite";
import type { CellOrUndefined, MergeableChanges, MergeableContent, ValueOrUndefined } from "tinybase";

/**
 * Each client's copy of the user store, saved one TinyBase row at a time: a save writes only the
 * rows its transaction changed, and other processes read only the rows saved since they last
 * looked. Laid out like TinyBase's fragmented Durable Object SQL persister, but synchronous, so a
 * write is on disk before the call that made it returns.
 *
 * Only cells and values are kept, each as [value, stamp, hash]. Rows, tables and the store itself
 * carry no times of their own in TinyBase's mergeable content, only hashes of what's inside, and
 * TinyBase recomputes those as it applies the rows as changes.
 *
 * This relies on the shape of TinyBase's mergeable content (tinybase 10.1.0, pinned): rerun
 * pnpm test:sync and the migration check when upgrading it.
 */

export const ROWS_SCHEMA = `
CREATE TABLE IF NOT EXISTS sync_rows (
  client_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  table_id TEXT NOT NULL,
  row_id TEXT NOT NULL,
  content TEXT NOT NULL,
  seq INTEGER NOT NULL,
  PRIMARY KEY (client_id, kind, table_id, row_id)
);
CREATE INDEX IF NOT EXISTS sync_rows_by_seq ON sync_rows (client_id, seq);
`;

/**
 * A deleted cell is `undefined` in a MergeableStore, which plain JSON writes as `null`, a real
 * value, bringing deleted rows back. TinyBase's own persisters write it as this character instead.
 */
const UNDEFINED = "￼";

const encode = (value: unknown): string => JSON.stringify(value, (_key, v: unknown) => (v === undefined ? UNDEFINED : v));

const restoreUndefined = (value: unknown): unknown => {
  if (value === UNDEFINED) return undefined;
  if (Array.isArray(value)) return value.map(restoreUndefined);
  if (typeof value === "object" && value !== null) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, restoreUndefined(v)]));
  return value;
};

const decode = <T>(text: string): T => restoreUndefined(JSON.parse(text)) as T;

export const encodeContent = (content: MergeableContent): string => encode(content);
export const decodeContent = (text: string): MergeableContent => decode<MergeableContent>(text);

/** A cell or value as saved: its value (undefined when deleted), its HLC stamp and its hash. */
type Stamped = [thing: CellOrUndefined | ValueOrUndefined, stamp: string, hash: number];
type Cells = Record<string, Stamped>;

/** Keeps the later stamp of each cell, exactly as TinyBase's own merge does (`stamp > oldStamp`). */
const mergeStamped = (a: Stamped | undefined, b: Stamped): Stamped => (a && a[1] >= b[1] ? a : b);

const mergeCells = (saved: Cells, incoming: Cells): Cells => {
  const merged: Cells = { ...saved };
  for (const [cellId, stamped] of Object.entries(incoming)) merged[cellId] = mergeStamped(saved[cellId], stamped);
  return merged;
};

/**
 * Writes what a transaction changed into this client's rows, merging cell by cell with what's
 * already saved, so a row another process of the same kind saved meanwhile keeps its newer cells.
 * Call it holding the write lock, with the seq to save the rows under.
 */
export const writeChanges = ({ db, clientId, changes, seq }: { db: DatabaseSync; clientId: string; changes: MergeableChanges<true>; seq: number }) => {
  const read = db.prepare("SELECT content FROM sync_rows WHERE client_id = ? AND kind = ? AND table_id = ? AND row_id = ?");
  const write = db.prepare(
    `INSERT INTO sync_rows (client_id, kind, table_id, row_id, content, seq) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (client_id, kind, table_id, row_id) DO UPDATE SET content = excluded.content, seq = excluded.seq`,
  );
  const [[tables], [values]] = changes;
  for (const [tableId, [rows]] of Object.entries(tables)) {
    for (const [rowId, [cells]] of Object.entries(rows)) {
      const saved = read.get(clientId, "row", tableId, rowId) as { content: string } | undefined;
      const merged = mergeCells(saved ? decode<Cells>(saved.content) : {}, cells as Cells);
      write.run(clientId, "row", tableId, rowId, encode(merged), seq);
    }
  }
  for (const [valueId, stamped] of Object.entries(values)) {
    const saved = read.get(clientId, "value", "", valueId) as { content: string } | undefined;
    write.run(clientId, "value", "", valueId, encode(mergeStamped(saved ? decode<Stamped>(saved.content) : undefined, stamped as Stamped)), seq);
  }
};

/** Writes a whole copy as rows (converting a saved blob, or in tests), under one seq. */
export const writeContent = ({ db, clientId, content, seq }: { db: DatabaseSync; clientId: string; content: MergeableContent; seq: number }) =>
  writeChanges({ db, clientId, changes: [content[0], content[1], 1] as unknown as MergeableChanges<true>, seq });

/**
 * A client's rows saved after `after`, as mergeable changes to apply, and the latest seq among
 * them. Applied as changes, TinyBase recomputes the row, table and store hashes as it merges.
 */
export const readChanges = ({ db, clientId, after = 0 }: { db: DatabaseSync; clientId: string; after?: number }): { changes: MergeableChanges; seq: number; count: number } => {
  const rows = db.prepare("SELECT kind, table_id, row_id, content, seq FROM sync_rows WHERE client_id = ? AND seq > ?").all(clientId, after) as {
    kind: string;
    table_id: string;
    row_id: string;
    content: string;
    seq: number;
  }[];
  const tables: Record<string, [Record<string, [Cells, string, number]>, string, number]> = {};
  const values: Record<string, Stamped> = {};
  let seq = after;
  for (const row of rows) {
    seq = Math.max(seq, row.seq);
    if (row.kind === "value") values[row.row_id] = decode<Stamped>(row.content);
    else {
      const table = (tables[row.table_id] ??= [{}, "", 0]);
      table[0][row.row_id] = [decode<Cells>(row.content), "", 0];
    }
  }
  return { changes: [[tables, "", 0], [values, "", 0], 1] as unknown as MergeableChanges, seq, count: rows.length };
};
