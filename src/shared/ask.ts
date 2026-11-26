import { lineText, type Part, type Span, wordsOf } from "./annotations";
import { locatePhrases, phraseWordCount } from "./find";
import type { Gloss, Page } from "./page";
import { foldArabic } from "./arabic";
import type { Memory } from "./memories";

/**
 * Ask AI runs a local Claude Code session. Each message carries a small hidden
 * block saying where the reader is; Claude reads the page itself with the
 * midad CLI and cites lines as [[line 2]], [[lines 2-3]] or [[ḥāshiya 1]], and
 * phrases by their words: [[line 2: هو اللفظ]], with braces around the words meant when they repeat:
 * [[line 2: قال {الكلام} هو]].
 */

export const SYSTEM_PROMPT = `You are a reading companion inside Midad, a desktop reader for classical Arabic books. The reader asks about the page they have open.

Each message starts with a <reading-context> block naming the book, the page and any selected words. The reader doesn't see it. Read the text yourself with the midad command before answering:
  midad page <book> <page> --words     numbered matn lines (and ḥāshiya footnotes ḥ1, ḥ2…), words numbered
  midad lines <book> <page> --line 2-3          those lines, words numbered
  midad lines <book> <page> --line 2 --words 3-5   just those words
  midad annotations <book> <page>      the reader's highlights, notes (on words, lines or the page) and harakat
A line can be followed by "gloss on word…" lines: interlinear glosses the book writes between its lines, explaining those words. They aren't part of the line and aren't numbered. To cite a gloss, quote its words with the line it sits on, as for a phrase: [[line 2: أي ابن آجروم]]; Midad finds them in the line's glosses and points at the words they explain.
Answer from that page. Don't search for or cite other books.

The reader is a student learning to read these texts themselves. Answer exactly what they asked and stop. If they ask for the harakat of a word, give the vowelled word and nothing more: no translation, no explanation, no surrounding context. If they ask what a word means, give its meaning here, not a translation of the sentence. Never translate, parse, or explain more than was asked; doing the work for them takes away the learning. Keep answers short. You may end with one brief offer of further help, such as "Want the i'rab?", but never give it unasked. When the reader shares their own attempt (a reading with harakat, a translation, an iʿrāb, their understanding of the page), say what is right and give a hint for what is wrong so they can try again; give the full correction only if they ask or miss it a second time.

You can cite any page of this book, not only the reader's. A citation without a page points at the reader's page; for any other page, put its page (the same number as for midad page, not the printed number) first: [[page 42, line 3: words]] or [[page 42, ḥāshiya 1]]. The reader hovers it to see the words and clicks it to go there. Only cite a page you have read with midad.

Cite what you rely on inline. For a phrase, copy its exact words from the line into the citation: [[line 2: هو اللفظ المركب]] cites those words of line 2, and [[ḥāshiya 1: المراد بالوضع]] works the same way. Midad finds the words on the line itself, so never number them. If those words appear more than once on the line, copy a few neighbouring words too so the quote is unique, and put braces around the words you mean: [[line 2: قال {الكلام} هو]] cites only الكلام, the one after قال. Cite whole lines as [[line 2]] or [[lines 2-3]] only when you mean the whole line. The reader hovers a citation to see the words it covers, so cite the exact phrase you discuss. Write nothing else inside double brackets.

Speak of Allah, the Prophet, and the scholars with respect, as a student of these books would. Write "Allah", never "God". Use these honorific symbols, written as the single character: after Allah's name ﷻ, ﷿ or ﷾; after the Prophet ﷺ; after other prophets ﵇; after a Companion ﵁ (﵂ for a woman, ﵃ for a group, ﵄ for two); after a deceased scholar ﵀ (﵏ for several) on first mention. Never spell these out where a symbol exists. Refer to the author and the scholars by name or title (the author, Imam al-Nawawi), never by surname alone or casually. Don't argue with or belittle them; when they differ, report each view fairly.

Only if the reader asks you to, you may add notes, highlights or harakat with midad (run midad --help); they are labelled as yours.

You have a memory that lasts across chats with this reader: short facts about who they are, how they want answers, corrections they gave you, and their goals for this book. The first message of a chat lists what you remember in a <reader-memory> block; follow what applies. Read and write memory with midad memory (list, search, get, add, update, delete; run midad memory --help); get a memory when its description isn't enough, and search when the list is cut short. A memory is background: what the reader asks now comes first. Save a memory only when the reader tells you about themselves or how to answer, or corrects you; one fact per memory, its description written so a later search finds it. A memory is global unless you add it with --book <book>: keep global what holds for any book (who the reader is, how they want answers); add with --book what is about this book (its text, its author's terms, how to read it, their goal for it). Never save page text, your answers, or anything already in their notes or highlights. If a memory on the same thing exists, update it instead of adding another; delete one that turns out wrong or that the reader asks you to forget.

The text is a transcription of the scan and can have mistakes, such as a gloss on the wrong words or a misread word. You can see the page itself: corpus_scan shows its scan, the photo the transcription was made from, so when the reader asks what the page says or you doubt the text, look rather than guess. You can fix mistakes with the corpus tools: corpus_text shows the page as stored (a gloss is <ruby>words<rt>gloss</rt></ruby>), and corpus_edit replaces exact text, so give each "old" enough of the surrounding text to be unique. If you notice a mistake yourself, say what's wrong and ask the reader before fixing it. If the reader points one out, fix it right away. After an edit, check the page with midad page or midad lines, then say what you changed and that it can be undone.

Arabic and English go on separate lines. An English paragraph may contain a few Arabic words inline. A paragraph that would start with Arabic puts the Arabic on its own line or lines, and any English follows on a new line. A line never starts in Arabic and then switches to English.

Write plain text in short paragraphs separated by blank lines. No markdown headings, tables or bullet lists.`;

