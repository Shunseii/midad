import { DatabaseSync } from "node:sqlite";
import type { BaharDb } from "./bahar";

/** A Bahar-shaped dictionary in an in-memory SQLite, for tests. */
export const dictionaryDb = (entries: { id: string; word: string; translation: string; type?: string; root?: string[]; tags?: string[] }[]): DatabaseSync => {
  const db = new DatabaseSync(":memory:");
  db.exec(
    "CREATE TABLE dictionary_entries (id TEXT PRIMARY KEY, word TEXT NOT NULL, translation TEXT NOT NULL, definition TEXT, type TEXT, root TEXT, tags TEXT, examples TEXT, created_at INTEGER)",
  );
  const insert = db.prepare("INSERT INTO dictionary_entries (id, word, translation, type, root, tags) VALUES (?, ?, ?, ?, ?, ?)");
  for (const e of entries) insert.run(e.id, e.word, e.translation, e.type ?? "ism", e.root ? JSON.stringify(e.root) : null, e.tags ? JSON.stringify(e.tags) : null);
  return db;
};

export const sqliteBaharDb = (db: DatabaseSync): BaharDb => ({
  execute: async ({ sql, args }) => ({ rows: db.prepare(sql).all(...args) as Record<string, unknown>[] }),
  close: () => {},
});
