import { lineText, type Part, type Span, type WordRef, wordsOf } from "./annotations";
import type { TextEdit } from "./corpus";
import type { Page } from "./page";

/**
 * Keeps what the reader pinned to words (highlights, notes, harakat, the last-read marker) on the
 * same words when a page's text changes. Everything is pinned by line and word number, which shift
 * whenever lines are added, removed, merged or split, so each word is followed through the stored
 * text instead:
 *
 * - An agent's find-and-replace edits say exactly which characters changed, so every word outside
 *   them moves to exactly the same word. A pin that ends inside replaced text stretches to cover
 *   the replacement.
 * - Any other change (a re-OCR, a sync) is a word diff of the old and new text: unchanged words are
 *   matched and followed, and pins on words that changed are left for the "Text changed" check.
 */

export interface WordAt {
  part: Part;
  line: number;
  word: number;
}

interface Range {
  start: number;
  end: number;
}

interface Token extends Range {
  text: string;
}

/** The page's stored text with everything that isn't reading text blanked out, keeping every offset. */
const visibleText = (source: string): string => {
  const blank = (s: string) => s.replace(/[^\n]/g, " ");
  return source
    .replace(/<rt>[\s\S]*?<\/rt>/g, blank)
    .replace(/<[^>\n]*>/g, blank)
    .replace(/^(\s*)(#{1,6}\s)/gm, (_, lead: string, hashes: string) => lead + blank(hashes))
    .replace(/^\s*(---|### الحاشية)\s*$/gm, blank);
};

const tokensOf = (text: string): Token[] => [...text.matchAll(/\S+/g)].map((m) => ({ text: m[0], start: m.index ?? 0, end: (m.index ?? 0) + m[0].length }));

/** Pairs equal items of two lists in order (longest common subsequence): index in `a` → index in `b`. */
const matchInOrder = <A, B>({ a, b, same }: { a: A[]; b: B[]; same: (x: A, y: B) => boolean }): Map<number, number> => {
  const n = a.length;
  const m = b.length;
  const width = m + 1;
  const table = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i * width + j] = same(a[i] as A, b[j] as B)
        ? (table[(i + 1) * width + j + 1] ?? 0) + 1
        : Math.max(table[(i + 1) * width + j] ?? 0, table[i * width + j + 1] ?? 0);
    }
  }
  const pairs = new Map<number, number>();
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (same(a[i] as A, b[j] as B)) {
      pairs.set(i, j);
      i += 1;
      j += 1;
    } else if ((table[(i + 1) * width + j] ?? 0) >= (table[i * width + j + 1] ?? 0)) i += 1;
    else j += 1;
  }
  return pairs;
};

const pageWords = (page: Page): { at: WordAt; text: string }[] => {
  const lines = (part: Part) => (part === "matn" ? page.matn.map((b) => b.line) : page.hashiya.map((_, i) => i + 1));
  return (["matn", "hashiya"] as const).flatMap((part) =>
    lines(part).flatMap((line) => wordsOf(lineText({ page, part, line }) ?? "").map((text, i) => ({ at: { part, line, word: i + 1 }, text }))),
  );
};

const keyOf = ({ part, line, word }: WordAt) => `${part}:${line}:${word}`;

/** Where each of the page's words sits in its stored text. */
export const wordRanges = ({ source, page }: { source: string; page: Page }): Map<string, Range> => {
  const words = pageWords(page);
  const tokens = tokensOf(visibleText(source));
  const pairs = matchInOrder({ a: words, b: tokens, same: (w, t) => w.text === t.text });
  const ranges = new Map<string, Range>();
  for (const [i, j] of pairs) {
    const word = words[i];
    const token = tokens[j];
    if (word && token) ranges.set(keyOf(word.at), { start: token.start, end: token.end });
  }
  return ranges;
};

/** Moves an offset in the old text to the new text; `side` decides which edge of replaced text it lands on. */
type OffsetMap = (offset: number, side: "start" | "end") => number | null;

