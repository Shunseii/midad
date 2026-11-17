import type { CorpusBookListing } from "./corpus";
import type {
  BookDetail,
  ImportResult,
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
] as const satisfies readonly Channel[];
