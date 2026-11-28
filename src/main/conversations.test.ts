import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { noteSpot } from "../shared/conversations";
import type { ExportFile } from "../shared/corpus";
import type { CorpusSource } from "./corpus";
import { createConversations, type Conversations } from "./conversations";
import { createLibrary, type Library } from "./library";
import { openUserStore } from "./user-store";

const file: ExportFile = { file_id: "f1", page_number: 1, role: null, order_hint: null, state: "done", text: "h\n\n---\nالكلام هو اللفظ" };

const corpus: CorpusSource = {
  getBook: async (id) => ({ id, title: "t", work: null }),
  exportBook: async () => [structuredClone(file)],
};

const question = (id: string, text = `question ${id}`) => ({
  id,
  question: text,
  quotes: [{ id: `q-${id}`, text: "الكلام", span: { part: "matn" as const, start: { line: 1, word: 1 }, end: { line: 1, word: 1 } }, position: 1 }],
  position: 1,
});

let db: DatabaseSync;
const rowCount = (table: string) => openUserStore({ db }).store.getRowCount(table);
let library: Library;
let conversations: Conversations;
let clock = 1000;

beforeEach(async () => {
  clock = 1000;
  db = new DatabaseSync(":memory:");
  library = createLibrary({ db, corpus, now: () => clock });
  conversations = createConversations({ db, now: () => clock });
  await library.importBook({ corpusBookId: "b1" });
});

describe("Ask AI conversations", () => {
  it("has none for a new book", async () => {
    expect(await conversations.latest({ bookId: "b1" })).toBeNull();
    expect(await conversations.list({ bookId: "b1" })).toEqual([]);
  });

  it("saves a question as it's asked and its answer and session when it completes", async () => {
    await conversations.addTurn({ conversationId: "c1", bookId: "b1", turn: question("t1", "What is الكلام?") });
    expect((await conversations.get({ id: "c1" }))?.turns[0]).toMatchObject({ status: "streaming", answer: "" });

    clock = 2000;
    await conversations.finishTurn({ id: "t1", answer: "It is [[line 1]].", sessionId: "s1" });
    expect(await conversations.get({ id: "c1" })).toEqual({
      id: "c1",
      bookId: "b1",
      sessionId: "s1",
      title: "What is الكلام?",
      turns: [{ ...question("t1", "What is الكلام?"), answer: "It is [[line 1]].", status: "done", error: null, createdAt: 1000 }],
    });
  });

  it("saves an error with the answer streamed before it, keeping the session", async () => {
    await conversations.addTurn({ conversationId: "c1", bookId: "b1", turn: question("t1") });
    await conversations.finishTurn({ id: "t1", answer: "done", sessionId: "s1" });
    await conversations.addTurn({ conversationId: "c1", bookId: "b1", turn: question("t2") });
    await conversations.finishTurn({ id: "t2", answer: "partial", error: "Stopped." });
    const c = await conversations.get({ id: "c1" });
    expect(c?.sessionId).toBe("s1");
    expect(c?.turns[1]).toMatchObject({ answer: "partial", status: "error", error: "Stopped." });
  });

  it("titles a conversation started from a pasted passage alone by that passage", async () => {
    await conversations.addTurn({ conversationId: "c1", bookId: "b1", turn: question("t1", "") });
    expect((await conversations.list({ bookId: "b1" }))[0]?.title).toBe("الكلام");
  });

  it("keeps turns in the order they were asked", async () => {
    for (const id of ["t1", "t2", "t3"]) await conversations.addTurn({ conversationId: "c1", bookId: "b1", turn: question(id) });
    expect((await conversations.get({ id: "c1" }))?.turns.map((t) => t.id)).toEqual(["t1", "t2", "t3"]);
  });

  it("lists conversations most recently used first, titled by their first question", async () => {
    await conversations.addTurn({ conversationId: "c1", bookId: "b1", turn: question("t1", "first") });
    clock = 2000;
    await conversations.addTurn({ conversationId: "c2", bookId: "b1", turn: question("t2", "second") });
    clock = 3000;
    await conversations.addTurn({ conversationId: "c1", bookId: "b1", turn: question("t3", "third") });

    expect(await conversations.list({ bookId: "b1" })).toEqual([
      { id: "c1", title: "first", position: 1, pageNumber: 1, createdAt: 1000, updatedAt: 3000, turnCount: 2 },
      { id: "c2", title: "second", position: 1, pageNumber: 1, createdAt: 2000, updatedAt: 2000, turnCount: 1 },
    ]);
    expect((await conversations.latest({ bookId: "b1" }))?.id).toBe("c1");
  });

  it("marks a turn still streaming when the app closed as interrupted on the next load", async () => {
    await conversations.addTurn({ conversationId: "c1", bookId: "b1", turn: question("t1") });
    const reopened = createConversations({ db });
    expect((await reopened.get({ id: "c1" }))?.turns[0]?.status).toBe("interrupted");
  });

  it("deletes one conversation with its turns, leaving the others", async () => {
    await conversations.addTurn({ conversationId: "c1", bookId: "b1", turn: question("t1") });
    await conversations.addTurn({ conversationId: "c2", bookId: "b1", turn: question("t2") });
    await conversations.remove({ id: "c1" });
    expect((await conversations.list({ bookId: "b1" })).map((c) => c.id)).toEqual(["c2"]);
    expect(rowCount("turns")).toBe(1);
  });

  it("gives the turns asked before a question, for carrying them into a new session", async () => {
    for (const id of ["t1", "t2", "t3"]) await conversations.addTurn({ conversationId: "c1", bookId: "b1", turn: question(id) });
    expect((await conversations.earlierTurns({ turnId: "t3" })).map((t) => t.id)).toEqual(["t1", "t2"]);
    expect(await conversations.earlierTurns({ turnId: "missing" })).toEqual([]);
  });

  it("leaves another device's answer streaming when it reopens", async () => {
    await conversations.addTurn({ conversationId: "c1", bookId: "b1", turn: question("t1") });
    openUserStore({ db }).store.setCell("turns", "t1", "askedOn", "another-device");
    const reopened = createConversations({ db });
    expect((await reopened.get({ id: "c1" }))?.turns[0]?.status).toBe("streaming");
  });
});

