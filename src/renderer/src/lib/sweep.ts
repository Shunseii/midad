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
