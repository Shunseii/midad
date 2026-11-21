import type { DatabaseSync } from "node:sqlite";
import type { AskSelection, Conversation, ConversationSummary, Quote, StoredTurn, TurnStatus } from "../shared/conversations";

/**
 * Ask AI conversations: each is one Claude session about a book, with its
 * questions and answers. Requires the library's schema.
 */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL REFERENCES books(book_id) ON DELETE CASCADE,
  session_id TEXT,
  title TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS conversations_by_book ON conversations (book_id, updated_at);
CREATE TABLE IF NOT EXISTS turns (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  quotes TEXT NOT NULL,
  position INTEGER NOT NULL,
  selection TEXT,
  answer TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  error TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS turns_by_conversation ON turns (conversation_id, created_at);
`;

const TITLE_MAX = 80;

interface TurnRow {
  id: string;
  question: string;
  quotes: string;
  position: number;
  selection: string | null;
  answer: string;
  status: TurnStatus;
  error: string | null;
  created_at: number;
}

const toTurn = (row: TurnRow): StoredTurn => ({
  id: row.id,
  question: row.question,
  quotes: JSON.parse(row.quotes) as Quote[],
  position: row.position,
  selection: row.selection ? (JSON.parse(row.selection) as AskSelection) : null,
  answer: row.answer,
  status: row.status,
  error: row.error,
  createdAt: row.created_at,
});

export const createConversations = ({ db, now = Date.now }: { db: DatabaseSync; now?: () => number }) => {
  db.exec(SCHEMA);
  // Nothing streams across a restart: an answer cut off by closing the app can be asked again.
  db.prepare("UPDATE turns SET status = 'interrupted' WHERE status = 'streaming'").run();

  const get = async ({ id }: { id: string }): Promise<Conversation | null> => {
    const row = db.prepare("SELECT id, book_id, session_id, title FROM conversations WHERE id = ?").get(id) as
      | { id: string; book_id: string; session_id: string | null; title: string }
      | undefined;
    if (!row) return null;
    const turns = db.prepare("SELECT * FROM turns WHERE conversation_id = ? ORDER BY created_at, rowid").all(id) as unknown as TurnRow[];
    return { id: row.id, bookId: row.book_id, sessionId: row.session_id, title: row.title, turns: turns.map(toTurn) };
  };

  return {
    get,

    async list({ bookId }: { bookId: string }): Promise<ConversationSummary[]> {
      const rows = db
        .prepare(
          `SELECT c.id, c.title, c.created_at, c.updated_at, COUNT(t.id) AS turn_count FROM conversations c
           LEFT JOIN turns t ON t.conversation_id = c.id
           WHERE c.book_id = ? GROUP BY c.id ORDER BY c.updated_at DESC, c.rowid DESC`,
        )
        .all(bookId) as { id: string; title: string; created_at: number; updated_at: number; turn_count: number }[];
      return rows.map((r) => ({ id: r.id, title: r.title, createdAt: r.created_at, updatedAt: r.updated_at, turnCount: r.turn_count }));
    },

    async latest({ bookId }: { bookId: string }): Promise<Conversation | null> {
      const row = db.prepare("SELECT id FROM conversations WHERE book_id = ? ORDER BY updated_at DESC, rowid DESC LIMIT 1").get(bookId) as
        | { id: string }
        | undefined;
      return row ? get({ id: row.id }) : null;
    },

    /** Saves a question as it's asked, starting its conversation (titled by it) if this is the first. */
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
      db.prepare(
        `INSERT INTO conversations (id, book_id, session_id, title, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET updated_at = excluded.updated_at`,
      ).run(conversationId, bookId, turn.question.trim().slice(0, TITLE_MAX), at, at);
      db.prepare(
        `INSERT INTO turns (id, conversation_id, question, quotes, position, selection, answer, status, error, created_at)
         VALUES (?, ?, ?, ?, ?, ?, '', 'streaming', NULL, ?)`,
      ).run(turn.id, conversationId, turn.question, JSON.stringify(turn.quotes), turn.position, turn.selection ? JSON.stringify(turn.selection) : null, at);
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
      const at = now();
      const row = db.prepare("SELECT conversation_id FROM turns WHERE id = ?").get(id) as { conversation_id: string } | undefined;
      if (!row) return;
      db.prepare("UPDATE turns SET answer = ?, status = ?, error = ? WHERE id = ?").run(answer, error === null ? "done" : "error", error, id);
      db.prepare("UPDATE conversations SET session_id = COALESCE(?, session_id), updated_at = ? WHERE id = ?").run(sessionId || null, at, row.conversation_id);
    },
  };
};

export type Conversations = ReturnType<typeof createConversations>;
