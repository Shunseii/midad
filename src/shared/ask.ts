import { lineText, type Part, type Span, wordsOf } from "./annotations";
import type { Page } from "./page";

/**
 * Ask AI runs a local Claude Code session. Each message carries a small hidden
 * block saying where the reader is; Claude reads the page itself with the
 * midad CLI and cites lines as [[line 2]], [[lines 2-3]] or [[ḥāshiya 1]].
 */

export const SYSTEM_PROMPT = `You are a reading companion inside Midad, a desktop reader for classical Arabic books. The reader asks about the page they have open.

Each message starts with a <reading-context> block naming the book, the page and any selected words. The reader doesn't see it. Read the text yourself with the midad command before answering:
  midad page <book> <page> --words     numbered matn lines (and ḥāshiya footnotes ḥ1, ḥ2…), words numbered
  midad lines <book> <page> --line 2-3          those lines, words numbered
  midad lines <book> <page> --line 2 --words 3-5   just those words, to check a citation
  midad annotations <book> <page>      the reader's highlights, notes and harakat
A line can be followed by "gloss on word…" lines: interlinear glosses the book writes between its lines, explaining those words. They aren't part of the line and aren't numbered; cite the words they explain.
Answer from that page. Don't search for or cite other books.

The reader is a student learning to read these texts themselves. Answer exactly what they asked and stop. If they ask for the harakat of a word, give the vowelled word and nothing more: no translation, no explanation, no surrounding context. If they ask what a word means, give its meaning here, not a translation of the sentence. Never translate, parse, or explain more than was asked; doing the work for them takes away the learning. Keep answers short. You may end with one brief offer of further help, such as "Want the i'rab?", but never give it unasked.

Cite what you rely on inline. For a phrase, cite its words, numbered as in midad page --words: [[line 2:3-5]] is words 3 to 5 of line 2, [[line 2:4]] is word 4, [[ḥāshiya 1:2-3]] works the same way. Cite whole lines as [[line 2]] or [[lines 2-3]] only when you mean the whole line. The reader hovers a citation to see the words it covers, so cite the exact phrase you discuss. Write nothing else inside double brackets. Never count words yourself: copy word numbers from numbered output you have for that line in this turn, and before answering check each citation with midad lines --line <n> --words <a-b>, making sure it prints exactly the phrase you mean.

Speak of Allah, the Prophet, and the scholars with respect, as a student of these books would. Write "Allah", never "God", and follow His name with a phrase of praise such as تعالى, عز وجل, سبحانه وتعالى or جل جلاله. Follow every mention of the Prophet with ﷺ, of other prophets with عليه السلام, and of the Companions with رضي الله عنه (رضي الله عنها, رضي الله عنهم as fits). Follow the name of a deceased scholar with رحمه الله on first mention, and refer to the author and the scholars by name or title (the author, Imam al-Nawawi), never by surname alone or casually. Don't argue with or belittle them; when they differ, report each view fairly.

Only if the reader asks you to, you may add notes, highlights or harakat with midad (run midad --help); they are labelled as yours.

Arabic and English go on separate lines. An English paragraph may contain a few Arabic words inline. A paragraph that would start with Arabic puts the Arabic on its own line or lines, and any English follows on a new line. A line never starts in Arabic and then switches to English.

Write plain text in short paragraphs separated by blank lines. No markdown headings, tables or bullet lists.`;

export type Segment =
  | { kind: "text"; text: string }
  /** Lines `from`–`to`, or with `words`, just those words of the one line. */
  | { kind: "cite"; part: Part; from: number; to: number; words: { from: number; to: number } | null };

const CITATION = /\[\[(lines?|ḥāshiya|hashiya|ḥashiya)\s+(\d+)(?:\s*[-–]\s*(\d+))?(?::(\d+)(?:\s*[-–]\s*(\d+))?)?\]\]/g;

export const parseCitations = (text: string): Segment[] => {
  const segments: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(CITATION)) {
    // Word numbers only make sense within a single line.
    if (m[3] && m[4]) continue;
    const index = m.index ?? 0;
    if (index > last) segments.push({ kind: "text", text: text.slice(last, index) });
    const from = Number(m[2]);
    const words = m[4] ? { from: Number(m[4]), to: Number(m[5] ?? m[4]) } : null;
    segments.push({ kind: "cite", part: m[1]?.startsWith("line") ? "matn" : "hashiya", from, to: m[3] ? Number(m[3]) : from, words });
    last = index + m[0].length;
  }
  if (last < text.length) segments.push({ kind: "text", text: text.slice(last) });
  return segments;
};

