import { lineText, type Part, type Span, wordsOf } from "./annotations";
import { locatePhrase } from "./find";
import type { Page } from "./page";

/**
 * Ask AI runs a local Claude Code session. Each message carries a small hidden
 * block saying where the reader is; Claude reads the page itself with the
 * midad CLI and cites lines as [[line 2]], [[lines 2-3]] or [[ḥāshiya 1]], and
 * phrases by their words: [[line 2: هو اللفظ]].
 */

export const SYSTEM_PROMPT = `You are a reading companion inside Midad, a desktop reader for classical Arabic books. The reader asks about the page they have open.

Each message starts with a <reading-context> block naming the book, the page and any selected words. The reader doesn't see it. Read the text yourself with the midad command before answering:
  midad page <book> <page> --words     numbered matn lines (and ḥāshiya footnotes ḥ1, ḥ2…), words numbered
  midad lines <book> <page> --line 2-3          those lines, words numbered
  midad lines <book> <page> --line 2 --words 3-5   just those words
  midad annotations <book> <page>      the reader's highlights, notes and harakat
A line can be followed by "gloss on word…" lines: interlinear glosses the book writes between its lines, explaining those words. They aren't part of the line and aren't numbered; cite the words they explain.
Answer from that page. Don't search for or cite other books.

The reader is a student learning to read these texts themselves. Answer exactly what they asked and stop. If they ask for the harakat of a word, give the vowelled word and nothing more: no translation, no explanation, no surrounding context. If they ask what a word means, give its meaning here, not a translation of the sentence. Never translate, parse, or explain more than was asked; doing the work for them takes away the learning. Keep answers short. You may end with one brief offer of further help, such as "Want the i'rab?", but never give it unasked.

Cite what you rely on inline. For a phrase, copy its exact words from the line into the citation: [[line 2: هو اللفظ المركب]] cites those words of line 2, and [[ḥāshiya 1: المراد بالوضع]] works the same way. Midad finds the words on the line itself, so never number them. If the phrase appears more than once on that line, include a word or two more so it is unique. Cite whole lines as [[line 2]] or [[lines 2-3]] only when you mean the whole line. The reader hovers a citation to see the words it covers, so cite the exact phrase you discuss. Write nothing else inside double brackets.

Speak of Allah, the Prophet, and the scholars with respect, as a student of these books would. Write "Allah", never "God". Use these honorific symbols, written as the single character: after Allah's name ﷻ, ﷿ or ﷾; after the Prophet ﷺ; after other prophets ﵇; after a Companion ﵁ (﵂ for a woman, ﵃ for a group, ﵄ for two); after a deceased scholar ﵀ (﵏ for several) on first mention. Never spell these out where a symbol exists. Refer to the author and the scholars by name or title (the author, Imam al-Nawawi), never by surname alone or casually. Don't argue with or belittle them; when they differ, report each view fairly.

Only if the reader asks you to, you may add notes, highlights or harakat with midad (run midad --help); they are labelled as yours.

Arabic and English go on separate lines. An English paragraph may contain a few Arabic words inline. A paragraph that would start with Arabic puts the Arabic on its own line or lines, and any English follows on a new line. A line never starts in Arabic and then switches to English.

Write plain text in short paragraphs separated by blank lines. No markdown headings, tables or bullet lists.`;

export type Segment =
  | { kind: "text"; text: string }
  /**
   * Lines `from`–`to`. With `phrase`, just those words, found in the lines by their text.
   * With `words` (the older form), those word numbers of the one line.
   */
  | { kind: "cite"; part: Part; from: number; to: number; words: { from: number; to: number } | null; phrase: string | null };

const CITATION = /\[\[(lines?|ḥāshiya|hashiya|ḥashiya)\s+(\d+)(?:\s*[-–]\s*(\d+))?(?:\s*:\s*([^\]\n]+?))?\s*\]\]/g;
const WORD_NUMBERS = /^(\d+)(?:\s*[-–]\s*(\d+))?$/;

