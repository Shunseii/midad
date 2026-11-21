import { describe, expect, it } from "vitest";
import type { LibraryBook, ReadingProgress } from "../../../shared/library";
import { launchPlace } from "./launch";

const book = ({ bookId, progress }: { bookId: string; progress: ReadingProgress | null }): LibraryBook => ({
  bookId,
  title: bookId,
  author: null,
  edition: null,
  pageCount: 10,
  importedAt: 0,
  syncedAt: 0,
  progress,
});

const anchor = { part: "matn" as const, line: 3, word: 1, offset: 12 };

describe("launchPlace", () => {
  const books = [
    book({ bookId: "older", progress: { position: 4, updatedAt: 100, anchor: null } }),
    book({ bookId: "unread", progress: null }),
    book({ bookId: "latest", progress: { position: 7, updatedAt: 300, anchor } }),
    book({ bookId: "middle", progress: { position: 2, updatedAt: 200, anchor: null } }),
  ];

  it("opens the library when set to", () => {
    expect(launchPlace({ onLaunch: "library", books })).toBeNull();
  });

  it("continues the most recently read book at its saved page and word", () => {
    expect(launchPlace({ onLaunch: "continue", books })).toEqual({ bookId: "latest", position: 7, anchor });
  });

  it("falls back to the library when no book has a page to return to", () => {
    expect(launchPlace({ onLaunch: "continue", books: [book({ bookId: "unread", progress: null })] })).toBeNull();
    expect(launchPlace({ onLaunch: "continue", books: [] })).toBeNull();
  });

  it("opens at the page top when the place on the page wasn't saved", () => {
    expect(launchPlace({ onLaunch: "continue", books: books.slice(0, 2) })).toEqual({ bookId: "older", position: 4, anchor: null });
  });
});