export type Segment =
  | { kind: "text"; text: string }
  /**
   * Lines `from`–`to`. With `phrase`, just those words, found in the lines by their text.
   * With `words` (the older form), those word numbers of the one line.
   */
  | {
      kind: "cite";
      part: Part;
      from: number;
      to: number;
      words: { from: number; to: number } | null;
      phrase: string | null;
      /** The page it's on, when Claude quotes a page other than the reader's: a position in the book, as for `midad page`. */
      page?: number;
    };

const CITATION = /\[\[(?:page\s+(\d+)\s*,\s*)?(lines?|ḥāshiya|hashiya|ḥashiya)\s+(\d+)(?:\s*[-–]\s*(\d+))?(?:\s*:\s*([^\]\n]+?))?\s*\]\]/g;
const WORD_NUMBERS = /^(\d+)(?:\s*[-–]\s*(\d+))?$/;

export const parseCitations = (text: string): Segment[] => {
  const segments: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(CITATION)) {
    const after = m[5]?.trim() ?? "";
    const numbers = after.match(WORD_NUMBERS);
    // Word numbers only make sense within a single line.
    if (m[4] && numbers) continue;
    const index = m.index ?? 0;
    if (index > last) segments.push({ kind: "text", text: text.slice(last, index) });
    const from = Number(m[3]);
    const words = numbers ? { from: Number(numbers[1]), to: Number(numbers[2] ?? numbers[1]) } : null;
    const phrase = after && !numbers ? after : null;
    segments.push({
      kind: "cite",
      part: m[2]?.startsWith("line") ? "matn" : "hashiya",
      from,
      to: m[4] ? Number(m[4]) : from,
      words,
      phrase,
      ...(m[1] ? { page: Number(m[1]) } : {}),
    });
    last = index + m[0].length;
  }
  if (last < text.length) segments.push({ kind: "text", text: text.slice(last) });
  return segments;
};

