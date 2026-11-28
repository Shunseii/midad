/**
 * The Ask AI conversation open for each book during this app session. It lives outside the
 * reader so leaving the book (for Settings or the library) and coming back finds it as it was,
 * with any answer still streaming carrying on meanwhile. Kept in memory only: gone on restart,
 * when opening a book shows its most recently used saved conversation.
 */
import type { StreamEvent } from "../../../shared/ask";
import { questionWithQuoteMarks } from "../../../shared/composer";
import type { AskSelection, Conversation, Quote, StoredTurn } from "../../../shared/conversations";
import type { MidadApi } from "../../../shared/ipc";
import { afterAnswer, type AnswerEnd, type AskQueue, dequeue, emptyQueue, enqueue, sendFirst } from "./ask-queue";

export interface Turn extends Omit<StoredTurn, "createdAt"> {
  /** While streaming: what Claude is doing, e.g. reading the page. */
  activity: string | null;
  /** Answered in a new Claude session because the old one was gone. Only known for answers given this app session. */
  restarted?: boolean;
}

/** A question typed while Claude was answering, waiting its turn. It keeps the page and selection it was typed on. */
export interface QueuedMessage {
  id: string;
  question: string;
  quotes: Quote[];
  position: number;
  selection: AskSelection | null;
}

export type AskScreen = "chat" | "history";

/** What's typed in the composer but not sent. */
export interface AskDraft {
  question: string;
  quotes: Quote[];
}

export interface AskState {
  turns: Turn[];
  conversationId: string | null;
  saved: boolean;
  queue: AskQueue<QueuedMessage>;
  screen: AskScreen;
}

export type AskApi = Pick<MidadApi, "ai.ask" | "ai.cancel" | "conversations.latest" | "conversations.get" | "conversations.addTurn" | "conversations.save">;

const fromStored = ({ createdAt: _, ...turn }: StoredTurn): Turn => ({ ...turn, activity: null });

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

