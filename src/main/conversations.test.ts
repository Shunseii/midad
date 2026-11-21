import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import type { ExportFile } from "../shared/corpus";
import type { CorpusSource } from "./corpus";
import { createConversations, type Conversations } from "./conversations";
import { createLibrary, type Library } from "./library";

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
  selection: null,
});

let db: DatabaseSync;
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
      { id: "c1", title: "first", createdAt: 1000, updatedAt: 3000, turnCount: 2 },
      { id: "c2", title: "second", createdAt: 2000, updatedAt: 2000, turnCount: 1 },
    ]);
    expect((await conversations.latest({ bookId: "b1" }))?.id).toBe("c1");
  });

  it("marks a turn still streaming when the app closed as interrupted on the next load", async () => {
    await conversations.addTurn({ conversationId: "c1", bookId: "b1", turn: question("t1") });
    const reopened = createConversations({ db });
    expect((await reopened.get({ id: "c1" }))?.turns[0]?.status).toBe("interrupted");
  });

  it("deletes a book's conversations and turns with the book", async () => {
    await conversations.addTurn({ conversationId: "c1", bookId: "b1", turn: question("t1") });
    db.prepare("DELETE FROM books WHERE book_id = ?").run("b1");
    expect(await conversations.list({ bookId: "b1" })).toEqual([]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM turns").get()).toEqual({ n: 0 });
  });
});
