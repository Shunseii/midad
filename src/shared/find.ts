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
const haystackOf = ({ page, part, matchHarakat }: { page: Page; part: Part; matchHarakat: boolean }): Haystack => {
  let text = "";
  const words: Haystack["words"] = [];
  for (const { line, text: lineText } of linesOf({ page, part })) {
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

const CLITIC = /^(?:[وف]?(?:[بلك]|ال|لل)?|[وف]?[بك]?ال)$/;

/** Whether the match may start at `start` of a word: at its first letter, or right after a leading clitic. */
const startsWord = ({ word, text, start }: { word: { start: number }; text: string; start: number }) =>
  start === word.start || CLITIC.test(stripHarakat(text.slice(word.start, start)));

/** Every match of `query` on the page, matn first, in reading order. Each covers the whole words it touches. */
export const findOnPage = ({ page, query, options }: { page: Page; query: string; options: FindOptions }): Span[] => {
  const needle = foldArabic(query, { keepHarakat: options.matchHarakat }).trim().split(/\s+/).filter(Boolean).join(" ");
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
