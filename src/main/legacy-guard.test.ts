import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ExportFile } from "../shared/corpus";
import { createAnnotations } from "./annotations";
import { createBookmarks } from "./bookmarks";
import { createConversations } from "./conversations";
import type { CorpusSource } from "./corpus";
import { createLibrary } from "./library";
import { createMarkers } from "./markers";
import { type ClientId, LEGACY_WRITE_ERROR, openUserStore } from "./user-store";

const PAGE = ["h", "", "---", "الكلام هو اللفظ المركب المفيد"].join("\n");
const corpus: CorpusSource = {
  getBook: async (id) => ({ id, title: "t", work: null }),
  exportBook: async (): Promise<ExportFile[]> => [{ file_id: "f1", page_number: 1, role: null, order_hint: null, state: "done", text: PAGE }],
};

// The user-data tables as the last build before the user store created them (master's store modules).
const OLD_SCHEMA = `
CREATE TABLE progress (book_id TEXT PRIMARY KEY REFERENCES books(book_id) ON DELETE CASCADE, file_id TEXT NOT NULL, updated_at INTEGER NOT NULL, anchor TEXT);
CREATE TABLE highlights (id TEXT PRIMARY KEY, book_id TEXT NOT NULL, file_id TEXT NOT NULL, span TEXT NOT NULL, quote TEXT NOT NULL, color TEXT NOT NULL,
  author TEXT NOT NULL, created_at INTEGER NOT NULL, FOREIGN KEY (book_id, file_id) REFERENCES pages (book_id, file_id) ON DELETE CASCADE);
CREATE TABLE notes (id TEXT PRIMARY KEY, book_id TEXT NOT NULL, file_id TEXT NOT NULL, span TEXT NOT NULL, quote TEXT NOT NULL, body TEXT NOT NULL,
  author TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, kind TEXT NOT NULL DEFAULT 'words',
  FOREIGN KEY (book_id, file_id) REFERENCES pages (book_id, file_id) ON DELETE CASCADE);
CREATE TABLE harakat (id TEXT PRIMARY KEY, book_id TEXT NOT NULL, file_id TEXT NOT NULL, part TEXT NOT NULL, line INTEGER NOT NULL, word INTEGER NOT NULL,
  letter INTEGER NOT NULL, marks TEXT NOT NULL, base TEXT NOT NULL, author TEXT NOT NULL, created_at INTEGER NOT NULL,
  UNIQUE (book_id, file_id, part, line, word, letter), FOREIGN KEY (book_id, file_id) REFERENCES pages (book_id, file_id) ON DELETE CASCADE);
CREATE TABLE markers (book_id TEXT PRIMARY KEY, file_id TEXT NOT NULL, part TEXT NOT NULL DEFAULT 'matn', line INTEGER NOT NULL, word INTEGER NOT NULL DEFAULT 1,
  set_at INTEGER NOT NULL, FOREIGN KEY (book_id, file_id) REFERENCES pages (book_id, file_id) ON DELETE CASCADE);
CREATE TABLE bookmarks (book_id TEXT NOT NULL, file_id TEXT NOT NULL, name TEXT, created_at INTEGER NOT NULL, PRIMARY KEY (book_id, file_id),
  FOREIGN KEY (book_id, file_id) REFERENCES pages (book_id, file_id) ON DELETE CASCADE);
CREATE TABLE conversations (id TEXT PRIMARY KEY, book_id TEXT NOT NULL REFERENCES books(book_id) ON DELETE CASCADE, session_id TEXT, title TEXT NOT NULL,
  position INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE turns (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE, question TEXT NOT NULL, quotes TEXT NOT NULL,
  position INTEGER NOT NULL, selection TEXT, answer TEXT NOT NULL DEFAULT '', status TEXT NOT NULL, error TEXT, created_at INTEGER NOT NULL);
INSERT INTO progress VALUES ('b1', 'f1', 1, NULL);
INSERT INTO highlights VALUES ('h1', 'b1', 'f1', '{"part":"matn","start":{"line":1,"word":1},"end":{"line":1,"word":1}}', 'الكلام', 'yellow', 'me', 1);
INSERT INTO notes VALUES ('n1', 'b1', 'f1', '{"part":"matn","start":{"line":1,"word":2},"end":{"line":1,"word":2}}', 'هو', 'old', 'me', 1, 1, 'words');
INSERT INTO harakat VALUES ('k1', 'b1', 'f1', 'matn', 1, 1, 2, 'َ', 'ل', 'me', 1);
INSERT INTO markers VALUES ('b1', 'f1', 'matn', 1, 1, 1);
INSERT INTO bookmarks VALUES ('b1', 'f1', NULL, 1);
INSERT INTO conversations VALUES ('c1', 'b1', 's1', 'old', 1, 1, 1);
INSERT INTO turns VALUES ('t1', 'c1', 'q', '[]', 1, NULL, 'a', 'done', NULL, 1);
`;

