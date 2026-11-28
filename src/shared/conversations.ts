import type { Span } from "./annotations";

/** Passage a turn was asked about before quotes replaced it; only older saved turns have one. */
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
  /** Only on turns saved before Ask from the selection toolbar became a quote. */
  selection?: AskSelection | null;
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

/** Where an answer is saved as a note: on some words of a page. */
export interface NoteSpot {
  position: number;
  span: Span;
}

/**
 * Where Save as note puts an answer: on the one passage from the page its question quoted.
 * None when it quoted no page passage or several. Older turns asked about a selection use that.
 */
export const noteSpot = (turn: Pick<StoredTurn, "quotes" | "selection">): NoteSpot | null => {
  const fromPage = turn.quotes.flatMap((q) => (q.span ? [{ position: q.position, span: q.span }] : []));
  if (fromPage.length === 1) return fromPage[0] ?? null;
  if (fromPage.length === 0 && turn.selection) return { position: turn.selection.position, span: turn.selection.span };
  return null;
};
