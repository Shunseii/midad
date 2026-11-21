import { type Part, type Span, wordsOf } from "./annotations";
import { foldArabic, stripHarakat } from "./arabic";
import type { Page } from "./page";

export interface FindOptions {
  matchHarakat: boolean;
  /** Match whole words only, though a word may still carry a leading و ف ب ل ك or ال. */
  wholeWord: boolean;
}

/** Footnote references such as (١) written into a word aren't part of it. */
const FOOTNOTE_REFS = /\([٠-٩۰-۹0-9]+\)/g;

/** One part of the page as a single folded string, with where each word starts in it. */
interface Haystack {
  text: string;
  words: { line: number; word: number; start: number; end: number }[];
}

const linesOf = ({ page, part }: { page: Page; part: Part }): { line: number; text: string }[] =>
  part === "matn" ? page.matn.map((b) => ({ line: b.line, text: b.text })) : page.hashiya.map((f, i) => ({ line: i + 1, text: f.text }));

/** A part's words folded and joined by single spaces, across line breaks. Words that fold to nothing (bare punctuation) drop out. */
const haystackOf = ({ page, part, matchHarakat, lines }: { page: Page; part: Part; matchHarakat: boolean; lines?: { from: number; to: number } }): Haystack => {
  let text = "";
  const words: Haystack["words"] = [];
  for (const { line, text: lineText } of linesOf({ page, part })) {
    if (lines && (line < lines.from || line > lines.to)) continue;
    wordsOf(lineText).forEach((raw, i) => {
      const folded = foldArabic(raw.replace(FOOTNOTE_REFS, ""), { keepHarakat: matchHarakat });
      if (!folded) return;
      if (text) text += " ";
      words.push({ line, word: i + 1, start: text.length, end: text.length + folded.length });
      text += folded;
    });
  }
  return { text, words };
};

const foldQuery = ({ query, matchHarakat }: { query: string; matchHarakat: boolean }) =>
  foldArabic(query, { keepHarakat: matchHarakat }).trim().split(/\s+/).filter(Boolean).join(" ");

const CLITIC = /^(?:[وف]?(?:[بلك]|ال|لل)?|[وف]?[بك]?ال)$/;

/** Whether the match may start at `start` of a word: at its first letter, or right after a leading clitic. */
const startsWord = ({ word, text, start }: { word: { start: number }; text: string; start: number }) =>
  start === word.start || CLITIC.test(stripHarakat(text.slice(word.start, start)));

/** Every match of `query` on the page, matn first, in reading order. Each covers the whole words it touches. */
export const findOnPage = ({ page, query, options }: { page: Page; query: string; options: FindOptions }): Span[] => {
  const needle = foldQuery({ query, matchHarakat: options.matchHarakat });
  if (!needle) return [];
  const spans: Span[] = [];
  for (const part of ["matn", "hashiya"] as const) {
    const hay = haystackOf({ page, part, matchHarakat: options.matchHarakat });
    const wordAt = (offset: number) => hay.words.find((w) => offset >= w.start && offset < w.end);
    for (let at = hay.text.indexOf(needle); at !== -1; at = hay.text.indexOf(needle, at + 1)) {
      const first = wordAt(at);
      const last = wordAt(at + needle.length - 1);
      if (!first || !last) continue;
      if (options.wholeWord && (!startsWord({ word: first, text: hay.text, start: at }) || at + needle.length !== last.end)) continue;
      const previous = spans.at(-1);
      const overlapsPrevious = previous?.part === part && (previous.end.line > first.line || (previous.end.line === first.line && previous.end.word >= first.word));
      if (overlapsPrevious) continue;
      spans.push({ part, start: { line: first.line, word: first.word }, end: { line: last.line, word: last.word } });
    }
  }
  return spans;
};

/**
 * Where a quoted phrase sits in some lines, compared without harakat, tatweel or
 * punctuation. A match on whole words wins over one inside longer words; the
 * first wins after that. Null when the phrase isn't there.
 */
export const locatePhrase = ({ page, part, lines, phrase }: { page: Page; part: Part; lines: { from: number; to: number }; phrase: string }): Span | null => {
  const needle = foldQuery({ query: phrase, matchHarakat: false });
  if (!needle) return null;
  const hay = haystackOf({ page, part, matchHarakat: false, lines });
  const wordAt = (offset: number) => hay.words.find((w) => offset >= w.start && offset < w.end);
  let loose: Span | null = null;
  for (let at = hay.text.indexOf(needle); at !== -1; at = hay.text.indexOf(needle, at + 1)) {
    const first = wordAt(at);
    const last = wordAt(at + needle.length - 1);
    if (!first || !last) continue;
    const span = { part, start: { line: first.line, word: first.word }, end: { line: last.line, word: last.word } };
    if (at === first.start && at + needle.length === last.end) return span;
    loose ??= span;
  }
  return loose;
};
