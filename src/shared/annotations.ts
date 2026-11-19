import type { Page } from "./page";

/**
 * Highlights and notes address words, not characters: `line` is the matn line
 * number (or the footnote's 1-based index in the ḥāshiya) and `word` is the
 * 1-based word in that line. Word boundaries don't move when harakat are shown
 * or hidden, and they're easy for an agent to name on the command line.
 */
export type Part = "matn" | "hashiya";

export interface WordRef {
  line: number;
  word: number;
}

/** Inclusive on both ends. */
export interface Span {
  part: Part;
  start: WordRef;
  end: WordRef;
}

export const HIGHLIGHT_COLORS = ["yellow", "green", "pink", "blue"] as const;
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number];

/** Who wrote it: the reader in the app, or an agent through the CLI. */
export type Author = "me" | "agent";

interface Anchored {
  id: string;
  bookId: string;
  position: number;
  span: Span;
  /** The words the span covered when it was made. */
  quote: string;
  /** True when a sync overwrote the page and the span no longer covers the same words. */
  stale: boolean;
  author: Author;
  createdAt: number;
}

export interface Highlight extends Anchored {
  color: HighlightColor;
}

export interface Note extends Anchored {
  body: string;
  updatedAt: number;
}

/** The reader's marks on one letter (see harakat.ts). */
export interface LetterRef {
  part: Part;
  line: number;
  word: number;
  /** 1-based base letter in the word, not counting marks. */
  letter: number;
}

export interface UserHarakat extends LetterRef {
  id: string;
  bookId: string;
  position: number;
  /** Shadda first, then at most one vowel. */
  marks: string;
  /** The letter the marks were put on. */
  base: string;
  /** True when a sync overwrote the page and that letter is no longer there. */
  stale: boolean;
  author: Author;
  createdAt: number;
}

export interface PageAnnotations {
  highlights: Highlight[];
  notes: Note[];
  harakat: UserHarakat[];
}

export type Token = { kind: "word"; text: string; word: number } | { kind: "space"; text: string };

export const tokenize = (text: string): Token[] => {
  let word = 0;
  return text
    .split(/(\s+)/)
    .filter((t) => t.length > 0)
    .map((t) => (/^\s+$/.test(t) ? { kind: "space", text: t } : { kind: "word", text: t, word: (word += 1) }));
};

export const wordsOf = (text: string): string[] => text.split(/\s+/).filter(Boolean);

export const lineText = ({ page, part, line }: { page: Page; part: Part; line: number }): string | null => {
  if (part === "matn") return page.matn.find((b) => b.line === line)?.text ?? null;
  return page.hashiya[line - 1]?.text ?? null;
};

const compareRefs = (a: WordRef, b: WordRef): number => a.line - b.line || a.word - b.word;

export const compareSpans = (a: Span, b: Span): number =>
  (a.part === b.part ? 0 : a.part === "matn" ? -1 : 1) || compareRefs(a.start, b.start);

/** Whether two spans share at least one word. */
export const spansOverlap = (a: Span, b: Span): boolean =>
  a.part === b.part && compareRefs(a.start, b.end) <= 0 && compareRefs(b.start, a.end) <= 0;

export const spanContains = ({ span, part, ref }: { span: Span; part: Part; ref: WordRef }): boolean =>
  span.part === part && compareRefs(span.start, ref) <= 0 && compareRefs(ref, span.end) <= 0;

/** The words a span covers, joined by single spaces. Throws if the span doesn't fit the page. */
export const quoteSpan = ({ page, span }: { page: Page; span: Span }): string => {
  const { part, start, end } = span;
  if (compareRefs(start, end) > 0) throw new Error("The span ends before it starts.");
  const picked: string[] = [];
  for (let line = start.line; line <= end.line; line += 1) {
    const text = lineText({ page, part, line });
    if (text === null) throw new Error(`There is no ${part} line ${line} on this page.`);
    const words = wordsOf(text);
    const from = line === start.line ? start.word : 1;
    const to = line === end.line ? end.word : words.length;
    if (from < 1 || to > words.length) {
      throw new Error(`${part} line ${line} has ${words.length} words; the span asks for words ${from}–${to}.`);
    }
    picked.push(...words.slice(from - 1, to));
  }
  return picked.join(" ");
};
