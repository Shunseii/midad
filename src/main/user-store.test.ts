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
  return { db, user, library: createLibrary({ db, corpus }), annotations: createAnnotations({ db }) };
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
    let t = 1_800_000_000_000;
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

describe("the saved format", () => {
  it("round-trips deletes as deletes, not as null cells", () => {
    const user = open({ clientId: "app" }).user;
    user.store.setRow("highlights", "x", { color: "a" });
    user.store.delRow("highlights", "x");
    const copy = open({ clientId: "cli" }).user;
    copy.store.applyMergeableChanges(decodeContent(encodeContent(user.store.getMergeableContent())));
    expect(copy.store.getTables()).toEqual({});
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
