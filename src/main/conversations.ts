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
  position INTEGER,
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
  addPositionColumn(db);
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
          `SELECT c.id, c.title, c.position, c.created_at, c.updated_at, COUNT(t.id) AS turn_count,
             (SELECT number FROM pages WHERE book_id = c.book_id AND position = c.position LIMIT 1) AS page_number
           FROM conversations c
           LEFT JOIN turns t ON t.conversation_id = c.id
           WHERE c.book_id = ? GROUP BY c.id ORDER BY c.updated_at DESC, c.rowid DESC`,
        )
        .all(bookId) as {
        id: string;
        title: string;
        position: number | null;
        page_number: number | null;
        created_at: number;
        updated_at: number;
        turn_count: number;
      }[];
      return rows.map((r) => ({
        id: r.id,
        title: r.title,
        position: r.position,
        pageNumber: r.page_number,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        turnCount: r.turn_count,
      }));
    },

    async latest({ bookId }: { bookId: string }): Promise<Conversation | null> {
      const row = db.prepare("SELECT id FROM conversations WHERE book_id = ? ORDER BY updated_at DESC, rowid DESC LIMIT 1").get(bookId) as
        | { id: string }
        | undefined;
      return row ? get({ id: row.id }) : null;
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
      const insertTurn = db.prepare(
        `INSERT INTO turns (id, conversation_id, question, quotes, position, selection, answer, status, error, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`,
      );
      db.exec("BEGIN");
      try {
        db.prepare(
          `INSERT INTO conversations (id, book_id, session_id, title, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (id) DO NOTHING`,
        ).run(id, bookId, sessionId, defaultTitle(first), first.position, at, at);
        for (const turn of turns) {
          insertTurn.run(
            turn.id,
            id,
            turn.question,
            JSON.stringify(turn.quotes),
            turn.position,
            turn.selection ? JSON.stringify(turn.selection) : null,
            turn.answer,
            turn.status,
            turn.error,
            at,
          );
        }
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    },

    /** Renames a conversation; a blank title keeps the old one. */
    async rename({ id, title }: { id: string; title: string }): Promise<void> {
      const trimmed = title.trim().slice(0, TITLE_MAX);
      if (trimmed) db.prepare("UPDATE conversations SET title = ? WHERE id = ?").run(trimmed, id);
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
      db.prepare(
        `INSERT INTO conversations (id, book_id, session_id, title, position, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET updated_at = excluded.updated_at`,
      ).run(conversationId, bookId, defaultTitle(turn), turn.position, at, at);
      db.prepare(
        `INSERT INTO turns (id, conversation_id, question, quotes, position, selection, answer, status, error, created_at)
         VALUES (?, ?, ?, ?, ?, ?, '', 'streaming', NULL, ?)`,
      ).run(turn.id, conversationId, turn.question, JSON.stringify(turn.quotes), turn.position, turn.selection ? JSON.stringify(turn.selection) : null, at);
    },

    /** Deletes a conversation and its turns. */
    async remove({ id }: { id: string }): Promise<void> {
      db.prepare("DELETE FROM turns WHERE conversation_id = ?").run(id);
      db.prepare("DELETE FROM conversations WHERE id = ?").run(id);
    },

    /** The conversation a question belongs to, with the turns asked before it. */
    async earlierTurns({ turnId }: { turnId: string }): Promise<StoredTurn[]> {
      const row = db.prepare("SELECT conversation_id FROM turns WHERE id = ?").get(turnId) as { conversation_id: string } | undefined;
      const conversation = row ? await get({ id: row.conversation_id }) : null;
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
      const at = now();
      const row = db.prepare("SELECT conversation_id FROM turns WHERE id = ?").get(id) as { conversation_id: string } | undefined;
      if (!row) return;
      db.prepare("UPDATE turns SET answer = ?, status = ?, error = ? WHERE id = ?").run(answer, error === null ? "done" : "error", error, id);
      db.prepare("UPDATE conversations SET session_id = COALESCE(?, session_id), updated_at = ? WHERE id = ?").run(sessionId || null, at, row.conversation_id);
    },
  };
};

export type Conversations = ReturnType<typeof createConversations>;