const createAskSession = ({ bookId, api, model, historyChanged }: { bookId: string; api: AskApi; model: () => string; historyChanged: () => void }) => {
  let state: AskState = { turns: [], conversationId: null, saved: false, queue: emptyQueue(), screen: "chat" };
  // Not part of the state: it changes with every key, and only a composer coming back reads it.
  let draft: AskDraft = { question: "", quotes: [] };
  const listeners = new Set<() => void>();
  const set = (change: Partial<AskState>) => {
    state = { ...state, ...change };
    for (const listener of listeners) listener();
  };
  let sessionId: string | null = null;
  // Bumped whenever another conversation is shown, so a late load or answer can't revive the old one.
  let generation = 0;
  // Answers the reader stopped, so their end pauses the queue rather than counting as a failure.
  const stopped = new Set<string>();

  const update = (id: string, change: (t: Turn) => Partial<Turn>) => {
    if (!state.turns.some((t) => t.id === id)) return;
    set({ turns: state.turns.map((t) => (t.id === id ? { ...t, ...change(t) } : t)) });
  };

  const show = (conversation: Conversation | null) => {
    generation += 1;
    sessionId = conversation?.sessionId ?? null;
    set({ conversationId: conversation?.id ?? null, saved: conversation !== null, turns: conversation?.turns.map(fromStored) ?? [], queue: emptyQueue() });
  };

  const load = (fetch: () => Promise<Conversation | null>) => {
    show(null);
    const started = generation;
    void fetch().then((conversation) => {
      if (started === generation) show(conversation);
    });
  };

  const onEvent = (requestId: string, event: StreamEvent) => {
    if (event.kind === "delta") update(requestId, (t) => ({ answer: t.answer + event.text, activity: null }));
    if (event.kind === "tool") update(requestId, (t) => ({ activity: "Reading the page…", answer: t.answer && !t.answer.endsWith("\n\n") ? `${t.answer}\n\n` : t.answer }));
  };

  const ask = async ({ question, position, selection, quotes = [] }: { question: string; position: number; selection: AskSelection | null; quotes?: Quote[] }) => {
    const id = crypto.randomUUID();
    if (!state.conversationId) set({ conversationId: crypto.randomUUID() });
    const conversation = state.conversationId ?? "";
    const started = generation;
    // Claude's session only keeps answers that finished; the stopped ones since go along with this question.
    const earlier = state.turns;
    const cutOff = earlier.slice(earlier.findLastIndex((t) => t.status === "done") + 1).map((t) => ({ question: t.question, answer: t.answer, status: t.status, quotes: t.quotes.map((q) => ({ text: q.text })) }));
    const ended = (end: AnswerEnd) => {
      stopped.delete(id);
      if (started !== generation) return;
      const { next, queue } = afterAnswer({ queue: state.queue, end });
      set({ queue });
      if (next) void ask(next);
    };
    set({ turns: [...state.turns, { id, question, quotes, position, selection, answer: "", status: "streaming", activity: "Starting Claude…", error: null }] });
    if (state.saved) {
      try {
        await api["conversations.addTurn"]({ conversationId: conversation, bookId, turn: { id, question, quotes, position, selection } });
      } catch (err) {
        update(id, () => ({ status: "error", activity: null, error: errorText(err) }));
        ended("error");
        return;
      }
      historyChanged();
    }
    api["ai.ask"]({
      requestId: id,
      bookId,
      position,
      question: questionWithQuoteMarks({ question, quotes }) || "Explain this passage.",
      selection: selection && position === selection.position ? { span: selection.span, text: selection.text } : undefined,
      quotes: quotes.map((q) => ({ text: q.text, span: q.position === position ? q.span : null })),
      sessionId,
      model: model(),
      cutOff,
    })
      .then(
        (result) => {
          if (started === generation) sessionId = result.sessionId || sessionId;
          update(id, () => ({ answer: result.text, status: "done", activity: null, restarted: result.restarted }));
          ended("done");
        },
        (err: unknown) => {
          update(id, () => ({ status: "error", activity: null, error: errorText(err) }));
          ended(stopped.has(id) ? "stopped" : "error");
        },
      )
      .finally(() => {
        if (state.saved) historyChanged();
      });
  };

  const busy = () => state.turns.some((t) => t.status === "streaming");
  const setQueue = (queue: AskQueue<QueuedMessage>) => set({ queue });

  const stop = () => {
    for (const t of state.turns) {
      if (t.status !== "streaming") continue;
      stopped.add(t.id);
      void api["ai.cancel"]({ requestId: t.id });
    }
  };
  const queueMessage = (message: Omit<QueuedMessage, "id">) => setQueue(enqueue({ queue: state.queue, item: { id: crypto.randomUUID(), ...message } }));
  /** Sends a message at once: an answer in progress is stopped first, keeping what it wrote so far. */
  const sendNow = (message: QueuedMessage) => {
    if (!busy()) {
      setQueue(dequeue({ queue: { ...state.queue, paused: false }, id: message.id }));
      void ask(message);
      return;
    }
    setQueue(sendFirst({ queue: state.queue, item: message }));
    stop();
  };
  const sendQueuedNow = (id: string) => {
    const message = state.queue.items.find((m) => m.id === id);
    if (message) sendNow(message);
  };
  const sendDraftNow = (message: Omit<QueuedMessage, "id">) => sendNow({ id: crypto.randomUUID(), ...message });
  /** Takes a message out of the queue, to edit it in the composer. */
  const takeQueued = (id: string): QueuedMessage | null => {
    const message = state.queue.items.find((m) => m.id === id) ?? null;
    setQueue(dequeue({ queue: state.queue, id }));
    return message;
  };
  const removeQueued = (id: string) => setQueue(dequeue({ queue: state.queue, id }));
  const retry = (turn: Turn) => {
    const message = { question: turn.question, position: turn.position, selection: turn.selection, quotes: turn.quotes };
    if (busy()) queueMessage(message);
    else void ask(message);
  };
  /** Starts a fresh conversation and Claude session; the old one stays in the history. */
  const reset = () => {
    stop();
    show(null);
  };
  /** Shows a saved conversation; the next question continues its Claude session. */
  const open = (id: string) => {
    if (id === state.conversationId) return;
    stop();
    load(() => api["conversations.get"]({ id }));
  };
  /** Saves the open conversation with everything asked so far; later questions save as they're asked. */
  const save = async () => {
    const id = state.conversationId;
    if (!id || state.saved || state.turns.length === 0) return;
    set({ saved: true });
    try {
      await api["conversations.save"]({ id, bookId, sessionId, turns: state.turns.map(({ activity: _, restarted: __, ...turn }) => turn) });
    } catch {
      if (state.conversationId === id) set({ saved: false });
    } finally {
      historyChanged();
    }
  };

  return {
    getState: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    loadLatest: () => load(() => api["conversations.latest"]({ bookId })),
    loadConversation: (id: string) => load(() => api["conversations.get"]({ id })),
    onEvent,
    ask,
    stop,
    queueMessage,
    sendQueuedNow,
    sendDraftNow,
    takeQueued,
    removeQueued,
    retry,
    reset,
    open,
    save,
    setScreen: (screen: AskScreen) => set({ screen }),
    draft: () => draft,
    keepDraft: (typed: AskDraft) => {
      draft = typed;
    },
  };
};

export type AskSession = ReturnType<typeof createAskSession>;

export const createAskSessions = ({
  api,
  onAskEvent,
  model,
  historyChanged,
}: {
  api: AskApi;
  onAskEvent: (callback: (requestId: string, event: StreamEvent) => void) => void;
  model: () => string;
  historyChanged: (bookId: string) => void;
}) => {
  const sessions = new Map<string, AskSession>();
  let listening = false;
  return {
    /** The book's session, made on first use this app session with its most recently used saved conversation. */
    of: (bookId: string): AskSession => {
      if (!listening) {
        listening = true;
        onAskEvent((requestId, event) => {
          for (const session of sessions.values()) session.onEvent(requestId, event);
        });
      }
      const existing = sessions.get(bookId);
      if (existing) return existing;
      const session = createAskSession({ bookId, api, model, historyChanged: () => historyChanged(bookId) });
      sessions.set(bookId, session);
      session.loadLatest();
      return session;
    },
  };
};
