import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { removalCounts } from "../shared/library";
import { createAnnotations } from "./annotations";
import { createBookRemoval } from "./book-removal";
import { createBookmarks } from "./bookmarks";
import { createConversations } from "./conversations";
import type { CorpusSource } from "./corpus";
import { createLibrary } from "./library";
import { createMarkers } from "./markers";
import { createMemories } from "./memories";
import { type ClientId, openUserStore, type UserTable } from "./user-store";

const PAGE = "الكلام هو اللفظ المركب المفيد بالوضع";

const corpus: CorpusSource = {
  getBook: async (id) => ({ id, title: `Title ${id}`, work: null }),
  exportBook: async () =>
    [1, 2, 3].map((n) => ({ file_id: `f${n}`, page_number: n, role: null, order_hint: null, state: "done" as const, text: PAGE })),
};

let dir: string;
let clock = 1000;
const connections: DatabaseSync[] = [];

/** One process's view of a library file, with every module that keeps something about a book. */
const open = ({ file = "midad.db", clientId = "app" }: { file?: string; clientId?: ClientId } = {}) => {
  const db = new DatabaseSync(join(dir, file));
  db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
  connections.push(db);
  const user = openUserStore({ db, clientId, getNow: () => clock });
  const scansDir = join(dir, `${file}-scans`);
  return {
    db,
    user,
    scansDir,
    library: createLibrary({ db, corpus, now: () => clock, scansDir }),
    annotations: createAnnotations({ db, now: () => clock }),
    bookmarks: createBookmarks({ db, now: () => clock }),
    markers: createMarkers({ db, now: () => clock }),
    conversations: createConversations({ db, now: () => clock }),
    memories: createMemories({ db, now: () => clock }),
    removal: createBookRemoval({ db, scansDir }),
  };
};
type Device = ReturnType<typeof open>;

const span = { part: "matn" as const, start: { line: 1, word: 1 }, end: { line: 1, word: 2 } };

/** Reads, marks and chats about a book, so it has a row in every table removal clears. */
const useBook = async ({ device, bookId }: { device: Device; bookId: string }) => {
  await device.library.setProgress({ bookId, position: 2 });
  await device.annotations.addHighlight({ bookId, position: 1, span, color: "yellow", author: "me" });
  await device.annotations.addHighlight({ bookId, position: 2, span, color: "green", author: "me" });
  await device.annotations.addNote({ bookId, position: 1, span, body: "a note", author: "me" });
  await device.annotations.setHarakat({ bookId, position: 1, part: "matn", line: 1, word: 1, letter: 2, marks: "َ", author: "me" });
  await device.bookmarks.set({ bookId, position: 3 });
  await device.markers.set({ bookId, position: 1, line: 1, word: 1 });
  for (const n of [1, 2]) {
    await device.conversations.addTurn({ conversationId: `${bookId}-c${n}`, bookId, turn: { id: `${bookId}-t${n}`, question: "What is this?", quotes: [], position: 1, selection: null } });
  }
  await device.memories.add({ name: `goal-${bookId}`, description: "Reading for the definitions", body: "x", type: "book", bookId, author: "agent" });
};

const TABLES: UserTable[] = ["library", "progress", "markers", "highlights", "notes", "harakat", "bookmarks", "conversations", "turns", "memories"];

/** Every user-store row that mentions the book, by table. */
const rowsAbout = ({ device, bookId }: { device: Device; bookId: string }) => {
  const conversations = new Set(device.user.rows({ table: "conversations" }).filter(([, r]) => r.bookId === bookId).map(([id]) => id));
  return Object.fromEntries(
    TABLES.map((table) => [
      table,
      device.user.rows({ table }).filter(([id, r]) => (["library", "progress", "markers"].includes(table) ? id === bookId : table === "turns" ? conversations.has(String(r.conversationId)) : r.bookId === bookId)).length,
    ]),
  );
};

const pageCount = ({ device, bookId }: { device: Device; bookId: string }) => (device.db.prepare("SELECT COUNT(*) AS n FROM pages WHERE book_id = ?").get(bookId) as { n: number }).n;