export const parseCitations = (text: string): Segment[] => {
  const segments: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(CITATION)) {
    const after = m[4]?.trim() ?? "";
    const numbers = after.match(WORD_NUMBERS);
    // Word numbers only make sense within a single line.
    if (m[3] && numbers) continue;
    const index = m.index ?? 0;
    if (index > last) segments.push({ kind: "text", text: text.slice(last, index) });
    const from = Number(m[2]);
    const words = numbers ? { from: Number(numbers[1]), to: Number(numbers[2] ?? numbers[1]) } : null;
    const phrase = after && !numbers ? after : null;
    segments.push({ kind: "cite", part: m[1]?.startsWith("line") ? "matn" : "hashiya", from, to: m[3] ? Number(m[3]) : from, words, phrase });
    last = index + m[0].length;
  }
  if (last < text.length) segments.push({ kind: "text", text: text.slice(last) });
  return segments;
};

type CiteTarget = Omit<Extract<Segment, { kind: "cite" }>, "kind">;

/** The words a citation points at on its page, or null when the page has no such lines or words, or the phrase isn't in them. */
export const citeSpan = ({ cite, page }: { cite: CiteTarget; page: Page }): Span | null => {
  const count = (line: number) => {
    const text = lineText({ page, part: cite.part, line });
    return text === null ? 0 : wordsOf(text).length;
  };
  for (let line = cite.from; line <= cite.to; line += 1) if (!count(line)) return null;
  if (cite.phrase) return locatePhrase({ page, part: cite.part, lines: { from: cite.from, to: cite.to }, phrase: cite.phrase });
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
  /** Set instead of `result` when Claude stops before answering, e.g. "No conversation found with session ID: …". */
  errors?: string[];
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
    if (raw.is_error || raw.subtype !== "success") return { kind: "error", message: raw.result || raw.errors?.join(" ") || `Claude stopped (${raw.subtype ?? "unknown"}).` };
    return { kind: "done", text: raw.result ?? "", sessionId: raw.session_id ?? "" };
  }
  return null;
};

/** Claude's answer to a session it no longer has; asking again in a new session is the way on. */
export const isLostSession = (message: string): boolean => /no conversation found/i.test(message);

const RECAP_TURNS = 12;
const RECAP_ANSWER_CHARS = 1500;

/**
 * The conversation so far, for a new Claude session when the old one is gone.
 * The latest turns, with long answers cut short. Empty when there's nothing to carry over.
 */
export const sessionRecap = (turns: { question: string; answer: string; quotes: { text: string }[] }[]): string => {
  const carried = turns.filter((t) => t.answer.trim()).slice(-RECAP_TURNS);
  if (carried.length === 0) return "";
  const cut = (text: string) => (text.length > RECAP_ANSWER_CHARS ? `${text.slice(0, RECAP_ANSWER_CHARS)}…` : text);
  return [
    "<earlier-conversation>",
    "Your earlier session with this reader is no longer available. This is what was said so far, for context; don't repeat it.",
    ...carried.flatMap((t) => [
      `Reader: ${t.question || "Explain this passage."}${t.quotes.length ? ` (quoting: ${t.quotes.map((q) => q.text).join(" / ")})` : ""}`,
      `You: ${cut(t.answer.trim())}`,
    ]),
    "</earlier-conversation>",
  ].join("\n");
};

export const CORPUS_TOOLS = ["corpus_text", "corpus_edit", "corpus_history", "corpus_restore"].map((name) => `mcp__corpus__${name}`);

/** Claude Code starts the corpus server itself; it inherits the corpus credentials from Claude's environment, so they never appear here. */
export const corpusMcpConfig = (serverPath: string): string =>
  JSON.stringify({ mcpServers: { corpus: { type: "stdio", command: "node", args: ["--no-warnings", serverPath] } } });

export const claudeArgs = ({
  prompt,
  systemPrompt,
  sessionId,
  corpusServer = null,
}: {
  prompt: string;
  systemPrompt: string;
  sessionId: string | null;
  /** Path to the corpus MCP server, when Ask AI may fix the corpus text. */
  corpusServer?: string | null;
}): string[] => [
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
  ...(corpusServer ? ["--mcp-config", corpusMcpConfig(corpusServer)] : []),
  "--tools",
  "Bash",
  "--allowedTools",
  "Bash(midad:*)",
  ...(corpusServer ? CORPUS_TOOLS : []),
  "--append-system-prompt",
  systemPrompt,
  ...(sessionId ? ["--resume", sessionId] : []),
];
