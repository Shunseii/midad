import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MemoryType } from "../shared/memories";
import type { CorpusSource } from "./corpus";
import { createLibrary } from "./library";
import { cleanMemoryName, createMemories, matchQuery, type Memories } from "./memories";
import { type ClientId, LEGACY_WRITE_ERROR, openUserStore } from "./user-store";

const corpus: CorpusSource = {
  getBook: async (id) => ({ id, title: `Title ${id}`, work: null }),
  exportBook: async () => [{ file_id: "f1", page_number: 1, role: null, order_hint: null, state: "done", text: "h\n\n---\nالكلام هو اللفظ" }],
};

let dir: string;
let clock = 1000;
const connections: DatabaseSync[] = [];

/** One process's view of a library file: its own connection, user store and memories. */
const open = ({ file = "midad.db", clientId = "app" }: { file?: string; clientId?: ClientId } = {}) => {
  const db = new DatabaseSync(join(dir, file));
  db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
  connections.push(db);
  const user = openUserStore({ db, clientId, getNow: () => clock });
  return { db, user, library: createLibrary({ db, corpus, now: () => clock }), memories: createMemories({ db, now: () => clock }) };
};

const importBooks = async (file = "midad.db") => {
  const db = new DatabaseSync(join(dir, file));
  const library = createLibrary({ db, corpus });
  await library.importBook({ corpusBookId: "b1" });
  await library.importBook({ corpusBookId: "b2" });
  db.close();
};

let memories: Memories;

beforeEach(async () => {
  clock = 1000;
  dir = mkdtempSync(join(tmpdir(), "midad-memories-"));
  await importBooks();
  memories = open().memories;
});

afterEach(() => {
  for (const db of connections.splice(0)) db.close();
  rmSync(dir, { recursive: true, force: true });
});

const fact = (name: string, description: string, body = description, type: MemoryType = "preference") => ({ name, description, body, type, author: "agent" as const });

const TOPICS = ["answers", "harakat", "iʿrāb", "grammar", "translation", "length", "Arabic", "teacher", "madhab", "nahw", "sarf", "balagha", "fiqh", "usul", "page"];
const VERBS = ["prefers", "likes", "asked for", "dislikes", "wants", "studies", "reviews", "skips", "repeats", "notes"];
const QUALITIES = ["short", "detailed", "formal", "simple", "slow", "careful", "vowelled", "literal", "loose", "brief"];

/** Plausible memories that share words with the ones searched for, so ranking matters. */
const distractors = async (count: number) => {
  for (let i = 0; i < count; i++) {
    const topic = TOPICS[i % TOPICS.length];
    const verb = VERBS[Math.floor(i / TOPICS.length) % VERBS.length];
    const quality = QUALITIES[(i * 7) % QUALITIES.length];
    await memories.add(fact(`filler-${i}`, `Reader ${verb} ${quality} ${topic} (${i})`, `The reader ${verb} ${quality} ${topic} in session ${i}.`));
  }
};

