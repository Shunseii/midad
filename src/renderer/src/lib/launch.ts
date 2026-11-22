import type { LibraryBook, ScrollAnchor } from "../../../shared/library";

export type OnLaunch = "library" | "continue";

export const ON_LAUNCH_PREF = { key: "reader.onLaunch", fallback: "library" as OnLaunch };

/** Where the app was when it last closed. Before this was recorded, closing always counted as reading. */
export type LastScreen = "library" | "reader";

export const LAST_SCREEN_PREF = { key: "app.lastScreen", fallback: "reader" as LastScreen };

export const screenOf = (pathname: string): LastScreen => (pathname.startsWith("/read/") ? "reader" : "library");

export interface LaunchPlace {
  bookId: string;
  position: number;
  anchor: ScrollAnchor | null;
}

/** Where the app opens: the most recently read book's saved place, or null for the library. Closing in the library opens the library. */
export const launchPlace = ({ onLaunch, lastScreen, books }: { onLaunch: OnLaunch; lastScreen: LastScreen; books: LibraryBook[] }): LaunchPlace | null => {
  if (onLaunch !== "continue" || lastScreen === "library") return null;
  let latest: LibraryBook | null = null;
  for (const book of books) {
    if (book.progress && book.progress.updatedAt > (latest?.progress?.updatedAt ?? -Infinity)) latest = book;
  }
  if (!latest?.progress) return null;
  return { bookId: latest.bookId, position: latest.progress.position, anchor: latest.progress.anchor };
};