/** What the old store modules write, statement for statement (master's annotations, markers, bookmarks, library and conversations). */
const OLD_WRITES: [string, string, unknown[]][] = [
  ["add a highlight", "INSERT INTO highlights (id, book_id, file_id, span, quote, color, author, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", ["h2", "b1", "f1", "{}", "x", "green", "me", 2]],
  ["remove a highlight", "DELETE FROM highlights WHERE id = ?", ["h1"]],
  [
    "add a note",
    "INSERT INTO notes (id, book_id, file_id, kind, span, quote, body, author, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ["n2", "b1", "f1", "words", "{}", "x", "y", "me", 2, 2],
  ],
  ["edit a note", "UPDATE notes SET body = ?, updated_at = ? WHERE id = ?", ["new", 2, "n1"]],
  ["delete a note", "DELETE FROM notes WHERE id = ?", ["n1"]],
  [
    "set harakat",
    `INSERT INTO harakat (id, book_id, file_id, part, line, word, letter, marks, base, author, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (book_id, file_id, part, line, word, letter) DO UPDATE SET marks = excluded.marks, base = excluded.base, author = excluded.author`,
    ["k2", "b1", "f1", "matn", 1, 1, 2, "ُ", "ل", "me", 2],
  ],
  ["clear harakat", "DELETE FROM harakat WHERE id = ?", ["k1"]],
  [
    "set the marker",
    `INSERT INTO markers (book_id, file_id, part, line, word, set_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (book_id) DO UPDATE SET file_id = excluded.file_id, part = excluded.part, line = excluded.line, word = excluded.word, set_at = excluded.set_at`,
    ["b1", "f1", "matn", 1, 2, 2],
  ],
  ["clear the marker", "DELETE FROM markers WHERE book_id = ?", ["b1"]],
  [
    "set a bookmark",
    `INSERT INTO bookmarks (book_id, file_id, name, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (book_id, file_id) DO UPDATE SET name = excluded.name, created_at = CASE WHEN ? THEN excluded.created_at ELSE bookmarks.created_at END`,
    ["b1", "f1", "n", 2, 0],
  ],
  [
    "save the reading place",
    `INSERT INTO progress (book_id, file_id, updated_at, anchor) VALUES (?, ?, ?, ?)
     ON CONFLICT(book_id) DO UPDATE SET anchor = CASE WHEN excluded.anchor IS NULL AND progress.file_id = excluded.file_id THEN progress.anchor ELSE excluded.anchor END,
       file_id = excluded.file_id, updated_at = excluded.updated_at`,
    ["b1", "f1", 2, null],
  ],
  [
    "ask a question",
    `INSERT INTO conversations (id, book_id, session_id, title, position, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET updated_at = excluded.updated_at`,
    ["c1", "b1", "t", 1, 2, 2],
  ],
  ["finish an answer", "UPDATE turns SET answer = ?, status = ?, error = ? WHERE id = ?", ["b", "done", null, "t1"]],
  ["delete a conversation", "DELETE FROM turns WHERE conversation_id = ?", ["c1"]],
];

