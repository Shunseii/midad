import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Span } from "../shared/annotations";
import type { ExportFile } from "../shared/corpus";
import { createAnnotations } from "./annotations";
import type { CorpusSource } from "./corpus";
import { createLibrary } from "./library";
import { type ClientId, decodeContent, encodeContent, openUserStore, textRev } from "./user-store";

const PAGE = ["h", "", "---", "الكلام هو اللفظ المركب المفيد", "بالوضع وأقسامه ثلاثة"].join("\n");
const file = (text: string): ExportFile => ({ file_id: "f1", page_number: 1, role: null, order_hint: null, state: "done", text });

class FakeCorpus implements CorpusSource {
  text = PAGE;
  async getBook(id: string) {
    return { id, title: "t", work: null };
  }
  async exportBook() {
    return [file(this.text)];
  }
}

const matn = (line: number, from: number, to: number = from): Span => ({ part: "matn", start: { line, word: from }, end: { line, word: to } });

let dir: string;
let dbPath: string;
const connections: DatabaseSync[] = [];

/** One process's view of the library file: its own connection and user store. */
const open = ({ clientId, getNow, corpus = new FakeCorpus() }: { clientId: ClientId; getNow?: () => number; corpus?: CorpusSource }) => {
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
  connections.push(db);
  const user = openUserStore({ db, clientId, ...(getNow ? { getNow } : {}) });
  return { db, user, library: createLibrary({ db, corpus, ...(getNow ? { now: getNow } : {}) }), annotations: createAnnotations({ db, ...(getNow ? { now: getNow } : {}) }) };
};

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "midad-user-store-"));
  dbPath = join(dir, "midad.db");
  const first = new DatabaseSync(dbPath);
  await createLibrary({ db: first, corpus: new FakeCorpus() }).importBook({ corpusBookId: "b1" });
  first.close();
});

afterEach(() => {
  for (const db of connections.splice(0)) db.close();
  rmSync(dir, { recursive: true, force: true });
});

const stamp = (user: ReturnType<typeof openUserStore>, id: string, cell: string) => user.store.getMergeableContent()[0][0].highlights?.[0][id]?.[0][cell]?.[1];

describe("clients sharing a library file", () => {
  it("merge each other's saved copies with the original change times", async () => {
    const app = open({ clientId: "app" });
    const cli = open({ clientId: "cli" });
    const h = await cli.annotations.addHighlight({ bookId: "b1", position: 1, span: matn(1, 1, 2), color: "green", author: "agent" });
    expect(app.user.mergeOthers()).toBe(true);
    expect((await app.annotations.listForPage({ bookId: "b1", position: 1 })).highlights.map((x) => x.id)).toEqual([h.id]);
    expect(stamp(app.user, h.id, "color")).toBe(stamp(cli.user, h.id, "color"));
  });

  it("keep a delete deleted through saving and loading", async () => {
    const cli = open({ clientId: "cli" });
    const h = await cli.annotations.addHighlight({ bookId: "b1", position: 1, span: matn(1, 1), color: "green" });
    await cli.annotations.removeHighlight({ id: h.id });
    const app = open({ clientId: "app" });
    expect((await app.annotations.listForPage({ bookId: "b1", position: 1 })).highlights).toEqual([]);
    expect(app.user.store.getRow("highlights", h.id)).toEqual({});
  });

  it("lose nothing when two processes of the same kind save at once", async () => {
    const first = open({ clientId: "cli" });
    const second = open({ clientId: "cli" });
    const a = await first.annotations.addHighlight({ bookId: "b1", position: 1, span: matn(1, 1), color: "green" });
    const b = await second.annotations.addHighlight({ bookId: "b1", position: 1, span: matn(1, 2), color: "pink" });
    const app = open({ clientId: "app" });
    expect((await app.annotations.listForPage({ bookId: "b1", position: 1 })).highlights.map((x) => x.id).sort()).toEqual([a.id, b.id].sort());
  });

  it("settle a recolour racing a delete by whichever happened last", async () => {
    let t = Date.now();
    const app = open({ clientId: "app", getNow: () => t });
    const h = await app.annotations.addHighlight({ bookId: "b1", position: 1, span: matn(1, 1), color: "green" });
    const cli = open({ clientId: "cli", getNow: () => t });
    t += 1000;
    cli.user.store.setCell("highlights", h.id, "color", "pink");
    t += 1000;
    app.user.store.delRow("highlights", h.id);
    app.user.mergeOthers();
    expect(app.user.row({ table: "highlights", id: h.id })).toBeNull();
    // A partial row (an edit after another client's delete) is hidden rather than shown half-filled.
    t += 1000;
    cli.user.store.setCell("highlights", h.id, "color", "blue");
    app.user.mergeOthers();
    expect(app.user.store.getCell("highlights", h.id, "color")).toBe("blue");
    expect((await app.annotations.listForPage({ bookId: "b1", position: 1 })).highlights).toEqual([]);
  });
});