/** The exact offset map of a list of edits, each applied to the text the previous ones left. Null when they don't turn `before` into `after`. */
export const editOffsets = ({ before, after, edits }: { before: string; after: string; edits: TextEdit[] }): OffsetMap | null => {
  let text = before;
  const steps: { at: number; removed: number; added: number }[] = [];
  for (const edit of edits) {
    const at = text.indexOf(edit.old);
    if (at === -1 || text.indexOf(edit.old, at + 1) !== -1) return null;
    text = text.slice(0, at) + edit.new + text.slice(at + edit.old.length);
    steps.push({ at, removed: edit.old.length, added: edit.new.length });
  }
  if (text !== after) return null;
  return (offset, side) => {
    let o = offset;
    for (const { at, removed, added } of steps) {
      // Before the edit, or at its edge: untouched. Text inserted at a word's start pushes the word along.
      if (o < at || (o === at && (side === "end" || removed > 0))) continue;
      if (o >= at + removed) o += added - removed;
      else o = side === "start" ? at : at + added;
    }
    return o;
  };
};

/** The offset map of a word diff: offsets in unchanged words move with them; others snap to the nearest unchanged word inward. */
const diffOffsets = ({ before, after }: { before: string; after: string }): OffsetMap => {
  const a = tokensOf(visibleText(before));
  const b = tokensOf(visibleText(after));
  const pairs = matchInOrder({ a, b, same: (x, y) => x.text === y.text });
  const moved = [...pairs].map(([i, j]) => ({ from: a[i] as Token, to: b[j] as Token }));
  return (offset, side) => {
    const inside = moved.find(({ from }) => offset >= from.start && offset <= from.end);
    if (inside) return inside.to.start + (offset - inside.from.start);
    if (side === "start") {
      const next = moved.find(({ from }) => from.start >= offset);
      return next ? next.to.start : null;
    }
    const previous = moved.findLast(({ from }) => from.end <= offset);
    return previous ? previous.to.end : null;
  };
};

export interface Realign {
  /** The span's words in the new text, or null when none of them can be followed. */
  span: (span: Span) => Span | null;
  /** The word in the new text, or null when it can't be followed. */
  word: (at: WordAt) => WordAt | null;
}

export const realignPage = ({
  before,
  after,
  edits = null,
}: {
  before: { source: string; page: Page };
  after: { source: string; page: Page };
  /** The agent's edits that turned `before` into `after`, when that's how it changed. */
  edits?: TextEdit[] | null;
}): Realign => {
  const map = (edits && editOffsets({ before: before.source, after: after.source, edits })) ?? diffOffsets({ before: before.source, after: after.source });
  const oldRanges = wordRanges(before);
  const newWords = [...wordRanges(after)].map(([key, range]) => {
    const [part, line, word] = key.split(":");
    return { at: { part: part as Part, line: Number(line), word: Number(word) }, ...range };
  });
  const sameOrder = (x: WordAt, y: WordAt) => (x.part === y.part ? 0 : x.part === "matn" ? -1 : 1) || x.line - y.line || x.word - y.word;
  newWords.sort((x, y) => sameOrder(x.at, y.at));

  const firstFrom = (offset: number) => newWords.find((w) => w.end > offset);
  const lastBefore = (offset: number) => newWords.findLast((w) => w.start < offset);

  const word: Realign["word"] = (at) => {
    const old = oldRanges.get(keyOf(at));
    if (!old) return null;
    const start = map(old.start, "start");
    const end = map(old.end, "end");
    if (start === null || end === null || end <= start) return null;
    const found = firstFrom(start);
    return found && found.start < end ? found.at : null;
  };

  const span: Realign["span"] = ({ part, start, end }) => {
    const from = oldRanges.get(keyOf({ part, ...start }));
    const to = oldRanges.get(keyOf({ part, ...end }));
    if (!from || !to) return null;
    const startAt = map(from.start, "start");
    const endAt = map(to.end, "end");
    if (startAt === null || endAt === null || endAt <= startAt) return null;
    const first = firstFrom(startAt);
    const last = lastBefore(endAt);
    if (!first || !last || first.at.part !== last.at.part || sameOrder(first.at, last.at) > 0) return null;
    const ref = (w: WordAt): WordRef => ({ line: w.line, word: w.word });
    return { part: first.at.part, start: ref(first.at), end: ref(last.at) };
  };

  return { span, word };
};