describe("Ask AI memory", () => {
  it("saves a global memory by default and gets it back", async () => {
    const saved = await memories.add(fact("Transliterate terms", "Always transliterate Arabic terms in English answers", "Write the transliteration after each Arabic term."));
    expect(saved).toMatchObject({ name: "transliterate-terms", type: "preference", bookId: null, author: "agent", editedAt: null, createdAt: 1000, updatedAt: 1000 });
    expect(saved.id).toMatch(/^[0-9a-f]{8}$/);
    expect(await memories.get({ id: saved.id })).toEqual(saved);
  });

  it("refuses a second memory with the same name in the same scope, naming the one to update", async () => {
    const first = await memories.add(fact("short-answers", "Keep answers short"));
    await expect(memories.add(fact("Short answers", "Answers should be brief"))).rejects.toThrow(`already exists (${first.id}). Update it`);
    expect(await memories.list()).toHaveLength(1);
  });

  it("allows the same name globally and in each book", async () => {
    await memories.add(fact("terms", "Transliterate terms"));
    await memories.add({ ...fact("terms", "Use the author's terms", "x", "feedback"), bookId: "b1" });
    await expect(memories.add({ ...fact("terms", "Keep the Kufan terms", "y", "feedback"), bookId: "b2" })).resolves.toMatchObject({ bookId: "b2" });
  });

  it("updates a memory in place: the author stays, it shows as edited, and search finds the new words only", async () => {
    const m = await memories.add(fact("answer-length", "Keep answers short", "Two sentences at most."));
    clock = 2000;
    const updated = await memories.update({ id: m.id, description: "Answers can be detailed when asked about grammar", body: "Detailed answers for grammar questions." });
    expect(updated).toMatchObject({ id: m.id, author: "agent", editedAt: 2000, createdAt: 1000, updatedAt: 2000, name: "answer-length" });
    expect(await memories.list()).toHaveLength(1);
    expect(await memories.search({ query: "short sentences" })).toEqual([]);
    expect((await memories.search({ query: "detailed grammar" })).map((x) => x.id)).toEqual([m.id]);
  });

  it("moves a memory between global and a book", async () => {
    const m = await memories.add(fact("terms", "Use the author's own terms"));
    expect(await memories.update({ id: m.id, bookId: "b1" })).toMatchObject({ bookId: "b1", bookTitle: "Title b1" });
    expect(await memories.update({ id: m.id, bookId: null })).toMatchObject({ bookId: null, bookTitle: null });
  });

  it("refuses a rename onto another memory's name", async () => {
    await memories.add(fact("a", "First"));
    const b = await memories.add(fact("b", "Second"));
    await expect(memories.update({ id: b.id, name: "a" })).rejects.toThrow("already exists");
  });

  it("deletes a memory and drops it from search", async () => {
    const m = await memories.add(fact("transliterate", "Always transliterate Arabic terms"));
    expect(await memories.search({ query: "transliterate" })).toHaveLength(1);
    await memories.remove({ id: m.id });
    expect(await memories.get({ id: m.id })).toBeNull();
    expect(await memories.search({ query: "transliterate" })).toEqual([]);
    await expect(memories.remove({ id: m.id })).rejects.toThrow("no memory");
  });

  it("restores a deleted memory exactly, searchable again, for undo", async () => {
    const m = await memories.add(fact("transliterate", "Always transliterate Arabic terms"));
    await memories.remove({ id: m.id });
    await memories.restore({ memory: m });
    expect(await memories.get({ id: m.id })).toEqual(m);
    expect((await memories.search({ query: "transliterate" })).map((x) => x.id)).toEqual([m.id]);
    await memories.restore({ memory: m });
    expect(await memories.list()).toHaveLength(1);
  });

  it("keeps facts short and refuses page text", async () => {
    await expect(memories.add(fact("page", "The page", "ك".repeat(1001)))).rejects.toThrow("Don't save page text");
    await expect(memories.add(fact("x", "two\nlines"))).resolves.toMatchObject({ description: "two lines" });
    await expect(memories.add(fact("", "No name"))).rejects.toThrow("short name");
    await expect(memories.add({ ...fact("t", "Bad type"), type: "note" as MemoryType })).rejects.toThrow("type is one of");
    await expect(memories.add(fact("goal", "A goal", "x", "book"))).rejects.toThrow("needs the book");
  });

  describe("scope", () => {
    beforeEach(async () => {
      await memories.add(fact("transliterate", "Always transliterate Arabic terms"));
      await memories.add({ ...fact("b1-goal", "Studying this book with a teacher for the exam", "Exam in spring.", "book"), bookId: "b1" });
      await memories.add({ ...fact("b2-goal", "Reading this book to review the exam material", "Self study.", "book"), bookId: "b2" });
    });

    const names = (found: { name: string }[]) => found.map((m) => m.name).sort();

    it("lists everything without a filter, with each book's title", async () => {
      const all = await memories.list();
      expect(names(all)).toEqual(["b1-goal", "b2-goal", "transliterate"]);
      expect(all.find((m) => m.name === "b1-goal")?.bookTitle).toBe("Title b1");
    });

    it("gives a chat the global memories and its own book's", async () => {
      expect(names(await memories.list({ filter: { global: true, bookId: "b1" } }))).toEqual(["b1-goal", "transliterate"]);
      expect(names(await memories.search({ query: "exam", filter: { global: true, bookId: "b2" } }))).toEqual(["b2-goal"]);
    });

    it("narrows to global only, or to one book only", async () => {
      expect(names(await memories.list({ filter: { global: true } }))).toEqual(["transliterate"]);
      expect(names(await memories.list({ filter: { bookId: "b1" } }))).toEqual(["b1-goal"]);
      expect(await memories.search({ query: "exam", filter: { global: true } })).toEqual([]);
      expect(names(await memories.search({ query: "exam transliterate", filter: { bookId: "b2" } }))).toEqual(["b2-goal"]);
    });

    it("filters by type", async () => {
      expect(names(await memories.list({ type: "book" }))).toEqual(["b1-goal", "b2-goal"]);
    });
  });

  describe("search", () => {
    it("ranks the right memory first among hundreds", async () => {
      await distractors(400);
      const transliterate = await memories.add(fact("transliterate-terms", "Always transliterate Arabic terms in English answers", "Give a transliteration like kalām after each term."));
      const teacher = await memories.add(fact("teacher", "Reader studies with Shaykh Ahmad, who teaches the Hanbali madhab", "Their teacher is Shaykh Ahmad.", "reader"));
      const irab = await memories.add(fact("irab-feedback", "Don't give the full iʿrāb unless asked; hint at the case ending", "Why: wants to work it out. How to apply: hint first.", "feedback"));

      expect((await memories.search({ query: "transliteration" }))[0]?.id).toBe(transliterate.id);
      expect((await memories.search({ query: "how should I write Arabic terms" }))[0]?.id).toBe(transliterate.id);
      expect((await memories.search({ query: "shaykh teacher" }))[0]?.id).toBe(teacher.id);
      expect((await memories.search({ query: "irab" }))[0]?.id).toBe(irab.id);
      expect(await memories.search({ query: "arabic", limit: 3 })).toHaveLength(3);
    });

    it("matches Arabic with or without harakat and hamza seats", async () => {
      const m = await memories.add(fact("kalam", "Reader asks about الكلام and الإعراب", "x"));
      expect((await memories.search({ query: "الْكَلَامُ" })).map((x) => x.id)).toEqual([m.id]);
      expect((await memories.search({ query: "الاعراب" })).map((x) => x.id)).toEqual([m.id]);
    });

    it("matches word prefixes and stems", async () => {
      const m = await memories.add(fact("vowels", "Vowelled readings for every quoted line"));
      expect((await memories.search({ query: "vowel" })).map((x) => x.id)).toEqual([m.id]);
      expect((await memories.search({ query: "reading" })).map((x) => x.id)).toEqual([m.id]);
    });

    it("finds nothing for a query with no words, and survives FTS syntax in the query", async () => {
      await memories.add(fact("x", "Something"));
      expect(await memories.search({ query: "  ?! " })).toEqual([]);
      expect(await memories.search({ query: 'NEAR("a" OR) * something' })).toHaveLength(1);
    });
  });
});