let here: Device;

beforeEach(async () => {
  clock = 1000;
  dir = mkdtempSync(join(tmpdir(), "midad-removal-"));
  here = open();
  for (const bookId of ["b1", "b2"]) {
    await here.library.importBook({ corpusBookId: bookId });
    await useBook({ device: here, bookId });
  }
  await here.memories.add({ name: "transliterate", description: "Transliterate Arabic terms", body: "x", type: "preference", author: "agent" });
});

afterEach(() => {
  for (const db of connections.splice(0)) db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("removing a book", () => {
  it("counts what would go without changing anything", async () => {
    const before = rowsAbout({ device: here, bookId: "b1" });
    const preview = await here.removal.preview({ bookId: "b1" });
    expect(preview).toEqual({ bookId: "b1", title: "Title b1", pages: 3, highlights: 2, notes: 1, harakat: 1, bookmarks: 1, conversations: 2, memories: 1 });
    expect(removalCounts(preview!)).toBe("3 pages · 2 highlights · 1 note · 1 added haraka · 1 bookmark · 2 conversations · 1 memory");
    expect(rowsAbout({ device: here, bookId: "b1" })).toEqual(before);
    expect(pageCount({ device: here, bookId: "b1" })).toBe(3);
    expect(await here.removal.preview({ bookId: "nope" })).toBeNull();
  });

  it("deletes its pages, scans and every row about it, and leaves the other book and global memories alone", async () => {
    mkdirSync(join(here.scansDir, "b1"), { recursive: true });
    writeFileSync(join(here.scansDir, "b1", "f1.jpg"), "scan");
    mkdirSync(join(here.scansDir, "b2"), { recursive: true });
    const otherBefore = rowsAbout({ device: here, bookId: "b2" });

    await here.removal.remove({ bookId: "b1" });

    expect(Object.values(rowsAbout({ device: here, bookId: "b1" })).every((n) => n === 0)).toBe(true);
    expect(pageCount({ device: here, bookId: "b1" })).toBe(0);
    expect(existsSync(join(here.scansDir, "b1"))).toBe(false);
    expect((await here.library.listBooks()).map((b) => b.bookId)).toEqual(["b2"]);
    expect(await here.library.waitingBooks()).toEqual([]);
    expect(await here.conversations.list({ bookId: "b1" })).toEqual([]);
    expect(rowsAbout({ device: here, bookId: "b2" })).toEqual(otherBefore);
    expect(pageCount({ device: here, bookId: "b2" })).toBe(3);
    expect(existsSync(join(here.scansDir, "b2"))).toBe(true);
    expect((await here.memories.list()).map((m) => m.name).sort()).toEqual(["goal-b2", "transliterate"]);
    expect(await here.memories.search({ query: "definitions" })).toHaveLength(1);
  });

  it("clears its rows from the old tables kept as backups, which still refuse writes after", async () => {
    const db = new DatabaseSync(join(dir, "legacy.db"));
    connections.push(db);
    const library = createLibrary({ db, corpus });
    await library.importBook({ corpusBookId: "b1" });
    await library.importBook({ corpusBookId: "b2" });
    db.exec(`CREATE TABLE highlights (id TEXT PRIMARY KEY, book_id TEXT NOT NULL, file_id TEXT NOT NULL, span TEXT NOT NULL, quote TEXT NOT NULL,
      color TEXT NOT NULL, author TEXT NOT NULL, created_at INTEGER NOT NULL,
      FOREIGN KEY (book_id, file_id) REFERENCES pages (book_id, file_id) ON DELETE CASCADE);
      CREATE TABLE progress (book_id TEXT PRIMARY KEY REFERENCES books(book_id) ON DELETE CASCADE, file_id TEXT NOT NULL, updated_at INTEGER NOT NULL, anchor TEXT);`);
    for (const bookId of ["b1", "b2"]) {
      db.prepare("INSERT INTO highlights VALUES (?, ?, 'f1', ?, 'الكلام هو', 'yellow', 'me', 1)").run(`h-${bookId}`, bookId, JSON.stringify(span));
      db.prepare("INSERT INTO progress VALUES (?, 'f1', 1, NULL)").run(bookId);
    }
    createLibrary({ db, corpus });
    createAnnotations({ db });

    await createBookRemoval({ db }).remove({ bookId: "b1" });

    expect(db.prepare("SELECT id FROM highlights").all()).toEqual([{ id: "h-b2" }]);
    expect(db.prepare("SELECT book_id FROM progress").all()).toEqual([{ book_id: "b2" }]);
    expect(() => db.prepare("DELETE FROM highlights").run()).toThrow("this data has moved");
  });

  it("refuses a book that isn't in the library", async () => {
    await expect(here.removal.remove({ bookId: "nope" })).rejects.toThrow("not in the library");
  });

  it("is seen by the app's process as soon as the CLI removes it", async () => {
    const cli = open({ clientId: "cli" });
    await cli.removal.remove({ bookId: "b1" });
    here.user.mergeOthers();
    expect((await here.library.listBooks()).map((b) => b.bookId)).toEqual(["b2"]);
    expect(rowsAbout({ device: here, bookId: "b1" }).highlights).toBe(0);
    expect(await here.library.waitingBooks()).toEqual([]);
  });

  it("imports again afterwards like a fresh import", async () => {
    await here.removal.remove({ bookId: "b1" });
    clock = 2000;
    const result = await here.library.importBook({ corpusBookId: "b1" });
    expect(result).toEqual({ bookId: "b1", imported: 3, pending: 0 });
    const book = (await here.library.listBooks()).find((b) => b.bookId === "b1");
    expect(book).toMatchObject({ pageCount: 3, progress: null });
    expect(rowsAbout({ device: here, bookId: "b1" })).toEqual({ ...Object.fromEntries(TABLES.map((t) => [t, 0])), library: 1 });
  });
});

describe("removing a book on one device", () => {
  let there: Device;
  const sync = () => {
    there.user.store.applyMergeableChanges(here.user.store.getMergeableContent());
    here.user.store.applyMergeableChanges(there.user.store.getMergeableContent());
    there.user.runAfterMerge();
    here.user.runAfterMerge();
  };

  beforeEach(async () => {
    there = open({ file: "other.db" });
    sync();
    for (const bookId of ["b1", "b2"]) await there.library.importBook({ corpusBookId: bookId });
    sync();
    mkdirSync(join(there.scansDir, "b1"), { recursive: true });
  });

  it("removes it on the other: its rows, and its pages there, with nothing left waiting", async () => {
    expect(rowsAbout({ device: there, bookId: "b1" }).highlights).toBe(2);
    await here.removal.remove({ bookId: "b1" });
    sync();
    expect(Object.values(rowsAbout({ device: there, bookId: "b1" })).every((n) => n === 0)).toBe(true);
    expect(pageCount({ device: there, bookId: "b1" })).toBe(0);
    expect(existsSync(join(there.scansDir, "b1"))).toBe(false);
    expect((await there.library.listBooks()).map((b) => b.bookId)).toEqual(["b2"]);
    expect(await there.library.waitingBooks()).toEqual([]);
    expect(rowsAbout({ device: there, bookId: "b2" }).highlights).toBe(2);
    expect((await there.memories.list()).map((m) => m.name).sort()).toEqual(["goal-b2", "transliterate"]);
  });

  it("drops the pages when the other device next opens, if it was closed when the removal arrived", async () => {
    await here.removal.remove({ bookId: "b1" });
    there.user.store.applyMergeableChanges(here.user.store.getMergeableContent());
    const reopened = open({ file: "other.db", clientId: "cli" });
    expect(pageCount({ device: reopened, bookId: "b1" })).toBe(0);
    expect(await reopened.library.waitingBooks()).toEqual([]);
  });

  it("keeps a book whose library entry was never in the store", async () => {
    there.db.prepare("INSERT INTO books (book_id, title, imported_at, synced_at) VALUES ('local', 'Local', 1, 1)").run();
    const reopened = open({ file: "other.db", clientId: "cli" });
    expect((await reopened.library.listBooks()).map((b) => b.bookId)).toContain("local");
  });
});
