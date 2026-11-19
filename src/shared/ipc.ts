import type { Highlight, HighlightColor, LetterRef, Note, PageAnnotations, Part, Span } from "./annotations";
import type { StreamEvent } from "./ask";
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

export interface PublicSettings {
  endpoint: string;
  hasKey: boolean;
}

export type SyncInput = { bookId: string; mode: "new" } | { bookId: string; mode: "overwrite"; fileIds: string[] };

/** Everything the renderer can ask the main process for. Each key is one IPC channel. */
export interface HamishApi {
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
  "annotations.list": (input: { bookId: string; position: number }) => Promise<PageAnnotations>;
  "highlights.add": (input: { bookId: string; position: number; span: Span; color: HighlightColor }) => Promise<Highlight>;
  "highlights.remove": (input: { id: string }) => Promise<void>;
  "notes.add": (input: { bookId: string; position: number; span: Span; body: string }) => Promise<Note>;
  "notes.update": (input: { id: string; body: string }) => Promise<void>;
  "notes.delete": (input: { id: string }) => Promise<void>;
  "harakat.set": (input: LetterRef & { bookId: string; position: number; marks: string }) => Promise<void>;
  "harakat.remove": (input: LetterRef & { bookId: string; position: number }) => Promise<void>;
  "marker.get": (input: { bookId: string }) => Promise<LastRead | null>;
  "marker.set": (input: { bookId: string; position: number; part: Part; line: number; word: number }) => Promise<void>;
  "marker.clear": (input: { bookId: string }) => Promise<void>;
  /** Streams StreamEvents for requestId while it runs; resolves with the whole answer. */
  "ai.ask": (input: AskInput) => Promise<{ sessionId: string; text: string }>;
  "ai.cancel": (input: { requestId: string }) => Promise<void>;
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

export type Channel = keyof HamishApi;

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
  "annotations.list",
  "highlights.add",
  "highlights.remove",
  "notes.add",
  "notes.update",
  "notes.delete",
  "harakat.set",
  "harakat.remove",
  "marker.get",
  "marker.set",
  "marker.clear",
  "ai.ask",
  "ai.cancel",
] as const satisfies readonly Channel[];

/** Pushed from the main process to the renderer. */
export interface HamishEvents {
  /** Another process (the hamish CLI) changed the library. Returns an unsubscribe function. */
  onLibraryChanged: (callback: () => void) => () => void;
  /** Progress of an Ask AI request. Returns an unsubscribe function. */
  onAskEvent: (callback: (requestId: string, event: StreamEvent) => void) => () => void;
}

export const ASK_EVENT = "ai.event";

export const LIBRARY_CHANGED = "library.changed";
