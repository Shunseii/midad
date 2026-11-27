import type { IndexEntry } from "./fihris";
import type { Part } from "./annotations";
import type { Page } from "./page";

/** A word on the page and how far below the top of the reader's view it sat, so the place survives re-layout. */
export interface ScrollAnchor {
  part: Part;
  line: number;
  word: number;
  offset: number;
}

/** A book in the library on another device whose text this device hasn't imported yet. Older entries carry no title. */
export interface WaitingBook {
  bookId: string;
  title: string | null;
  author: string | null;
  addedAt: number;
}

export interface ReadingProgress {
  position: number;
  updatedAt: number;
  anchor: ScrollAnchor | null;
}

export interface LibraryBook {
  bookId: string;
  /** The work's name when the corpus book belongs to a work, else the book's own title. */
  title: string;
  author: string | null;
  /** The corpus book's own title (edition or copy) when it differs from the work's name. */
  edition: string | null;
  pageCount: number;
  importedAt: number;
  syncedAt: number;
  /** When the reader pinned the book to the top of the shelf; null when it isn't pinned. Synced between devices. */
  pinnedAt: number | null;
  progress: ReadingProgress | null;
}

export interface PageSummary {
  position: number;
  number: number | null;
  fileId: string;
  header: string | null;
  headings: { text: string; level: number }[];
}

export interface BookDetail extends LibraryBook {
  pages: PageSummary[];
  /** The book's own contents, read from its printed index of topics; null when it has none Midad can read. */
  index: IndexEntry[] | null;
}

export interface StoredPage {
  bookId: string;
  position: number;
  number: number | null;
  fileId: string;
  page: Page;
}

export interface SyncPreview {
  newPages: { fileId: string; number: number | null }[];
  changedPages: { fileId: string; number: number | null; position: number }[];
  pending: number;
}

export interface SyncResult {
  added: number;
  overwritten: number;
  pending: number;
}

/** Where an import stands: fetching pages from the corpus, then writing them to the library. */
export type ImportProgress = { phase: "downloading"; done: number; total: number } | { phase: "saving" };

export interface ImportResult {
  bookId: string;
  imported: number;
  pending: number;
}

/** Where the reader last marked their place: a word on a page, whose screen row is marked. */
export interface LastRead {
  position: number;
  part: Part;
  line: number;
  word: number;
  setAt: number;
}

/** A page bookmark. `name` is the reader's own, or null when they gave none. */
export interface Bookmark {
  position: number;
  name: string | null;
  createdAt: number;
}

/** What removing a book deletes, counted before it goes. */
export interface BookRemoval {
  bookId: string;
  title: string | null;
  pages: number;
  highlights: number;
  notes: number;
  harakat: number;
  bookmarks: number;
  conversations: number;
  memories: number;
}

const REMOVAL_COUNTS: { key: keyof Omit<BookRemoval, "bookId" | "title">; one: string; many: string }[] = [
  { key: "pages", one: "page", many: "pages" },
  { key: "highlights", one: "highlight", many: "highlights" },
  { key: "notes", one: "note", many: "notes" },
  { key: "harakat", one: "added haraka", many: "added harakat" },
  { key: "bookmarks", one: "bookmark", many: "bookmarks" },
  { key: "conversations", one: "conversation", many: "conversations" },
  { key: "memories", one: "memory", many: "memories" },
];

/** "1,147 pages · 3 notes · 2 conversations", leaving out what there's none of. */
export const removalCounts = (removal: BookRemoval): string =>
  REMOVAL_COUNTS.filter(({ key }) => removal[key] > 0)
    .map(({ key, one, many }) => `${removal[key].toLocaleString("en")} ${removal[key] === 1 ? one : many}`)
    .join(" · ");
