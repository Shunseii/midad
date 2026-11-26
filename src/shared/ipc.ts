import type { BookMarks, Highlight, HighlightColor, LetterRef, Note, NoteTarget, PageAnnotations, PageNote, Part, Span } from "./annotations";
import type { StreamEvent } from "./ask";
import type { Conversation, ConversationSummary, StoredTurn } from "./conversations";
import type { CorpusBookListing, TextEdit } from "./corpus";
import type { Memory } from "./memories";
import type {
  BookDetail,
  Bookmark,
  ImportProgress,
  ImportResult,
  LastRead,
  LibraryBook,
  ScrollAnchor,
  StoredPage,
  SyncPreview,
  SyncResult,
  WaitingBook,
} from "./library";
import type { SyncSettings, SyncStatus } from "./sync";

export type { CorpusBookListing };

/** "system" follows the operating system's light or dark setting. */
export type Theme = "system" | "light" | "dark";

export interface PublicSettings {
  endpoint: string;
  hasKey: boolean;
}

export type SyncInput =
  | { bookId: string; mode: "new" }
  /** `edits`: the agent's find-and-replace edits that changed a page, by file, so its notes and marks move exactly. */
  | { bookId: string; mode: "overwrite"; fileIds: string[]; edits?: Record<string, TextEdit[]> };

/** Everything the renderer can ask the main process for. Each key is one IPC channel. */
export interface MidadApi {
  "settings.get": () => Promise<PublicSettings>;
  "settings.save": (input: { endpoint: string; key?: string }) => Promise<PublicSettings>;
  "settings.test": (input: { endpoint: string; key?: string }) => Promise<{ ok: true } | { ok: false; message: string }>;
  "corpus.listBooks": () => Promise<CorpusBookListing[]>;
  "library.list": () => Promise<LibraryBook[]>;
  /** Books in the library on other devices that aren't on this one yet. */
  "library.elsewhere": () => Promise<WaitingBook[]>;
  "library.get": (bookId: string) => Promise<BookDetail | null>;
  "library.page": (input: { bookId: string; position: number }) => Promise<StoredPage | null>;
  "library.import": (input: { corpusBookId: string }) => Promise<ImportResult>;
  "library.previewSync": (input: { bookId: string }) => Promise<SyncPreview>;
  "library.sync": (input: SyncInput) => Promise<SyncResult>;
  "library.setProgress": (input: { bookId: string; position: number; anchor?: ScrollAnchor }) => Promise<void>;
  "library.firstLine": (input: { bookId: string; position: number }) => Promise<string | null>;
  "annotations.list": (input: { bookId: string; position: number }) => Promise<PageAnnotations>;
  "annotations.bookMarks": (input: { bookId: string }) => Promise<BookMarks>;
  "highlights.add": (input: { bookId: string; position: number; span: Span; color: HighlightColor }) => Promise<Highlight>;
  "highlights.remove": (input: { id: string }) => Promise<void>;
  "notes.add": (input: NoteTarget & { bookId: string; position: number; body: string }) => Promise<Note | PageNote>;
  "notes.update": (input: { id: string; body: string }) => Promise<void>;
  "notes.delete": (input: { id: string }) => Promise<void>;
  "harakat.set": (input: LetterRef & { bookId: string; position: number; marks: string }) => Promise<void>;
  "harakat.remove": (input: LetterRef & { bookId: string; position: number }) => Promise<void>;
  "harakat.clear": (input: { bookId: string; position: number; span: Span }) => Promise<{ ref: LetterRef; marks: string }[]>;
  "marker.get": (input: { bookId: string }) => Promise<LastRead | null>;
  "marker.set": (input: { bookId: string; position: number; part: Part; line: number; word: number }) => Promise<void>;
  "marker.clear": (input: { bookId: string }) => Promise<void>;
  "bookmarks.list": (input: { bookId: string }) => Promise<Bookmark[]>;
  "bookmarks.set": (input: { bookId: string; position: number; name?: string | null; createdAt?: number }) => Promise<Bookmark>;
  "bookmarks.remove": (input: { bookId: string; position: number }) => Promise<void>;
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
  /** Saves a conversation that so far lived only in the panel, with all its turns. */
  "conversations.save": (input: { id: string; bookId: string; sessionId: string | null; turns: Omit<StoredTurn, "createdAt">[] }) => Promise<void>;
  "conversations.rename": (input: { id: string; title: string }) => Promise<void>;
  /** Asks a quick Claude model for a name, saves it and returns it. */
  "conversations.nameWithClaude": (input: { id: string }) => Promise<string>;
  /** Every memory Ask AI keeps, every book's included, newest first. */
  "memories.list": () => Promise<Memory[]>;
  /** The reader's edit, including moving it between global (bookId null) and a book; it then shows as edited. */
  "memories.update": (input: { id: string; description: string; body: string; bookId: string | null }) => Promise<Memory>;
  "memories.remove": (input: { id: string }) => Promise<void>;
  /** Puts a deleted memory back, for undo. */
  "memories.restore": (input: { memory: Memory }) => Promise<void>;
  "app.setTheme": (input: { theme: Theme }) => Promise<void>;
  "sync.settings": () => Promise<SyncSettings>;
  "sync.status": () => Promise<SyncStatus>;
  /** Saves the server and (when given) a new token, and connects; without a token, the saved one is used. */
  "sync.connect": (input: { url: string; token?: string }) => Promise<SyncSettings>;
  /** Stops syncing, keeping the server and token for connecting again. */
  "sync.disconnect": () => Promise<SyncSettings>;
  "sync.dismissClockWarning": () => Promise<void>;
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
  /** Which Claude model answers; Ask AI's default when missing or not one it offers. */
  model?: string;
  /** Questions since the last finished answer whose answers were stopped, for Claude to be told about. */
  cutOff?: { question: string; answer: string; status: string; quotes: { text: string }[] }[];
}

