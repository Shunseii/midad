import { type Highlight, spanContains, tokenize } from "../../../shared/annotations";
import type { StoredPage } from "../../../shared/library";

/** A highlight that has just been made, drawn in like a marker: each word's place in it and how many words it has. */
export interface Sweep {
  id: string;
  order: Map<string, number>;
  count: number;
}

/** Every word a span covers, in reading order, keyed "part:line:word". */
export const sweepOrder = ({ page, highlight }: { page: StoredPage["page"]; highlight: Highlight }): Sweep => {
  const { span } = highlight;
  const order = new Map<string, number>();
  for (let line = span.start.line; line <= span.end.line; line += 1) {
    const text = span.part === "matn" ? page.matn.find((b) => b.line === line)?.text : page.hashiya[line - 1]?.text;
    const words = tokenize(text ?? "").filter((t) => t.kind === "word");
    for (const t of words) {
      if (t.kind !== "word" || !spanContains({ span, part: span.part, ref: { line, word: t.word } })) continue;
      order.set(`${span.part}:${line}:${t.word}`, order.size);
    }
  }
  return { id: highlight.id, order, count: Math.max(order.size, 1) };
};

/** The sweep's length grows with the highlight but never drags: a word or two is quick, a long passage caps out. */
const SWEEP_BASE_MS = 80;
const SWEEP_PER_WORD_MS = 25;
export const SWEEP_MAX_MS = 220;

export const sweepDuration = (count: number) => Math.min(SWEEP_BASE_MS + SWEEP_PER_WORD_MS * count, SWEEP_MAX_MS);

/** When the sweep reaches a point `progress` (0 to 1) of the way along: ease-out quad, inverted. */
const timeAt = (progress: number) => 1 - Math.sqrt(1 - Math.min(Math.max(progress, 0), 1));

/**
 * When one word (or, at a half position, the gap after a word) draws in, so the
 * whole sweep eases out: quick off the mark, settling on the last words.
 */
export const sweepTiming = ({ count, at }: { count: number; at: number }) => {
  const total = sweepDuration(count);
  const start = total * timeAt(at / count);
  const end = total * timeAt((at + 1) / count);
  return { delay: start, duration: end - start };
};
