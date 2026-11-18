import type { Part, Span } from "./annotations";

/**
 * Ask AI runs a local Claude Code session. Each message carries a small hidden
 * block saying where the reader is; Claude reads the page itself with the
 * hamish CLI and cites lines as [[line 2]], [[lines 2-3]] or [[ḥāshiya 1]].
 */

export const SYSTEM_PROMPT = `You are a reading companion inside Hamish, a desktop reader for classical Arabic books. The reader asks about the page they have open.

Each message starts with a <reading-context> block naming the book, the page and any selected words. The reader doesn't see it. Read the text yourself with the hamish command before answering:
  hamish page <book> <page> --words     numbered matn lines (and ḥāshiya footnotes ḥ1, ḥ2…), words numbered
  hamish lines <book> <page> --line 2-3
  hamish annotations <book> <page>      the reader's highlights, notes and harakat
Answer from that page. Don't search for or cite other books.

Cite the lines you rely on inline as [[line 2]], [[lines 2-3]] or [[ḥāshiya 1]]. Write nothing else inside double brackets.

Only if the reader asks you to, you may add notes, highlights or harakat with hamish (run hamish --help); they are labelled as yours.

Arabic and English go on separate lines. An English paragraph may contain a few Arabic words inline. A paragraph that would start with Arabic puts the Arabic on its own line or lines, and any English follows on a new line. A line never starts in Arabic and then switches to English.

Write plain text in short paragraphs separated by blank lines. No markdown headings, tables or bullet lists.`;

export type Segment = { kind: "text"; text: string } | { kind: "cite"; part: Part; from: number; to: number };

const CITATION = /\[\[(lines?|ḥāshiya|hashiya|ḥashiya)\s+(\d+)(?:\s*[-–]\s*(\d+))?\]\]/g;

export const parseCitations = (text: string): Segment[] => {
  const segments: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(CITATION)) {
    const index = m.index ?? 0;
    if (index > last) segments.push({ kind: "text", text: text.slice(last, index) });
    const from = Number(m[2]);
    segments.push({ kind: "cite", part: m[1]?.startsWith("line") ? "matn" : "hashiya", from, to: m[3] ? Number(m[3]) : from });
    last = index + m[0].length;
  }
  if (last < text.length) segments.push({ kind: "text", text: text.slice(last) });
  return segments;
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
    ...quotes.map((q) => (q.span ? `quote: ${describeSpan(q.span)}: ${q.text}` : `quote (pasted): ${q.text}`)),
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
  "Bash(hamish:*)",
  "--append-system-prompt",
  systemPrompt,
  ...(sessionId ? ["--resume", sessionId] : []),
];