let dir: string;
let dbPath: string;
const connections: DatabaseSync[] = [];

const connect = () => {
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA busy_timeout = 5000;");
  connections.push(db);
  return db;
};

/** A new build's process: opening every store module migrates whatever it owns. */
const newBuild = (clientId: ClientId) => {
  const db = connect();
  const user = openUserStore({ db, clientId });
  const library = createLibrary({ db, corpus });
  return { db, user, library, annotations: createAnnotations({ db }), markers: createMarkers({ db }), bookmarks: createBookmarks({ db }), conversations: createConversations({ db }) };
};

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "midad-legacy-guard-"));
  dbPath = join(dir, "midad.db");
  const db = new DatabaseSync(dbPath);
  // The old build's library: books and pages, then its user-data tables, before any user store.
  db.exec(`CREATE TABLE books (book_id TEXT PRIMARY KEY, title TEXT NOT NULL, author TEXT, edition TEXT, imported_at INTEGER NOT NULL, synced_at INTEGER NOT NULL);
    CREATE TABLE pages (book_id TEXT NOT NULL REFERENCES books(book_id) ON DELETE CASCADE, file_id TEXT NOT NULL, position INTEGER NOT NULL, number INTEGER,
      order_hint INTEGER, header TEXT, matn TEXT NOT NULL, hashiya TEXT NOT NULL, source TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (book_id, file_id));
    INSERT INTO books VALUES ('b1', 't', NULL, NULL, 1, 1);`);
  db.prepare("INSERT INTO pages VALUES ('b1', 'f1', 1, 1, NULL, NULL, '[]', '[]', ?, 1)").run(PAGE);
  db.exec(OLD_SCHEMA);
  db.close();
});

afterEach(() => {
  for (const db of connections.splice(0)) db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("a build from before the user store, on a library a newer build migrated", () => {
  it("fails loudly on every write it would make, instead of writing where nobody reads", () => {
    newBuild("cli");
    // Like the reader's app left running on the old build after an update: its own connection, opened before.
    const old = connect();
    for (const [what, sql, args] of OLD_WRITES) {
      expect(() => old.prepare(sql).run(...(args as never[])), what).toThrow(LEGACY_WRITE_ERROR);
    }
    expect(old.prepare("SELECT COUNT(*) AS n FROM highlights").get()).toEqual({ n: 1 });
  });

  it("still lets the old tables be read, and every new process start and read and write the user store", async () => {
    newBuild("cli");
    const app = newBuild("app");
    expect((await app.annotations.listForPage({ bookId: "b1", position: 1 })).highlights.map((h) => h.id)).toEqual(["h1"]);
    await app.annotations.addHighlight({ bookId: "b1", position: 1, span: { part: "matn", start: { line: 1, word: 3 }, end: { line: 1, word: 3 } }, color: "pink" });
    await app.annotations.updateNote({ id: "n1", body: "new" });
    await app.library.setProgress({ bookId: "b1", position: 1 });
    await app.markers.clear({ bookId: "b1" });
    await app.bookmarks.set({ bookId: "b1", position: 1, name: "x" });
    await app.conversations.addTurn({ conversationId: "c1", bookId: "b1", turn: { id: "t2", question: "q2", quotes: [], position: 1, selection: null } });
    expect((await app.conversations.get({ id: "c1" }))?.turns.map((t) => t.id)).toEqual(["t1", "t2"]);
    expect(app.db.prepare("SELECT body FROM notes WHERE id = 'n1'").get()).toEqual({ body: "old" });
  });

  it("guards the old tables also when they were copied by a build from before the guard", () => {
    const first = newBuild("cli");
    for (const row of first.db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all() as { name: string }[]) first.db.exec(`DROP TRIGGER ${row.name}`);
    newBuild("app");
    expect(() => connect().prepare("DELETE FROM highlights WHERE id = 'h1'").run()).toThrow(LEGACY_WRITE_ERROR);
  });
});
