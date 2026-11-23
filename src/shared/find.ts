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
  foldArabic(query.replace(FOOTNOTE_REFS, ""), { keepHarakat: matchHarakat }).trim().split(/\s+/).filter(Boolean).join(" ");

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

/** How many words a quoted phrase has once folded, as `locatePhrases` counts them for `focus`. */
export const phraseWordCount = (phrase: string): number => {
  const folded = foldQuery({ query: phrase, matchHarakat: false });
  return folded ? folded.split(" ").length : 0;
};

/**
 * Every place a quoted phrase sits in some lines, compared without harakat, tatweel or
 * punctuation, in reading order. Matches on whole words win: matches inside longer words
 * count only when there are none. With `focus`, each match narrows to those of the phrase's
 * words (from 0, `to` excluded).
 */
export const locatePhrases = ({
  page,
  part,
  lines,
  phrase,
  focus,
}: {
  page: Page;
  part: Part;
  lines: { from: number; to: number };
  phrase: string;
  focus?: { from: number; to: number };
}): Span[] => {
  const needle = foldQuery({ query: phrase, matchHarakat: false });
  if (!needle) return [];
  const hay = haystackOf({ page, part, matchHarakat: false, lines });
  const whole: Span[] = [];
  const loose: Span[] = [];
  for (let at = hay.text.indexOf(needle); at !== -1; at = hay.text.indexOf(needle, at + 1)) {
    const end = at + needle.length;
    const touched = hay.words.filter((w) => w.end > at && w.start < end);
    const picked = focus ? touched.slice(focus.from, focus.to) : touched;
    const first = picked[0];
    const last = picked.at(-1);
    if (!first || !last) continue;
    const span = { part, start: { line: first.line, word: first.word }, end: { line: last.line, word: last.word } };
    const exact = at === touched[0]?.start && end === touched.at(-1)?.end;
    (exact ? whole : loose).push(span);
  }
  return whole.length ? whole : loose;
};

/** Where a quoted phrase first sits in some lines, a whole-word match first. Null when it isn't there. */
export const locatePhrase = (args: { page: Page; part: Part; lines: { from: number; to: number }; phrase: string }): Span | null => locatePhrases(args)[0] ?? null;
