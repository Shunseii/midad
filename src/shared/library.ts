import type { Part } from "./annotations";
import type { Page } from "./page";

export interface ReadingProgress {
  position: number;
  updatedAt: number;
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