describe("memories across processes and devices", () => {
  it("are found by another process's search as soon as one saves them", async () => {
    const cli = open({ clientId: "cli" });
    const m = await cli.memories.add(fact("transliterate", "Always transliterate Arabic terms"));
    expect((await memories.search({ query: "transliterate" })).map((x) => x.id)).toEqual([m.id]);
    await cli.memories.update({ id: m.id, description: "Answer in Urdu", body: "Urdu, please." });
    expect(await memories.search({ query: "always" })).toEqual([]);
    expect((await memories.search({ query: "urdu" })).map((x) => x.id)).toEqual([m.id]);
  });

  it("sync between two devices, edits and deletes included, and each device's search follows", async () => {
    await importBooks("other.db");
    const here = open();
    const there = open({ file: "other.db" });
    const sync = () => {
      there.user.store.applyMergeableChanges(here.user.store.getMergeableContent());
      here.user.store.applyMergeableChanges(there.user.store.getMergeableContent());
    };

    const global = await here.memories.add(fact("transliterate", "Always transliterate Arabic terms"));
    const book = await here.memories.add({ ...fact("goal", "Memorising the definitions", "x", "book"), bookId: "b1" });
    sync();
    expect((await there.memories.list()).map((m) => m.id).sort()).toEqual([global.id, book.id].sort());
    expect((await there.memories.search({ query: "transliterate" })).map((m) => m.id)).toEqual([global.id]);

    clock = 2000;
    await there.memories.update({ id: global.id, body: "Write الاسم (ism)." });
    await here.memories.remove({ id: book.id });
    sync();
    for (const device of [here, there]) {
      expect((await device.memories.list()).map((m) => m.id)).toEqual([global.id]);
      expect(await device.memories.get({ id: global.id })).toMatchObject({ body: "Write الاسم (ism).", author: "agent", editedAt: 2000 });
      expect(await device.memories.search({ query: "memorising" })).toEqual([]);
    }
  });

  it("name a book this device hasn't imported by the title another device gave it", async () => {
    const here = open();
    here.user.store.setRow("library", "elsewhere", { addedAt: 1, title: "قطر الندى", author: null });
    const m = await here.memories.add({ ...fact("goal", "Reading for the examples", "x", "book"), bookId: "elsewhere" });
    expect(m.bookTitle).toBe("قطر الندى");
  });
});