describe("notes from two clients", () => {
  it("make one page note when both add it, keeping the newer text", async () => {
    let t = Date.now();
    const app = open({ clientId: "app", getNow: () => t });
    const cli = open({ clientId: "cli", getNow: () => t });
    const fromCli = await cli.annotations.addNote({ bookId: "b1", position: 1, page: true, body: "from the agent", author: "agent" });
    t += 1000;
    const fromApp = await app.annotations.addNote({ bookId: "b1", position: 1, page: true, body: "from the reader" });
    expect(fromApp.id).toBe(fromCli.id);
    app.user.mergeOthers();
    cli.user.mergeOthers();
    for (const client of [app, cli]) {
      const { pageNote } = await client.annotations.listForPage({ bookId: "b1", position: 1 });
      expect(pageNote).toMatchObject({ id: "b1:f1", body: "from the reader", author: "me" });
      expect(client.user.rows({ table: "notes" })).toHaveLength(1);
    }
  });

  it("settle a delete racing an edit by whichever came last, never leaving half a note", async () => {
    let t = Date.now();
    const app = open({ clientId: "app", getNow: () => t });
    const n = await app.annotations.addNote({ bookId: "b1", position: 1, span: matn(1, 1, 2), body: "first" });
    const cli = open({ clientId: "cli", getNow: () => t });
    t += 1000;
    await cli.annotations.updateNote({ id: n.id, body: "edited before the delete" });
    t += 1000;
    await app.annotations.deleteNote({ id: n.id });
    app.user.mergeOthers();
    expect((await app.annotations.listForPage({ bookId: "b1", position: 1 })).notes).toEqual([]);

    // An edit made after the delete (on a client that hadn't seen it) brings the whole note back.
    const offline = open({ clientId: "corpus", getNow: () => t - 1500 });
    offline.user.store.setRow("notes", n.id, { ...cli.user.store.getRow("notes", n.id) });
    t += 1000;
    offline.user.store.setRow("notes", n.id, { ...offline.user.store.getRow("notes", n.id), body: "edited after the delete", updatedAt: t });
    app.user.mergeOthers();
    expect((await app.annotations.listForPage({ bookId: "b1", position: 1 })).notes).toMatchObject([{ id: n.id, body: "edited after the delete", quote: "الكلام هو" }]);
  });
});

describe("harakat from two clients on one letter", () => {
  it("show the newest, and the older row is deleted the same way on every client", async () => {
    let t = Date.now();
    const app = open({ clientId: "app", getNow: () => t });
    const cli = open({ clientId: "cli", getNow: () => t });
    await app.annotations.setHarakat({ bookId: "b1", position: 1, part: "matn", line: 1, word: 1, letter: 2, marks: "َ" });
    t += 1000;
    await cli.annotations.setHarakat({ bookId: "b1", position: 1, part: "matn", line: 1, word: 1, letter: 2, marks: "ُ", author: "agent" });
    expect(app.user.store.getRowCount("harakat") + cli.user.store.getRowCount("harakat")).toBe(2);
    app.user.mergeOthers();
    cli.user.mergeOthers();
    for (const client of [app, cli]) {
      expect((await client.annotations.listForPage({ bookId: "b1", position: 1 })).harakat).toMatchObject([{ letter: 2, marks: "ُ", author: "agent" }]);
      expect(client.user.rows({ table: "harakat" })).toHaveLength(1);
    }
    const reopened = open({ clientId: "app" });
    expect(reopened.user.rows({ table: "harakat" })).toHaveLength(1);
  });
});

