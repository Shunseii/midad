import type { BookMarks, Highlight, HighlightColor, LetterRef, Note, PageAnnotations, Part, Span } from "./annotations";
import type { StreamEvent } from "./ask";
import type { Conversation, ConversationSummary, StoredTurn } from "./conversations";
import type { CorpusBookListing } from "./corpus";
import type {
  BookDetail,
  ImportResult,
  LastRead,
  LibraryBook,
  StoredPage,
  SyncPreview,
  SyncResult,
} from "./library";

export type { CorpusBookListing };

/** "system" follows the operating system's light or dark setting. */
export type Theme = "system" | "light" | "dark";

export interface PublicSettings {
  endpoint: string;
  hasKey: boolean;
}

export type SyncInput = { bookId: string; mode: "new" } | { bookId: string; mode: "overwrite"; fileIds: string[] };

/** Everything the renderer can ask the main process for. Each key is one IPC channel. */
export interface MidadApi {
  "settings.get": () => Promise<PublicSettings>;
  "settings.save": (input: { endpoint: string; key?: string }) => Promise<PublicSettings>;
  "settings.test": (input: { endpoint: string; key?: string }) => Promise<{ ok: true } | { ok: false; message: string }>;
  "corpus.listBooks": () => Promise<CorpusBookListing[]>;
  "library.list": () => Promise<LibraryBook[]>;
  "library.get": (bookId: string) => Promise<BookDetail | null>;
  "library.page": (input: { bookId: string; position: number }) => Promise<StoredPage | null>;
  "library.import": (input: { corpusBookId: string }) => Promise<ImportResult>;
  "library.previewSync": (input: { bookId: string }) => Promise<SyncPreview>;
  "library.sync": (input: SyncInput) => Promise<SyncResult>;
  "library.setProgress": (input: { bookId: string; position: number }) => Promise<void>;
  "library.firstLine": (input: { bookId: string; position: number }) => Promise<string | null>;
  "annotations.list": (input: { bookId: string; position: number }) => Promise<PageAnnotations>;
  "annotations.bookMarks": (input: { bookId: string }) => Promise<BookMarks>;
  "highlights.add": (input: { bookId: string; position: number; span: Span; color: HighlightColor }) => Promise<Highlight>;
  "highlights.remove": (input: { id: string }) => Promise<void>;
  "notes.add": (input: { bookId: string; position: number; span: Span; body: string }) => Promise<Note>;
  "notes.update": (input: { id: string; body: string }) => Promise<void>;
  "notes.delete": (input: { id: string }) => Promise<void>;
  "harakat.set": (input: LetterRef & { bookId: string; position: number; marks: string }) => Promise<void>;
  "harakat.remove": (input: LetterRef & { bookId: string; position: number }) => Promise<void>;
  "harakat.clear": (input: { bookId: string; position: number; span: Span }) => Promise<{ ref: LetterRef; marks: string }[]>;
  "marker.get": (input: { bookId: string }) => Promise<LastRead | null>;
  "marker.set": (input: { bookId: string; position: number; part: Part; line: number; word: number }) => Promise<void>;
  "marker.clear": (input: { bookId: string }) => Promise<void>;
  /** Streams StreamEvents for requestId while it runs; resolves with the whole answer. */
  /** `restarted`: Claude no longer had the conversation's session, so the answer came from a new one given the conversation so far. */
  "ai.ask": (input: AskInput) => Promise<{ sessionId: string; text: string; restarted: boolean }>;
  "ai.cancel": (input: { requestId: string }) => Promise<void>;
  "conversations.list": (input: { bookId: string }) => Promise<ConversationSummary[]>;
  "conversations.latest": (input: { bookId: string }) => Promise<Conversation | null>;
  "conversations.get": (input: { id: string }) => Promise<Conversation | null>;
  /** Saves a question before it's asked; ai.ask saves its answer. */
  "conversations.addTurn": (input: {
    conversationId: string;
    bookId: string;
    turn: Omit<StoredTurn, "answer" | "status" | "error" | "createdAt">;
  }) => Promise<void>;
  "conversations.remove": (input: { id: string }) => Promise<void>;
  "app.setTheme": (input: { theme: Theme }) => Promise<void>;
}

export interface AskInput {
  requestId: string;
  bookId: string;
  position: number;
  question: string;
  selection?: { span: Span; text: string };
  /** Passages pasted into the question; `span` only for ones copied from this page. */
  quotes?: { span: Span | null; text: string }[];
  /** The conversation's Claude session, to continue it. */
  sessionId: string | null;
}

export type Channel = keyof MidadApi;

export const CHANNELS = [
  "settings.get",
  "settings.save",
  "settings.test",
  "corpus.listBooks",
  "library.list",
  "library.get",
  "library.page",
  "library.import",
  "library.previewSync",
  "library.sync",
  "library.setProgress",
  "library.firstLine",
  "annotations.list",
  "annotations.bookMarks",
  "highlights.add",
  "highlights.remove",
  "notes.add",
  "notes.update",
  "notes.delete",
  "harakat.set",
  "harakat.remove",
  "harakat.clear",
  "marker.get",
  "marker.set",
  "marker.clear",
  "ai.ask",
  "ai.cancel",
  "conversations.list",
  "conversations.latest",
  "conversations.get",
  "conversations.remove",
  "conversations.addTurn",
  "app.setTheme",
] as const satisfies readonly Channel[];

/** Pushed from the main process to the renderer. */
export interface MidadEvents {
  /** Another process (the midad CLI) changed the library. Returns an unsubscribe function. */
  onLibraryChanged: (callback: () => void) => () => void;
  /** Progress of an Ask AI request. Returns an unsubscribe function. */
  onAskEvent: (callback: (requestId: string, event: StreamEvent) => void) => () => void;
}

export const ASK_EVENT = "ai.event";

export const LIBRARY_CHANGED = "library.changed";
