import type { LibraryBook, ScrollAnchor } from "../../../shared/library";

export type OnLaunch = "library" | "continue";

export const ON_LAUNCH_PREF = { key: "reader.onLaunch", fallback: "library" as OnLaunch };

export interface LaunchPlace {
  bookId: string;
  position: number;
  anchor: ScrollAnchor | null;
}

/** Where the app opens: the most recently read book's saved place, or null for the library. */
export const launchPlace = ({ onLaunch, books }: { onLaunch: OnLaunch; books: LibraryBook[] }): LaunchPlace | null => {
  if (onLaunch !== "continue") return null;
  let latest: LibraryBook | null = null;
  for (const book of books) {
    if (book.progress && book.progress.updatedAt > (latest?.progress?.updatedAt ?? -Infinity)) latest = book;
  }
  if (!latest?.progress) return null;
  return { bookId: latest.bookId, position: latest.progress.position, anchor: latest.progress.anchor };
};
