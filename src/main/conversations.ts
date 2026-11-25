import type { DatabaseSync } from "node:sqlite";
import type { Row } from "tinybase";
import type { AskSelection, Conversation, ConversationSummary, Quote, StoredTurn, TurnStatus } from "../shared/conversations";
import { migrateLegacyTable, openUserStore } from "./user-store";

/**
 * Ask AI conversations: each is one Claude session about a book, with its questions and answers,
 * kept in the user store. The Claude session belongs to this device, so its id stays in SQLite and
 * isn't synced (a conversation continued elsewhere starts a new session with a recap).
 * Requires the library's schema.
 */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS conversation_sessions (
  conversation_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL
);
`;

const TITLE_MAX = 80;

const defaultTitle = (turn: { question: string; quotes: { text: string }[] }) =>
  (turn.question.trim() || turn.quotes[0]?.text.trim() || "Explain this passage.").slice(0, TITLE_MAX);

/** Conversations saved before they kept their page take the page of their first question. */
const addPositionColumn = (db: DatabaseSync) => {
  const columns = db.prepare("PRAGMA table_info(conversations)").all() as { name: string }[];
  if (columns.some((c) => c.name === "position")) return;
  db.exec("ALTER TABLE conversations ADD COLUMN position INTEGER");
  db.exec(
    `UPDATE conversations SET position = (
       SELECT position FROM turns WHERE conversation_id = conversations.id ORDER BY created_at, rowid LIMIT 1
     )`,
  );
};

interface LegacyTurnRow {
  id: string;
  conversation_id: string;
  question: string;
  quotes: string;
  position: number;
  selection: string | null;
  answer: string;
  status: TurnStatus;
  error: string | null;
  created_at: number;
}

/**
 * Conversations and turns from before the user store, copied in once with their ids. A turn's
 * order among turns saved at the same moment was SQLite's rowid; it becomes `seq`.
 */
const legacyConversations = ({ db, deviceId }: { db: DatabaseSync; deviceId: string }) => {
  addPositionColumn(db);
  const conversations = db.prepare("SELECT * FROM conversations ORDER BY rowid").all() as {
    id: string;
    book_id: string;
    session_id: string | null;
    title: string;
    position: number | null;
    created_at: number;
    updated_at: number;
  }[];
  const turns = db.prepare("SELECT * FROM turns ORDER BY created_at, rowid").all() as unknown as LegacyTurnRow[];
  const keepSession = db.prepare("INSERT OR IGNORE INTO conversation_sessions (conversation_id, session_id) VALUES (?, ?)");
  for (const c of conversations) if (c.session_id) keepSession.run(c.id, c.session_id);
  const updatedAt = new Map(conversations.map((c) => [c.id, c.updated_at]));
  return [
    ...conversations.map((c, i) => ({
      table: "conversations" as const,
      id: c.id,
      row: { bookId: c.book_id, title: c.title, position: c.position, createdAt: c.created_at, updatedAt: c.updated_at, seq: i },
      at: c.updated_at,
    })),
    ...turns.map((t, i) => ({
      // A turn kept no time for its answer; finishing it touched its conversation's updated_at.
      at: Math.max(t.created_at, updatedAt.get(t.conversation_id) ?? 0),
      table: "turns" as const,
      id: t.id,
      row: {
        conversationId: t.conversation_id,
        question: t.question,
        quotes: t.quotes,
        position: t.position,
        selection: t.selection,
        answer: t.answer,
        // Settled here, at the copy's old time, rather than at startup with a new one that would
        // beat another device's finished answer to the same turn.
        status: t.status === "streaming" ? "interrupted" : t.status,
        error: t.error,
        createdAt: t.created_at,
        seq: i,
        askedOn: deviceId,
      },
    })),
  ];
};

const toTurn = ([id, row]: [string, Row]): StoredTurn => ({
  id,
  question: String(row.question),
  quotes: JSON.parse(String(row.quotes)) as Quote[],
  position: Number(row.position),
  selection: typeof row.selection === "string" ? (JSON.parse(row.selection) as AskSelection) : null,
  answer: String(row.answer),
  status: row.status as TurnStatus,
  error: typeof row.error === "string" ? row.error : null,
  createdAt: Number(row.createdAt),
});

const inOrder = ([, a]: [string, Row], [, b]: [string, Row]) => Number(a.createdAt) - Number(b.createdAt) || Number(a.seq) - Number(b.seq);

/** Newest activity first; among equals, the one started last. */
const byActivity = ([idA, a]: [string, Row], [idB, b]: [string, Row]) =>
  Number(b.updatedAt) - Number(a.updatedAt) || Number(b.createdAt) - Number(a.createdAt) || Number(b.seq ?? 0) - Number(a.seq ?? 0) || (idA < idB ? 1 : -1);

export const createConversations = ({ db, now = Date.now }: { db: DatabaseSync; now?: () => number }) => {
  const user = openUserStore({ db });
  db.exec(SCHEMA);
  migrateLegacyTable({ user, db, table: "conversations", alsoCopies: ["turns"], rows: () => legacyConversations({ db, deviceId: user.deviceId }) });

  const turnsOf = (conversationId: string) => user.rows({ table: "turns", ids: user.indexes.getSliceRowIds("turns", conversationId) }).sort(inOrder);
  const sessionOf = (id: string) =>
    (db.prepare("SELECT session_id FROM conversation_sessions WHERE conversation_id = ?").get(id) as { session_id: string } | undefined)?.session_id ?? null;
  const keepSession = ({ id, sessionId }: { id: string; sessionId: string | null }) => {
    if (sessionId) db.prepare("INSERT INTO conversation_sessions VALUES (?, ?) ON CONFLICT (conversation_id) DO UPDATE SET session_id = excluded.session_id").run(id, sessionId);
  };

  // Nothing streams across a restart: an answer cut off by closing the app can be asked again.
  // Only this device's: another device may be streaming an answer right now.
  user.store.transaction(() => {
    for (const [id, turn] of user.rows({ table: "turns" })) {
      if (turn.status === "streaming" && (turn.askedOn === user.deviceId || turn.askedOn === undefined)) user.store.setCell("turns", id, "status", "interrupted");
    }
  });

  const get = async ({ id }: { id: string }): Promise<Conversation | null> => {
    const row = user.row({ table: "conversations", id });
    if (!row) return null;
    return { id, bookId: String(row.bookId), sessionId: sessionOf(id), title: String(row.title), turns: turnsOf(id).map(toTurn) };
  };

  const ofBook = (bookId: string) => user.rows({ table: "conversations", ids: user.indexes.getSliceRowIds("conversations", bookId) }).sort(byActivity);

  const turnRow = ({ conversationId, turn, at, seq }: { conversationId: string; turn: Omit<StoredTurn, "createdAt">; at: number; seq: number }) => ({
    conversationId,
    question: turn.question,
    quotes: JSON.stringify(turn.quotes),
    position: turn.position,
    selection: turn.selection ? JSON.stringify(turn.selection) : null,
    answer: turn.answer,
    status: turn.status,
    error: turn.error,
    createdAt: at,
    seq,
    askedOn: user.deviceId,
  });

  return {
    get,

    async list({ bookId }: { bookId: string }): Promise<ConversationSummary[]> {
      const pageNumber = db.prepare("SELECT number FROM pages WHERE book_id = ? AND position = ? LIMIT 1");
      return ofBook(bookId).map(([id, c]) => {
        const position = typeof c.position === "number" ? c.position : null;
        const page = position === null ? undefined : (pageNumber.get(bookId, position) as { number: number | null } | undefined);
        return {
          id,
          title: String(c.title),
          position,
          pageNumber: page?.number ?? null,
          createdAt: Number(c.createdAt),
          updatedAt: Number(c.updatedAt),
          turnCount: turnsOf(id).length,
        };
      });
    },

    async latest({ bookId }: { bookId: string }): Promise<Conversation | null> {
      const first = ofBook(bookId)[0];
      return first ? get({ id: first[0] }) : null;
    },

    /** Saves a conversation kept only in memory until now, with every turn asked so far. */
    async save({
      id,
      bookId,
      sessionId,
      turns,
    }: {
      id: string;
      bookId: string;
      sessionId: string | null;
      turns: Omit<StoredTurn, "createdAt">[];
    }): Promise<void> {
      const first = turns[0];
      if (!first) return;
      const at = now();
      user.store.transaction(() => {
        if (!user.row({ table: "conversations", id })) {
          user.store.setRow("conversations", id, { bookId, title: defaultTitle(first), position: first.position, createdAt: at, updatedAt: at, seq: user.store.getRowCount("conversations") });
          keepSession({ id, sessionId });
        }
        const existing = new Set(turnsOf(id).map(([turnId]) => turnId));
        turns.forEach((turn, i) => {
          if (!existing.has(turn.id)) user.store.setRow("turns", turn.id, turnRow({ conversationId: id, turn, at, seq: i }));
        });
      });
    },

    /** Renames a conversation; a blank title keeps the old one. */
    async rename({ id, title }: { id: string; title: string }): Promise<void> {
      const trimmed = title.trim().slice(0, TITLE_MAX);
      if (trimmed && user.row({ table: "conversations", id })) user.store.setCell("conversations", id, "title", trimmed);
    },

    /** Adds a question to a saved conversation as it's asked, starting the conversation (titled by it) if this is the first. */
    async addTurn({
      conversationId,
      bookId,
      turn,
    }: {
      conversationId: string;
      bookId: string;
      turn: Omit<StoredTurn, "answer" | "status" | "error" | "createdAt">;
    }): Promise<void> {
      const at = now();
      user.store.transaction(() => {
        if (user.row({ table: "conversations", id: conversationId })) user.store.setCell("conversations", conversationId, "updatedAt", at);
        else
          user.store.setRow("conversations", conversationId, {
            bookId,
            title: defaultTitle(turn),
            position: turn.position,
            createdAt: at,
            updatedAt: at,
            seq: user.store.getRowCount("conversations"),
          });
        const seq = turnsOf(conversationId).reduce((max, [, t]) => Math.max(max, Number(t.seq) + 1), 0);
        user.store.setRow("turns", turn.id, turnRow({ conversationId, turn: { ...turn, answer: "", status: "streaming", error: null }, at, seq }));
      });
    },

    /** Deletes a conversation and its turns. */
    async remove({ id }: { id: string }): Promise<void> {
      user.store.transaction(() => {
        for (const turnId of user.indexes.getSliceRowIds("turns", id)) user.store.delRow("turns", turnId);
        user.store.delRow("conversations", id);
      });
      db.prepare("DELETE FROM conversation_sessions WHERE conversation_id = ?").run(id);
    },

    /** The conversation a question belongs to, with the turns asked before it. */
    async earlierTurns({ turnId }: { turnId: string }): Promise<StoredTurn[]> {
      const turn = user.row({ table: "turns", id: turnId });
      const conversation = turn ? await get({ id: String(turn.conversationId) }) : null;
      const at = conversation?.turns.findIndex((t) => t.id === turnId) ?? -1;
      return conversation && at >= 0 ? conversation.turns.slice(0, at) : [];
    },

    /** Saves the answer, or the error, and the Claude session the next question continues. */
    async finishTurn({
      id,
      answer = "",
      error = null,
      sessionId = null,
    }: {
      id: string;
      answer?: string;
      error?: string | null;
      sessionId?: string | null;
    }): Promise<void> {
      const turn = user.row({ table: "turns", id });
      if (!turn) return;
      const conversationId = String(turn.conversationId);
      user.store.transaction(() => {
        user.store.setPartialRow("turns", id, { answer, status: error === null ? "done" : "error", error });
        if (user.row({ table: "conversations", id: conversationId })) user.store.setCell("conversations", conversationId, "updatedAt", now());
      });
      keepSession({ id: conversationId, sessionId: sessionId || null });
    },
  };
};

export type Conversations = ReturnType<typeof createConversations>;