describe("migrating notes and harakat from SQLite", () => {
  it("keeps every id, except a page note, which takes its page's id", async () => {
    const db = new DatabaseSync(dbPath);
    db.exec(`CREATE TABLE notes (id TEXT PRIMARY KEY, book_id TEXT NOT NULL, file_id TEXT NOT NULL, span TEXT NOT NULL, quote TEXT NOT NULL,
        body TEXT NOT NULL, author TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, kind TEXT NOT NULL DEFAULT 'words');
      CREATE TABLE harakat (id TEXT PRIMARY KEY, book_id TEXT NOT NULL, file_id TEXT NOT NULL, part TEXT NOT NULL, line INTEGER NOT NULL,
        word INTEGER NOT NULL, letter INTEGER NOT NULL, marks TEXT NOT NULL, base TEXT NOT NULL, author TEXT NOT NULL, created_at INTEGER NOT NULL)`);
    db.prepare("INSERT INTO notes VALUES ('n1', 'b1', 'f1', ?, 'الكلام', 'words', 'me', 1, 2, 'words')").run(JSON.stringify(matn(1, 1)));
    db.prepare("INSERT INTO notes VALUES ('n2', 'b1', 'f1', 'null', '', 'page', 'agent', 3, 4, 'page')").run();
    db.prepare("INSERT INTO harakat VALUES ('k1', 'b1', 'f1', 'matn', 1, 1, 2, ?, 'ل', 'me', 5)").run("َ");
    db.close();
    const app = open({ clientId: "app" });
    const found = await app.annotations.listForPage({ bookId: "b1", position: 1 });
    expect(found.notes).toMatchObject([{ id: "n1", body: "words", createdAt: 1, updatedAt: 2 }]);
    expect(found.pageNote).toMatchObject({ id: "b1:f1", body: "page", author: "agent", createdAt: 3, updatedAt: 4 });
    expect(found.harakat).toMatchObject([{ id: "k1", base: "ل", marks: "َ", createdAt: 5, stale: false }]);
  });
});

describe("migrating the marker, bookmarks, progress and library from SQLite", () => {
  it("copies each row once, keyed as before", async () => {
    const db = new DatabaseSync(dbPath);
    db.exec(`CREATE TABLE markers (book_id TEXT PRIMARY KEY, file_id TEXT NOT NULL, part TEXT NOT NULL DEFAULT 'matn', line INTEGER NOT NULL, word INTEGER NOT NULL DEFAULT 1, set_at INTEGER NOT NULL);
      CREATE TABLE bookmarks (book_id TEXT NOT NULL, file_id TEXT NOT NULL, name TEXT, created_at INTEGER NOT NULL, PRIMARY KEY (book_id, file_id));
      CREATE TABLE progress (book_id TEXT PRIMARY KEY, file_id TEXT NOT NULL, updated_at INTEGER NOT NULL, anchor TEXT);
      INSERT INTO markers VALUES ('b1', 'f1', 'matn', 2, 3, 7);
      INSERT INTO bookmarks VALUES ('b1', 'f1', NULL, 8);
      INSERT INTO progress VALUES ('b1', 'f1', 9, '{"part":"matn","line":1,"word":2,"offset":0.5}');`);
    db.close();
    const app = open({ clientId: "app" });
    const { createMarkers } = await import("./markers");
    const { createBookmarks } = await import("./bookmarks");
    expect(await createMarkers({ db: app.db }).get({ bookId: "b1" })).toEqual({ position: 1, part: "matn", line: 2, word: 3, setAt: 7 });
    expect(await createBookmarks({ db: app.db }).list({ bookId: "b1" })).toEqual([{ position: 1, name: null, createdAt: 8 }]);
    expect((await app.library.getBook("b1"))?.progress).toEqual({ position: 1, updatedAt: 9, anchor: { part: "matn", line: 1, word: 2, offset: 0.5 } });
    expect(app.user.row({ table: "library", id: "b1" })).toMatchObject({ addedAt: expect.any(Number) });
  });
});

