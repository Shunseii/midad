import type { Quote } from "./conversations";

/** A question as it's typed: text with quote pills among the words. */
export type ComposerPart = { kind: "text"; text: string } | { kind: "quote"; quote: Quote };

/** Trims the question and records where in it each pill sat. */
export const serializeComposer = (parts: ComposerPart[]): { question: string; quotes: Quote[] } => {
  let raw = "";
  const placed: Quote[] = [];
  for (const part of parts) {
    if (part.kind === "text") raw += part.text;
    else placed.push({ ...part.quote, offset: raw.length });
  }
  const leading = raw.length - raw.trimStart().length;
  const question = raw.trim();
  const quotes = placed.map((q) => ({ ...q, offset: Math.min(Math.max((q.offset ?? 0) - leading, 0), question.length) }));
  return { question, quotes };
};

/** The question with its pills back in place. Quotes saved without an offset come first. */
export const parseComposer = ({ question, quotes }: { question: string; quotes: Quote[] }): ComposerPart[] => {
  const ordered = quotes
    .map((quote, index) => ({ quote, index, at: quote.offset ?? -1 }))
    .sort((a, b) => a.at - b.at || a.index - b.index);
  const parts: ComposerPart[] = [];
  let from = 0;
  for (const { quote, at } of ordered) {
    const to = Math.min(Math.max(at, from), question.length);
    if (to > from) parts.push({ kind: "text", text: question.slice(from, to) });
    parts.push({ kind: "quote", quote });
    from = to;
  }
  if (from < question.length) parts.push({ kind: "text", text: question.slice(from) });
  return parts;
};

/** The question for Claude: each pill becomes "[quote N]", numbered like the reading context's quotes. */
export const questionWithQuoteMarks = ({ question, quotes }: { question: string; quotes: Quote[] }): string => {
  // A message that is only quotes sends just them: no words of the reader's to add an instruction to.
  if (!question.trim()) return quotes.map((_, i) => `[quote ${i + 1}]`).join(" ");
  if (quotes.every((q) => q.offset === undefined)) return question;
  return parseComposer({ question, quotes })
    .map((part) => (part.kind === "text" ? part.text : `[quote ${quotes.indexOf(part.quote) + 1}]`))
    .join("");
};