describe("saving a conversation", () => {
  const answered = (id: string, text: string) => ({ ...question(id, text), answer: `answer ${id}`, status: "done" as const, error: null });

  it("writes nothing for an answer to a conversation that was never saved", async () => {
    await conversations.finishTurn({ id: "t1", answer: "It is [[line 1]].", sessionId: "s1" });
    expect(rowCount("conversations")).toBe(0);
    expect(rowCount("turns")).toBe(0);
  });

  it("writes the conversation with every turn so far, its session and the page it started on", async () => {
    await conversations.save({ id: "c1", bookId: "b1", sessionId: "s1", turns: [answered("t1", "first"), answered("t2", "second")] });
    expect(await conversations.get({ id: "c1" })).toEqual({
      id: "c1",
      bookId: "b1",
      sessionId: "s1",
      title: "first",
      turns: [
        { ...answered("t1", "first"), createdAt: 1000 },
        { ...answered("t2", "second"), createdAt: 1000 },
      ],
    });
    expect((await conversations.list({ bookId: "b1" }))[0]).toMatchObject({ position: 1, pageNumber: 1, turnCount: 2 });
  });

  it("keeps later questions once saved, and finishes an answer that was streaming when it was saved", async () => {
    await conversations.save({ id: "c1", bookId: "b1", sessionId: null, turns: [{ ...question("t1"), answer: "par", status: "streaming", error: null }] });
    await conversations.finishTurn({ id: "t1", answer: "partial and done", sessionId: "s1" });
    await conversations.addTurn({ conversationId: "c1", bookId: "b1", turn: question("t2") });
    const c = await conversations.get({ id: "c1" });
    expect(c?.sessionId).toBe("s1");
    expect(c?.turns.map((t) => [t.id, t.answer, t.status])).toEqual([
      ["t1", "partial and done", "done"],
      ["t2", "", "streaming"],
    ]);
  });

  it("renames a conversation, ignoring a blank title", async () => {
    await conversations.save({ id: "c1", bookId: "b1", sessionId: null, turns: [answered("t1", "first")] });
    await conversations.rename({ id: "c1", title: "  Kalām and lafẓ  " });
    expect((await conversations.get({ id: "c1" }))?.title).toBe("Kalām and lafẓ");
    await conversations.rename({ id: "c1", title: "   " });
    expect((await conversations.get({ id: "c1" }))?.title).toBe("Kalām and lafẓ");
  });

  it("gives a conversation saved before pages were kept the page of its first question", async () => {
    const old = new DatabaseSync(":memory:");
    await createLibrary({ db: old, corpus, now: () => clock }).importBook({ corpusBookId: "b1" });
    old.exec(`CREATE TABLE conversations (id TEXT PRIMARY KEY, book_id TEXT NOT NULL, session_id TEXT, title TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE turns (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, question TEXT NOT NULL, quotes TEXT NOT NULL, position INTEGER NOT NULL, selection TEXT, answer TEXT NOT NULL DEFAULT '', status TEXT NOT NULL, error TEXT, created_at INTEGER NOT NULL);
      INSERT INTO conversations VALUES ('c1', 'b1', NULL, 'old', 1, 1), ('c2', 'b1', NULL, 'empty', 2, 2);
      INSERT INTO turns VALUES ('t1', 'c1', 'q', '[]', 1, NULL, '', 'done', NULL, 1);`);
    const migrated = createConversations({ db: old });
    expect((await migrated.list({ bookId: "b1" })).map((c) => [c.id, c.position, c.pageNumber])).toEqual([
      ["c2", null, null],
      ["c1", 1, 1],
    ]);
  });

  it("still loads a turn asked about a selection before selections became quotes, saving its note there", async () => {
    const old = new DatabaseSync(":memory:");
    await createLibrary({ db: old, corpus, now: () => clock }).importBook({ corpusBookId: "b1" });
    const span = { part: "matn", start: { line: 1, word: 1 }, end: { line: 1, word: 2 } };
    old.exec(`CREATE TABLE conversations (id TEXT PRIMARY KEY, book_id TEXT NOT NULL, session_id TEXT, title TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE turns (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, question TEXT NOT NULL, quotes TEXT NOT NULL, position INTEGER NOT NULL, selection TEXT, answer TEXT NOT NULL DEFAULT '', status TEXT NOT NULL, error TEXT, created_at INTEGER NOT NULL);
      INSERT INTO conversations VALUES ('c1', 'b1', NULL, 'old', 1, 1);
      INSERT INTO turns VALUES ('t1', 'c1', 'Explain this passage.', '[]', 1, '${JSON.stringify({ span, text: "الكلام هو", position: 1 })}', 'An answer.', 'done', NULL, 1);`);
    const turn = (await createConversations({ db: old }).get({ id: "c1" }))?.turns[0];
    expect(turn).toMatchObject({ question: "Explain this passage.", answer: "An answer.", selection: { span, text: "الكلام هو", position: 1 } });
    expect(turn && noteSpot(turn)).toEqual({ position: 1, span });
  });

  it("leaves the selection off turns asked now", async () => {
    await conversations.addTurn({ conversationId: "c1", bookId: "b1", turn: question("t1") });
    expect((await conversations.get({ id: "c1" }))?.turns[0]).not.toHaveProperty("selection");
  });
});
