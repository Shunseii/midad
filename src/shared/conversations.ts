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
  /** Where in the question the pill sat. Older questions have none: their pills show first. */
  offset?: number;
}

/** "interrupted"": the app closed while the answer was still streaming. */
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
  /** The page the conversation started on; null for one saved before pages were kept. */
  position: number | null;
  /** That page's printed number, when it has one. */
  pageNumber: number | null;
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