/** The words a citation points at on its page, or null when the page has no such lines or words. */
export const citeSpan = ({ cite, page }: { cite: Extract<Segment, { kind: "cite" }>; page: Page }): Span | null => {
  const count = (line: number) => {
    const text = lineText({ page, part: cite.part, line });
    return text === null ? 0 : wordsOf(text).length;
  };
  for (let line = cite.from; line <= cite.to; line += 1) if (!count(line)) return null;
  if (cite.words) {
    const { from, to } = cite.words;
    if (from < 1 || to < from || to > count(cite.from)) return null;
    return { part: cite.part, start: { line: cite.from, word: from }, end: { line: cite.from, word: to } };
  }
  return { part: cite.part, start: { line: cite.from, word: 1 }, end: { line: cite.to, word: count(cite.to) } };
};

const describeSpan = ({ part, start, end }: Span) => {
  const where = part === "hashiya" ? `ḥāshiya ${start.line}` : `line ${start.line}`;
  const flag = part === "hashiya" ? "--hashiya " : "";
  if (start.line === end.line) return `${where}, words ${start.word}–${end.word} (${flag}--line ${start.line} --words ${start.word}-${end.word})`;
  return `${where} word ${start.word} to ${part === "hashiya" ? "ḥāshiya" : "line"} ${end.line} word ${end.word} (${flag}--from ${start.line}:${start.word} --to ${end.line}:${end.word})`;
};

export const readingContext = ({
  bookId,
  title,
  position,
  number,
  selection,
  quotes = [],
}: {
  bookId: string;
  title: string;
  position: number;
  number: number | null;
  selection?: { span: Span; text: string };
  /** Text the reader pasted into the question: from this page (with its span) or from elsewhere. */
  quotes?: { span: Span | null; text: string }[];
}): string =>
  [
    "<reading-context>",
    `book: ${bookId} (${title})`,
    `page ${position}${number === null ? "" : `, printed ${number}`}`,
    ...(selection ? [`selection: ${describeSpan(selection.span)}: ${selection.text}`] : []),
    ...quotes.map((q, i) => (q.span ? `quote ${i + 1}: ${describeSpan(q.span)}: ${q.text}` : `quote ${i + 1} (pasted): ${q.text}`)),
    "</reading-context>",
  ].join("\n");

export type StreamEvent =
  | { kind: "delta"; text: string }
  | { kind: "tool"; name: string }
  | { kind: "done"; text: string; sessionId: string }
  | { kind: "error"; message: string };

interface RawEvent {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  result?: string;
  session_id?: string;
  event?: { type?: string; delta?: { type?: string; text?: string }; content_block?: { type?: string; name?: string } };
}

/** One line of `claude --output-format stream-json`, reduced to what the panel shows. */
export const streamEvent = (line: string): StreamEvent | null => {
  let raw: RawEvent;
  try {
    raw = JSON.parse(line) as RawEvent;
  } catch {
    return null;
  }
  if (raw.type === "stream_event") {
    const { event } = raw;
    if (event?.type === "content_block_delta" && event.delta?.type === "text_delta" && event.delta.text) return { kind: "delta", text: event.delta.text };
    if (event?.type === "content_block_start" && event.content_block?.type === "tool_use") return { kind: "tool", name: event.content_block.name ?? "tool" };
    return null;
  }
  if (raw.type === "result") {
    if (raw.is_error || raw.subtype !== "success") return { kind: "error", message: raw.result || `Claude stopped (${raw.subtype ?? "unknown"}).` };
    return { kind: "done", text: raw.result ?? "", sessionId: raw.session_id ?? "" };
  }
  return null;
};

export const claudeArgs = ({ prompt, systemPrompt, sessionId }: { prompt: string; systemPrompt: string; sessionId: string | null }): string[] => [
  "-p",
  prompt,
  "--output-format",
  "stream-json",
  "--verbose",
  "--include-partial-messages",
  // The reader's own Claude settings (hooks, plugins, output styles) stay out of the reader.
  "--setting-sources",
  "project",
  "--strict-mcp-config",
  "--tools",
  "Bash",
  "--allowedTools",
  "Bash(midad:*)",
  "--append-system-prompt",
  systemPrompt,
  ...(sessionId ? ["--resume", sessionId] : []),
];
