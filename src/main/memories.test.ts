import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import type { MemoryType } from "../shared/memories";
import type { CorpusSource } from "./corpus";
import { createLibrary } from "./library";
import { cleanMemoryName, createMemories, matchQuery, type Memories } from "./memories";

const corpus: CorpusSource = {
  getBook: async (id) => ({ id, title: `Title ${id}`, work: null }),
  exportBook: async () => [{ file_id: "f1", page_number: 1, role: null, order_hint: null, state: "done", text: "h\n\n---\nالكلام هو اللفظ" }],
};

let db: DatabaseSync;
let memories: Memories;
let clock = 1000;

beforeEach(async () => {
  clock = 1000;
  db = new DatabaseSync(":memory:");
  const library = createLibrary({ db, corpus, now: () => clock });
  memories = createMemories({ db, now: () => clock });
  await library.importBook({ corpusBookId: "b1" });
  await library.importBook({ corpusBookId: "b2" });
});

const fact = (name: string, description: string, body = description, type: MemoryType = "preference") => ({ name, description, body, type, source: "agent" as const });

/** Plausible memories that share words with the ones searched for, so ranking matters. */
const TOPICS = ["answers", "harakat", "iʿrāb", "grammar", "translation", "length", "Arabic", "teacher", "madhab", "nahw", "sarf", "balagha", "fiqh", "usul", "page"];
const VERBS = ["prefers", "likes", "asked for", "dislikes", "wants", "studies", "reviews", "skips", "repeats", "notes"];
const QUALITIES = ["short", "detailed", "formal", "simple", "slow", "careful", "vowelled", "literal", "loose", "brief"];

const distractors = async (count: number) => {
  for (let i = 0; i < count; i++) {
    const topic = TOPICS[i % TOPICS.length];
    const verb = VERBS[Math.floor(i / TOPICS.length) % VERBS.length];
    const quality = QUALITIES[(i * 7) % QUALITIES.length];
    await memories.add(fact(`filler-${i}`, `Reader ${verb} ${quality} ${topic} (${i})`, `The reader ${verb} ${quality} ${topic} in session ${i}.`));
  }
};

describe("Ask AI memory", () => {
  it("saves a memory and gets it back", async () => {
    const saved = await memories.add(fact("Transliterate terms", "Always transliterate Arabic terms in English answers", "Write the transliteration after each Arabic term."));
    expect(saved).toMatchObject({ name: "transliterate-terms", type: "preference", bookId: null, source: "agent", createdAt: 1000, updatedAt: 1000 });
    expect(saved.id).toMatch(/^[0-9a-f]{8}$/);
    expect(await memories.get({ id: saved.id })).toEqual(saved);
  });

  it("refuses a second memory with the same name in the same scope, naming the one to update", async () => {
    const first = await memories.add(fact("short-answers", "Keep answers short"));
    await expect(memories.add(fact("Short answers", "Answers should be brief"))).rejects.toThrow(`already exists (${first.id}). Update it`);
    expect(await memories.list()).toHaveLength(1);
  });

  it("allows the same name in different books", async () => {
    await memories.add({ ...fact("goal", "Reading to memorise the definitions", "x", "book"), bookId: "b1" });
    await expect(memories.add({ ...fact("goal", "Reading for the examples", "y", "book"), bookId: "b2" })).resolves.toMatchObject({ bookId: "b2" });
  });

  it("updates a memory in place, so search finds the new words and not the old", async () => {
    const m = await memories.add(fact("answer-length", "Keep answers short", "Two sentences at most."));
    clock = 2000;
    const updated = await memories.update({ id: m.id, description: "Answers can be detailed when asked about grammar", body: "Detailed answers for grammar questions.", source: "reader" });
    expect(updated).toMatchObject({ id: m.id, source: "reader", createdAt: 1000, updatedAt: 2000, name: "answer-length" });
    expect(await memories.list()).toHaveLength(1);
    expect(await memories.search({ query: "short sentences" })).toEqual([]);
    expect((await memories.search({ query: "detailed grammar" })).map((x) => x.id)).toEqual([m.id]);
  });

  it("refuses a rename onto another memory's name", async () => {
    await memories.add(fact("a", "First"));
    const b = await memories.add(fact("b", "Second"));
    await expect(memories.update({ id: b.id, name: "a", source: "agent" })).rejects.toThrow("already exists");
  });

  it("deletes a memory and its search entry", async () => {
    const m = await memories.add(fact("transliterate", "Always transliterate Arabic terms"));
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
  });

  describe("scope", () => {
    beforeEach(async () => {
      await memories.add(fact("transliterate", "Always transliterate Arabic terms"));
      await memories.add({ ...fact("b1-goal", "Studying this book with a teacher for the exam", "Exam in spring.", "book"), bookId: "b1" });
      await memories.add({ ...fact("b2-goal", "Reading this book to review the exam material", "Self study.", "book"), bookId: "b2" });
    });

    it("gives a chat the global memories and its own book's", async () => {
      expect((await memories.list({ bookId: "b1" })).map((m) => m.name).sort()).toEqual(["b1-goal", "transliterate"]);
      expect((await memories.list()).map((m) => m.name)).toEqual(["transliterate"]);
      expect((await memories.search({ query: "exam", bookId: "b2" })).map((m) => m.name)).toEqual(["b2-goal"]);
      expect(await memories.search({ query: "exam" })).toEqual([]);
    });

    it("lists every book's memories for Settings, with the book's title", async () => {
      const all = await memories.list({ all: true });
      expect(all).toHaveLength(3);
      expect(all.find((m) => m.name === "b1-goal")?.bookTitle).toBe("Title b1");
    });

    it("filters by type", async () => {
      expect((await memories.list({ bookId: "b1", type: "book" })).map((m) => m.name)).toEqual(["b1-goal"]);
    });

    it("needs a book for a book memory and keeps other kinds global", async () => {
      await expect(memories.add(fact("goal", "A goal", "x", "book"))).rejects.toThrow("needs the book");
      await expect(memories.add({ ...fact("goal", "A goal", "x", "book"), bookId: "nope" })).rejects.toThrow("no book nope");
      expect(await memories.add({ ...fact("level", "Second-year student", "x", "reader"), bookId: "b1" })).toMatchObject({ bookId: null });
    });

    it("deletes a book's memories with the book, and their search entries", async () => {
      db.prepare("DELETE FROM books WHERE book_id = ?").run("b1");
      expect((await memories.list({ all: true })).map((m) => m.name).sort()).toEqual(["b2-goal", "transliterate"]);
      expect((db.prepare("SELECT COUNT(*) AS n FROM memories_fts").get() as { n: number }).n).toBe(2);
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
