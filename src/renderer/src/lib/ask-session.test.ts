import { describe, expect, it, vi } from "vitest";
import type { StreamEvent } from "../../../shared/ask";
import type { Conversation } from "../../../shared/conversations";
import { type AskApi, createAskSessions } from "./ask-session";

const savedConversation = (id: string): Conversation => ({
  id,
  bookId: "a",
  title: "Saved",
  sessionId: `claude-${id}`,
  turns: [{ id: `${id}-t1`, question: "Saved question", quotes: [], position: 3, selection: null, answer: "Saved answer", status: "done", error: null, createdAt: 1 }],
});

const setup = ({ latest = null }: { latest?: Conversation | null } = {}) => {
  let emit: (requestId: string, event: StreamEvent) => void = () => {};
  const answers = new Map<string, (text: string) => void>();
  const api = {
    "conversations.latest": vi.fn(async () => latest),
    "conversations.get": vi.fn(async ({ id }: { id: string }) => savedConversation(id)),
    "conversations.addTurn": vi.fn(async () => {}),
    "conversations.save": vi.fn(async () => {}),
    "ai.cancel": vi.fn(async () => {}),
    "ai.ask": vi.fn(
      ({ requestId }: Parameters<AskApi["ai.ask"]>[0]) =>
        new Promise<{ sessionId: string; text: string; restarted: boolean }>((resolve) => {
          answers.set(requestId, (text) => resolve({ sessionId: "claude-new", text, restarted: false }));
        }),
    ),
  } satisfies AskApi;
  const sessions = createAskSessions({
    api,
    onAskEvent: (callback) => {
      emit = callback;
    },
    model: () => "sonnet",
    historyChanged: () => {},
  });
  const request = (n: number) => {
    const input = api["ai.ask"].mock.calls[n]?.[0];
    if (!input) throw new Error(`no question ${n} was asked`);
    return input;
  };
  return { api, sessions, request, emit: (requestId: string, event: StreamEvent) => emit(requestId, event), finish: (requestId: string, text: string) => answers.get(requestId)?.(text) };
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("ask sessions", () => {
  it("opens a book's latest saved conversation the first time only", async () => {
    const { api, sessions } = setup({ latest: savedConversation("c1") });
    await settle();
    const first = sessions.of("a");
    await settle();
    expect(first.getState()).toMatchObject({ conversationId: "c1", saved: true });
    expect(sessions.of("a")).toBe(first);
    expect(api["conversations.latest"]).toHaveBeenCalledTimes(1);
  });

  it("keeps an unsaved conversation and its screen and draft for the next visit", async () => {
    const { sessions, finish, request } = setup({ latest: savedConversation("c1") });
    const session = sessions.of("a");
    await settle();
    session.reset();
    void session.ask({ question: "New question", position: 5 });
    await settle();
    const requestId = request(0).requestId;
    finish(requestId, "New answer");
    await settle();
    session.setScreen("history");
    session.keepDraft({ question: "half typed", quotes: [] });

    const again = sessions.of("a").getState();
    expect(again.saved).toBe(false);
    expect(again.turns.map((t) => [t.question, t.answer, t.status])).toEqual([["New question", "New answer", "done"]]);
    expect(again.screen).toBe("history");
    expect(sessions.of("a").draft().question).toBe("half typed");
  });

  it("keeps streaming into a conversation nobody is watching, and continues its Claude session", async () => {
    const { sessions, emit, finish, api, request } = setup();
    const session = sessions.of("a");
    await settle();
    const seen = vi.fn();
    const unsubscribe = session.subscribe(seen);
    void session.ask({ question: "Q1", position: 1 });
    await settle();
    const requestId = request(0).requestId;
    emit(requestId, { kind: "delta", text: "Part one, " });
    unsubscribe();
    emit(requestId, { kind: "delta", text: "part two" });
    expect(sessions.of("a").getState().turns[0]).toMatchObject({ answer: "Part one, part two", status: "streaming" });
    finish(requestId, "Part one, part two.");
    await settle();
    expect(sessions.of("a").getState().turns[0]).toMatchObject({ answer: "Part one, part two.", status: "done" });

    void session.ask({ question: "Q2", position: 1 });
    await settle();
    expect(request(1).sessionId).toBe("claude-new");
  });

  it("sends a queued question once the answer finishes while away", async () => {
    const { sessions, finish, api, request } = setup();
    const session = sessions.of("a");
    await settle();
    void session.ask({ question: "Q1", position: 1 });
    session.queueMessage({ question: "Q2", quotes: [], position: 1 });
    await settle();
    finish(request(0).requestId, "A1");
    await settle();
    expect(api["ai.ask"]).toHaveBeenCalledTimes(2);
    expect(session.getState().turns.map((t) => t.question)).toEqual(["Q1", "Q2"]);
    expect(session.getState().queue.items).toEqual([]);
  });

  it("keeps each book's conversation to itself", async () => {
    const { sessions, emit, request } = setup();
    const a = sessions.of("a");
    const b = sessions.of("b");
    await settle();
    void a.ask({ question: "About A", position: 1 });
    await settle();
    emit(request(0).requestId, { kind: "delta", text: "A's answer" });
    expect(a.getState().turns[0]?.answer).toBe("A's answer");
    expect(b.getState().turns).toEqual([]);
  });

  it("remembers a conversation opened from the history", async () => {
    const { sessions } = setup();
    sessions.of("a").open("c2");
    await settle();
    expect(sessions.of("a").getState()).toMatchObject({ conversationId: "c2", saved: true });
  });
});