describe("memories saved in SQLite by earlier builds", () => {
  const legacy = () => {
    const db = new DatabaseSync(join(dir, "legacy.db"));
    const library = createLibrary({ db, corpus });
    return library.importBook({ corpusBookId: "b1" }).then(() => {
      db.exec(`CREATE TABLE memories (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, type TEXT NOT NULL, body TEXT NOT NULL,
        book_id TEXT, source TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
        CREATE VIRTUAL TABLE memories_fts USING fts5(name, description, body);`);
      const insert = db.prepare("INSERT INTO memories VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
      insert.run("aaaa0001", "transliterate", "Always transliterate Arabic terms", "preference", "Write kalām.", null, "agent", 100, 100);
      insert.run("aaaa0002", "goal", "Memorising the definitions", "book", "Exam in spring.", "b1", "reader", 100, 300);
      db.close();
    });
  };

  it("are copied in once, keeping ids, authors and when they last changed, and the old table refuses writes", async () => {
    await legacy();
    const app = open({ file: "legacy.db" });
    const cli = open({ file: "legacy.db", clientId: "cli" });
    for (const client of [app, cli]) {
      expect(await client.memories.list()).toMatchObject([
        { id: "aaaa0002", bookId: "b1", author: "reader", editedAt: 300, createdAt: 100, updatedAt: 300 },
        { id: "aaaa0001", bookId: null, author: "agent", editedAt: null },
      ]);
      expect((await client.memories.search({ query: "transliterate" })).map((m) => m.id)).toEqual(["aaaa0001"]);
    }
    expect(() => app.db.prepare("DELETE FROM memories").run()).toThrow(LEGACY_WRITE_ERROR);
    expect(app.db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'memories_fts'").get()).toBeUndefined();
  });

  it("are stamped when they last changed, so an older copy migrated later doesn't undo a newer edit", async () => {
    await legacy();
    copyFileSync(join(dir, "legacy.db"), join(dir, "backup.db"));
    const first = open({ file: "legacy.db" });
    clock = 500;
    await first.memories.update({ id: "aaaa0001", body: "Write kalām (الكلام)." });
    const late = open({ file: "backup.db" });
    late.user.store.applyMergeableChanges(first.user.store.getMergeableContent());
    expect(await late.memories.get({ id: "aaaa0001" })).toMatchObject({ body: "Write kalām (الكلام).", editedAt: 500 });
  });

  it("don't come back after being deleted once copied", async () => {
    await legacy();
    const app = open({ file: "legacy.db" });
    await app.memories.remove({ id: "aaaa0001" });
    const cli = open({ file: "legacy.db", clientId: "cli" });
    expect((await cli.memories.list()).map((m) => m.id)).toEqual(["aaaa0002"]);
  });
});

describe("memory names and queries", () => {
  it("cleans names into short slugs", () => {
    expect(cleanMemoryName("  Transliterate Arabic terms! ")).toBe("transliterate-arabic-terms");
    expect(cleanMemoryName("x".repeat(100))).toHaveLength(60);
  });

  it("quotes each word as a prefix", () => {
    expect(matchQuery('say "hi" OR')).toBe('"say"* OR "hi"* OR "or"*');
    expect(matchQuery("!!")).toBeNull();
  });
});