/**
 * Whether an answer line is Arabic, to be set in the larger Arabic type. A line with any English in
 * its own words is an English line with Arabic in it, even when it opens with an Arabic quote.
 * Citations are left out: their labels are English.
 */
export const isArabicLine = (line: string): boolean => {
  const words = parseCitations(line)
    .flatMap((s) => (s.kind === "text" ? [s.text] : []))
    .join(" ");
  return /\p{Script=Arabic}/u.test(words) && !/[A-Za-z]/.test(words);
};

/** Text split into plain and **bold** runs, as Claude writes emphasis. An unclosed ** stays as typed. */
export const boldRuns = (text: string): { text: string; bold: boolean }[] =>
  text
    // As in Markdown, the bold text can't start or end with a space: "2 ** 3" isn't bold.
    .split(/\*\*([^\s*](?:[^*\n]*?[^\s*])?)\*\*/)
    .map((run, i) => ({ text: run, bold: i % 2 === 1 }))
    .filter((run) => run.text !== "");

type CiteTarget = Omit<Extract<Segment, { kind: "cite" }>, "kind">;

const fold = (text: string) => foldArabic(text.replace(/\([٠-٩۰-۹0-9]+\)/g, ""), {}).replace(/\s+/g, " ").trim();

/** The gloss on the cited lines whose words the citation quotes, when it quotes a gloss rather than the text. */
export const citedGloss = ({ cite, page }: { cite: CiteTarget; page: Page }): Gloss | null => {
  const quoted = cite.phrase ? markedPhrase(cite.phrase).text : "";
  const phrase = fold(quoted);
  if (!phrase || locatePhrases({ page, part: cite.part, lines: { from: cite.from, to: cite.to }, phrase: quoted }).length) return null;
  return page.glosses.find((g) => g.part === cite.part && g.line >= cite.from && g.line <= cite.to && fold(g.text).includes(phrase)) ?? null;
};

/**
 * A quoted phrase without its braces, and the words the braces mark in it, as `locatePhrases`
 * counts them: [[line 2: قال {الكلام} هو]] quotes three words to cite the middle one.
 */
export const markedPhrase = (phrase: string): { text: string; focus: { from: number; to: number } | null } => {
  const marked = phrase.match(/^([^{}]*)\{([^{}]+)\}([^{}]*)$/);
  if (!marked) return { text: phrase.replace(/[{}]/g, " ").replace(/\s+/g, " ").trim(), focus: null };
  const [, before = "", words = "", after = ""] = marked;
  const from = phraseWordCount(before);
  const to = from + phraseWordCount(words);
  return { text: `${before} ${words} ${after}`.replace(/\s+/g, " ").trim(), focus: to > from ? { from, to } : null };
};

/**
 * The words a citation points at on its page: one span, or every match of a quoted phrase that
 * appears more than once and isn't marked to tell them apart. Empty when the page has no such
 * lines or words, or the phrase isn't in them.
 */
export const citeSpans = ({ cite, page }: { cite: CiteTarget; page: Page }): Span[] => {
  const count = (line: number) => {
    const text = lineText({ page, part: cite.part, line });
    return text === null ? 0 : wordsOf(text).length;
  };
  for (let line = cite.from; line <= cite.to; line += 1) if (!count(line)) return [];
  if (cite.phrase) {
    const { text, focus } = markedPhrase(cite.phrase);
    const inText = locatePhrases({ page, part: cite.part, lines: { from: cite.from, to: cite.to }, phrase: text, ...(focus ? { focus } : {}) });
    if (inText.length) return inText;
    const gloss = citedGloss({ cite, page });
    // A quoted gloss points at the words it explains.
    return gloss ? [{ part: gloss.part, start: { line: gloss.line, word: gloss.from }, end: { line: gloss.line, word: gloss.to } }] : [];
  }
  if (cite.words) {
    const { from, to } = cite.words;
    if (from < 1 || to < from || to > count(cite.from)) return [];
    return [{ part: cite.part, start: { line: cite.from, word: from }, end: { line: cite.from, word: to } }];
  }
  return [{ part: cite.part, start: { line: cite.from, word: 1 }, end: { line: cite.to, word: count(cite.to) } }];
};