describe("a clock that was set wrong", () => {
  it("doesn't drop changes stamped while it ran ahead once it is set back", async () => {
    const ahead = open({ clientId: "cli", getNow: () => Date.now() + 90 * 24 * 60 * 60 * 1000 });
    const h = await ahead.annotations.addHighlight({ bookId: "b1", position: 1, span: matn(1, 1), color: "green" });
    const setBack = open({ clientId: "cli" });
    await setBack.annotations.addHighlight({ bookId: "b1", position: 1, span: matn(1, 2), color: "pink" });
    const app = open({ clientId: "app" });
    expect((await app.annotations.listForPage({ bookId: "b1", position: 1 })).highlights.map((x) => x.id)).toContain(h.id);
  });
});

describe("the saved format", () => {
  it("round-trips deletes as deletes, not as null cells", () => {
    const user = open({ clientId: "app" }).user;
    user.store.setRow("highlights", "x", { color: "a" });
    user.store.delRow("highlights", "x");
    const copy = open({ clientId: "cli" }).user;
    copy.store.applyMergeableChanges(decodeContent(encodeContent(user.store.getMergeableContent())));
    expect(copy.store.getTable("highlights")).toEqual({});
  });
});

describe("migrating highlights from SQLite", () => {
  const legacy = () => {
    const db = new DatabaseSync(dbPath);
    db.exec(`CREATE TABLE highlights (id TEXT PRIMARY KEY, book_id TEXT NOT NULL, file_id TEXT NOT NULL, span TEXT NOT NULL,
      quote TEXT NOT NULL, color TEXT NOT NULL, author TEXT NOT NULL, created_at INTEGER NOT NULL)`);
    db.prepare("INSERT INTO highlights VALUES ('h1', 'b1', 'f1', ?, 'الكلام', 'yellow', 'me', 5)").run(JSON.stringify(matn(1, 1)));
    db.close();
  };

  it("copies them once with their ids, from whichever process starts first, and leaves the table alone", async () => {
    legacy();
    const app = open({ clientId: "app" });
    const cli = open({ clientId: "cli" });
    for (const client of [app, cli]) {
      expect((await client.annotations.listForPage({ bookId: "b1", position: 1 })).highlights).toMatchObject([
        { id: "h1", color: "yellow", quote: "الكلام", createdAt: 5, stale: false },
      ]);
    }
    expect(app.user.store.getCell("highlights", "h1", "textRev")).toBe(textRev(PAGE));
    expect(app.db.prepare("SELECT COUNT(*) AS n FROM highlights").get()).toEqual({ n: 1 });
  });

  it("doesn't bring back a highlight deleted after the copy", async () => {
    legacy();
    const app = open({ clientId: "app" });
    await app.annotations.removeHighlight({ id: "h1" });
    const cli = open({ clientId: "cli" });
    expect((await cli.annotations.listForPage({ bookId: "b1", position: 1 })).highlights).toEqual([]);
  });
});

describe("re-pinning after a text fix", () => {
  it("moves each pin once when the fix dies between re-pinning and writing the text, then runs again", async () => {
    const corpus = new FakeCorpus();
    const app = open({ clientId: "app", corpus });
    const h = await app.annotations.addHighlight({ bookId: "b1", position: 1, span: matn(1, 4, 5), color: "green" });
    const fixed = PAGE.replace("الكلام هو", "إن الكلام هو");
    corpus.text = fixed;

    const crashing = new DatabaseSync(dbPath);
    connections.push(crashing);
    openUserStore({ db: crashing, clientId: "corpus" });
    const dying = createLibrary({
      db: crashing,
      corpus,
      onRepinned: () => {
        throw new Error("killed");
      },
    });
    await expect(dying.syncBook({ bookId: "b1", mode: "overwrite", fileIds: ["f1"] })).rejects.toThrow("killed");
    expect(crashing.prepare("SELECT source FROM pages").get()).toEqual({ source: PAGE });

    const rerun = open({ clientId: "corpus", corpus });
    await rerun.library.syncBook({ bookId: "b1", mode: "overwrite", fileIds: ["f1"] });
    app.user.mergeOthers();
    const after = await app.annotations.listForPage({ bookId: "b1", position: 1 });
    expect(after.highlights).toMatchObject([{ id: h.id, span: matn(1, 5, 6), quote: "المركب المفيد", stale: false }]);
    expect(app.user.store.getCell("highlights", h.id, "textRev")).toBe(textRev(fixed));
  });
});
