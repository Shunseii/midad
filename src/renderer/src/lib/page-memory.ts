/**
 * Where the reader was on each page during this app session, so a page shown
 * again comes back to the same spot. Kept in memory only: gone on restart.
 */
import type { ScrollAnchor } from "../../../shared/library";

/** A word to put back at its height in the view, or, on a page without words, a plain offset. */
export type PagePlace = { anchor: ScrollAnchor } | { scrollTop: number };

export interface PageRef {
  bookId: string;
  position: number;
}

/** How a page that has just come on screen should be scrolled. */
export type Arrival =
  /** The book is opening: its saved last-read place or a launch position handles it. */
  | { kind: "opening" }
  /** The navigation brought its own target (a citation, a note, the marker, a ReaderState). */
  | { kind: "target" }
  | { kind: "restore"; place: PagePlace }
  | { kind: "top" };

const keyOf = ({ bookId, position }: PageRef) => `${bookId}\u0000${position}`;

export const createPageMemory = () => {
  const places = new Map<string, PagePlace>();
  return {
    remember: ({ page, place }: { page: PageRef; place: PagePlace }) => void places.set(keyOf(page), place),
    recall: (page: PageRef): PagePlace | null => places.get(keyOf(page)) ?? null,
  };
};

export type PageMemory = ReturnType<typeof createPageMemory>;

export const pageMemory = createPageMemory();

export const arrival = ({ page, opening, hasTarget, memory }: { page: PageRef; opening: boolean; hasTarget: boolean; memory: PageMemory }): Arrival => {
  if (opening) return { kind: "opening" };
  if (hasTarget) return { kind: "target" };
  const place = memory.recall(page);
  return place ? { kind: "restore", place } : { kind: "top" };
};
