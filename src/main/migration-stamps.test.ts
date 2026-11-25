import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ExportFile } from "../shared/corpus";
import { createAnnotations } from "./annotations";
import type { CorpusSource } from "./corpus";
import { createLibrary } from "./library";
import { openUserStore } from "./user-store";

const PAGE = ["h", "", "---", "الكلام هو اللفظ المركب المفيد"].join("\n");
const corpus: CorpusSource = {
  getBook: async (id) => ({ id, title: "t", work: null }),
  exportBook: async (): Promise<ExportFile[]> => [{ file_id: "f1", page_number: 1, role: null, order_hint: null, state: "done", text: PAGE }],
};
const SPAN = (word: number) => JSON.stringify({ part: "matn", start: { line: 1, word }, end: { line: 1, word } });
const DAY = 24 * 60 * 60 * 1000;

let dir: string;
const connections: DatabaseSync[] = [];

/** A library from before the user store, its rows last changed days ago. */
const legacyLibrary = () => {
  const path = join(dir, "legacy.db");
  const db = new DatabaseSync(path);
  const old = Date.now() - 10 * DAY;
  db.exec(`CREATE TABLE books (book_id TEXT PRIMARY KEY, title TEXT NOT NULL, author TEXT, edition TEXT, imported_at INTEGER NOT NULL, synced_at INTEGER NOT NULL);
    CREATE TABLE pages (book_id TEXT NOT NULL, file_id TEXT NOT NULL, position INTEGER NOT NULL, number INTEGER, order_hint INTEGER, header TEXT,
      matn TEXT NOT NULL, hashiya TEXT NOT NULL, source TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (book_id, file_id));
    CREATE TABLE highlights (id TEXT PRIMARY KEY, book_id TEXT NOT NULL, file_id TEXT NOT NULL, span TEXT NOT NULL, quote TEXT NOT NULL, color TEXT NOT NULL,
      author TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE notes (id TEXT PRIMARY KEY, book_id TEXT NOT NULL, file_id TEXT NOT NULL, span TEXT NOT NULL, quote TEXT NOT NULL, body TEXT NOT NULL,
      author TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, kind TEXT NOT NULL DEFAULT 'words');`);
  db.prepare("INSERT INTO books VALUES ('b1', 't', NULL, NULL, ?, ?)").run(old, old);
  db.prepare("INSERT INTO pages VALUES ('b1', 'f1', 1, 1, NULL, NULL, '[]', '[]', ?, ?)").run(PAGE, old);
  db.prepare("INSERT INTO highlights VALUES ('x', 'b1', 'f1', ?, 'الكلام', 'yellow', 'me', ?)").run(SPAN(1), old);
  db.prepare("INSERT INTO highlights VALUES ('kept', 'b1', 'f1', ?, 'هو', 'green', 'me', ?)").run(SPAN(2), old + 1);
  db.prepare("INSERT INTO notes VALUES ('y', 'b1', 'f1', ?, 'اللفظ', 'as it was', 'me', ?, ?, 'words')").run(SPAN(3), old, old + 5);
  db.close();
  return path;
};

/** One device starting the new build on its own copy of the library, which migrates it. */
const device = (legacy: string, name: string) => {
  const path = join(dir, `${name}.db`);
  copyFileSync(legacy, path);
  const db = new DatabaseSync(path);
  connections.push(db);
  const user = openUserStore({ db, clientId: "app" });
  createLibrary({ db, corpus });
  return { user, annotations: createAnnotations({ db }) };
};

/** What the sync server does: each device ends up with both devices' changes. */
const sync = (...devices: ReturnType<typeof device>[]) => {
  for (const from of devices) for (const to of devices) if (from !== to) to.user.store.applyMergeableChanges(from.user.store.getMergeableContent());
};

const seen = async (d: ReturnType<typeof device>) => {
  const { highlights, notes } = await d.annotations.listForPage({ bookId: "b1", position: 1 });
  return { highlights: highlights.map((h) => h.id).sort(), notes: notes.map((n) => [n.id, n.body]) };
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "midad-migration-stamps-"));
});

afterEach(() => {
  for (const db of connections.splice(0)) db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("a second device migrating an older copy of the same library", () => {
  it("doesn't bring back what the first device deleted or revert what it edited after migrating", async () => {
    const legacy = legacyLibrary();
    const a = device(legacy, "a");
    await a.annotations.removeHighlight({ id: "x" });
    await a.annotations.updateNote({ id: "y", body: "edited on A after migrating" });
    const c = device(legacy, "c");
    sync(a, c);
    for (const d of [a, c]) expect(await seen(d)).toEqual({ highlights: ["kept"], notes: [["y", "edited on A after migrating"]] });
  });

  it("does the same when C migrated before ever syncing and A's changes arrive later", async () => {
    const legacy = legacyLibrary();
    const a = device(legacy, "a");
    const c = device(legacy, "c");
    await a.annotations.removeHighlight({ id: "x" });
    await a.annotations.updateNote({ id: "y", body: "edited on A after migrating" });
    sync(a, c);
    for (const d of [a, c]) expect(await seen(d)).toEqual({ highlights: ["kept"], notes: [["y", "edited on A after migrating"]] });
  });

  it("converges on the same content from two identical copies, and stays put", async () => {
    const legacy = legacyLibrary();
    const a = device(legacy, "a");
    const c = device(legacy, "c");
    sync(a, c);
    const content = (d: ReturnType<typeof device>) => JSON.stringify(d.user.store.getTables());
    expect(content(a)).toBe(content(c));
    const settled = JSON.stringify(a.user.store.getMergeableContent());
    sync(a, c);
    sync(c, a);
    expect(JSON.stringify(a.user.store.getMergeableContent())).toBe(settled);
    expect(await seen(c)).toEqual({ highlights: ["kept", "x"], notes: [["y", "as it was"]] });
  });
});