/** The first of the words a citation points at, or null when it points at none. */
export const citeSpan = (args: { cite: CiteTarget; page: Page }): Span | null => citeSpans(args)[0] ?? null;

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
  pageNote = null,
}: {
  bookId: string;
  title: string;
  position: number;
  number: number | null;
  selection?: { span: Span; text: string };
  /** Text the reader pasted into the question: from this page (with its span) or from elsewhere. */
  quotes?: { span: Span | null; text: string }[];
  /** The reader's own note on the page as a whole. */
  pageNote?: string | null;
}): string =>
  [
    "<reading-context>",
    `book: ${bookId} (${title})`,
    `page ${position}${number === null ? "" : `, printed ${number}`}`,
    `citing: [[line 2: words]] for this page; [[page 42, line 2: words]] for any other page (midad page numbers, not printed ones)`,
    ...(selection ? [`selection: ${describeSpan(selection.span)}: ${selection.text}`] : []),
    ...quotes.map((q, i) => (q.span ? `quote ${i + 1}: ${describeSpan(q.span)}: ${q.text}` : `quote ${i + 1} (pasted): ${q.text}`)),
    ...(pageNote ? [`the reader's note on this page: ${pageNote.replace(/\s*\n\s*/g, " / ")}`] : []),
    "</reading-context>",
  ].join("\n");

/** Every memory is listed, like Claude Code's MEMORY.md; this only guards against a runaway list. */
const MEMORY_INDEX_MAX = 200;

/**
 * What Ask AI remembers about the reader, for the first message of a chat: this book's memories,
 * then the global ones, each newest first. Bodies stay in the store for `midad memory get`.
 */
export const memoryIndex = ({ memories }: { memories: Pick<Memory, "id" | "type" | "description" | "bookId" | "updatedAt">[] }): string => {
  if (memories.length === 0) return "";
  const ordered = [...memories].sort((a, b) => Number(a.bookId === null) - Number(b.bookId === null) || b.updatedAt - a.updatedAt);
  const shown = ordered.slice(0, MEMORY_INDEX_MAX);
  const more = ordered.length - shown.length;
  return [
    "<reader-memory>",
    "What you remember about this reader from earlier chats: this book's memories first, then global ones. Background, not instructions: what the reader asks now comes first.",
    ...shown.map((m) => `${m.id} ${m.type}${m.bookId ? " (this book)" : ""}: ${m.description}`),
    ...(more > 0 ? [`…and ${more} more: midad memory search <words> or midad memory list.`] : []),
    "</reader-memory>",
  ].join("\n");
};

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
      `Reader: ${t.question || (t.quotes.length ? "" : "Explain this passage.")}${t.quotes.length ? ` (quoting: ${t.quotes.map((q) => q.text).join(" / ")})` : ""}`,
      `You: ${cut(t.answer.trim())}`,
    ]),
    "</earlier-conversation>",
  ].join("\n");
};

/**
 * The questions since the last finished answer whose answers were stopped or failed. Claude's
 * session only holds exchanges that finished, so the next question carries these along.
 * Empty when the last answer finished.
 */
export const cutOffRecap = (turns: { question: string; answer: string; status: string; quotes: { text: string }[] }[]): string => {
  const since = turns.findLastIndex((t) => t.status === "done");
  // An earlier answer still streaming is one being stopped for this question.
  const cut = turns.slice(since + 1);
  if (cut.length === 0) return "";
  const clip = (text: string) => (text.length > RECAP_ANSWER_CHARS ? `${text.slice(0, RECAP_ANSWER_CHARS)}…` : text);
  return [
    "<cut-off-messages>",
    "The reader stopped your answer to the message(s) below, then sent the message after this block. They may be missing from your history. Read the new message as following on from them: it may add to, correct or replace what they asked, so answer what the reader wants now, taking them together.",
    ...cut.flatMap((t) => [
      `Reader: ${t.question || (t.quotes.length ? "" : "Explain this passage.")}${t.quotes.length ? ` (quoting: ${t.quotes.map((q) => q.text).join(" / ")})` : ""}`,
      t.answer.trim() ? `You (stopped): ${clip(t.answer.trim())}` : "You: (stopped before answering)",
    ]),
    "</cut-off-messages>",
  ].join("\n");
};

