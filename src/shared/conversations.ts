import type { Span } from "./annotations";

export interface AskSelection {
  span: Span;
  text: string;
  position: number;
}

/** A passage pasted into the question. `span` is set when it was copied from the page. */
export interface Quote {
  id: string;
  text: string;
  span: Span | null;
  position: number;
}

/** "interrupted": the app closed while the answer was still streaming. */
export type TurnStatus = "streaming" | "done" | "error" | "interrupted";

export interface StoredTurn {
  id: string;
  question: string;
  quotes: Quote[];
  position: number;
  selection: AskSelection | null;
  answer: string;
  status: TurnStatus;
  error: string | null;
  createdAt: number;
}

export interface ConversationSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  turnCount: number;
}

export interface Conversation {
  id: string;
  bookId: string;
  sessionId: string | null;
  title: string;
  turns: StoredTurn[];
}