export type Channel = keyof MidadApi;

export const CHANNELS = [
  "settings.get",
  "settings.save",
  "settings.test",
  "corpus.listBooks",
  "library.list",
  "library.elsewhere",
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
  "bookmarks.list",
  "bookmarks.set",
  "bookmarks.remove",
  "ai.ask",
  "ai.cancel",
  "conversations.list",
  "conversations.latest",
  "conversations.get",
  "conversations.remove",
  "conversations.save",
  "conversations.rename",
  "conversations.nameWithClaude",
  "conversations.addTurn",
  "memories.list",
  "memories.update",
  "memories.remove",
  "memories.restore",
  "app.setTheme",
  "sync.settings",
  "sync.status",
  "sync.connect",
  "sync.disconnect",
  "sync.dismissClockWarning",
] as const satisfies readonly Channel[];

/** Pushed from the main process to the renderer. */
export interface MidadEvents {
  /** Another process (the midad CLI) changed the library. Returns an unsubscribe function. */
  onLibraryChanged: (callback: () => void) => () => void;
  /** What a merge from another process or device changed, so undo can forget it. Returns an unsubscribe function. */
  onRemoteChanges: (callback: (changes: RemoteChanges) => void) => () => void;
  /** Progress of a book being imported from the corpus. Returns an unsubscribe function. */
  onImportProgress: (callback: (corpusBookId: string, progress: ImportProgress) => void) => () => void;
  /** Progress of an Ask AI request. Returns an unsubscribe function. */
  onAskEvent: (callback: (requestId: string, event: StreamEvent) => void) => () => void;
  /** Device sync's status changed. Returns an unsubscribe function. */
  onSyncStatus: (callback: (status: SyncStatus) => void) => () => void;
}

export const SYNC_STATUS = "sync.statusChanged";

export const ASK_EVENT = "ai.event";

export const LIBRARY_CHANGED = "library.changed";

/**
 * The rows a merge from another process (the CLI, the corpus MCP server) or another device changed
 * or deleted, by what undo history names them by: ids, letters and pages. Letters list where a
 * mark was and where it is now.
 */
export interface RemoteChanges {
  highlights: string[];
  notes: string[];
  harakat: (LetterRef & { bookId: string; position: number })[];
  /** Books whose last-read marker changed. */
  markers: string[];
  bookmarks: { bookId: string; position: number }[];
}

export const REMOTE_CHANGES = "library.remoteChanges";

export const IMPORT_PROGRESS = "library.importProgress";