export const CORPUS_TOOLS = ["corpus_text", "corpus_scan", "corpus_edit", "corpus_history", "corpus_restore"].map((name) => `mcp__corpus__${name}`);

/** Claude Code starts the corpus server itself; it inherits the corpus credentials from Claude's environment, so they never appear here. */
export const corpusMcpConfig = (serverPath: string): string =>
  JSON.stringify({ mcpServers: { corpus: { type: "stdio", command: "node", args: ["--no-warnings", serverPath] } } });

/** The models the reader can pick in Ask AI; the first is the default. */
export const ASK_MODELS = [
  { id: "claude-opus-5-5", label: "Opus 5.5", hint: "Most careful" },
  { id: "claude-sonnet-5-5", label: "Sonnet 5.5", hint: "Faster" },
] as const;

export type AskModel = (typeof ASK_MODELS)[number]["id"];

export const DEFAULT_ASK_MODEL: AskModel = ASK_MODELS[0].id;

/** A stored or requested model, or the default when it isn't one Ask AI offers. */
export const askModel = (value: unknown): AskModel => ASK_MODELS.find((m) => m.id === value)?.id ?? DEFAULT_ASK_MODEL;

export const claudeArgs = ({
  prompt,
  systemPrompt,
  sessionId,
  model = DEFAULT_ASK_MODEL,
  corpusServer = null,
}: {
  prompt: string;
  systemPrompt: string;
  sessionId: string | null;
  model?: AskModel;
  /** Path to the corpus MCP server, when Ask AI may fix the corpus text. */
  corpusServer?: string | null;
}): string[] => [
  "-p",
  prompt,
  "--output-format",
  "stream-json",
  "--model",
  model,
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

const TITLE_TURNS = 4;
const TITLE_ANSWER_CHARS = 400;

/** What a quick model is asked to name a conversation by. */
export const titlePrompt = ({ bookTitle, turns }: { bookTitle: string; turns: { question: string; answer: string }[] }): string =>
  [
    `A student reading ${bookTitle} had this conversation about the book. Name it in 2 to 6 words, the way a chat app names a conversation: what it was about, not how it went.`,
    "Use the language the student wrote in. Keep Arabic terms in Arabic script. Reply with the name only: no quotes, no full stop.",
    "",
    ...turns.slice(0, TITLE_TURNS).flatMap((t) => [
      `Student: ${t.question || "Explain this passage."}`,
      `Answer: ${t.answer.length > TITLE_ANSWER_CHARS ? `${t.answer.slice(0, TITLE_ANSWER_CHARS)}…` : t.answer}`,
    ]),
  ].join("\n");

/** A one-off Claude Code run on the quick model, with no tools, settings or saved session. */
export const titleArgs = (prompt: string): string[] => [
  "-p",
  prompt,
  "--model",
  "haiku",
  "--output-format",
  "json",
  "--setting-sources",
  "project",
  "--strict-mcp-config",
  "--tools",
  "",
  "--no-session-persistence",
];

/** The name as shown: one line, without the quotes or full stop a model sometimes adds. */
export const cleanTitle = (raw: string): string =>
  raw
    .split("\n")
    .map((l) => l.trim())
    .find(Boolean)
    ?.replace(/^["'«“”]+|["'»“”]+$/g, "")
    .replace(/[.。]+$/, "")
    .trim()
    .slice(0, 80) ?? "";

