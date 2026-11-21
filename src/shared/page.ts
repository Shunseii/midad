/**
 * Parses one corpus page (the markdown the arabic-digitization OCR produces)
 * into what Midad shows: the running header, the matn, and the ḥāshiya.
 *
 * Interlinear glosses (`<ruby>base<rt>gloss</rt></ruby>`) leave their base in
 * the text and attach the gloss to the base's words. Highlights, notes, harakat
 * and AI citations all address this cleaned text, so the parser is the single
 * source of truth for line numbers and word offsets.
 */

export type MatnBlock =
  | { kind: "heading"; level: number; text: string; line: number }
  | { kind: "paragraph"; text: string; line: number };

export interface Footnote {
  /** The footnote number as printed (e.g. "١"), or null for unmarked text. */
  marker: string | null;
  text: string;
}

/**
 * An interlinear gloss on words `from`–`to` of one line (1-based, inclusive).
 * `line` counts like annotation spans: the matn line number, or the footnote's
 * 1-based index in the ḥāshiya. A gloss whose base was lost sits on the word before it.
 */
export interface Gloss {
  part: "matn" | "hashiya";
  line: number;
  from: number;
  to: number;
  text: string;
}

export interface Page {
  header: string | null;
  matn: MatnBlock[];
  hashiya: Footnote[];
  glosses: Gloss[];
}

/** Private-use characters standing in for a gloss's base until its words are counted. */
const BASE_START = "\uE000";
const BASE_END = "\uE001";
const ANCHOR = /[\uE000\uE001]/g;

/** Any HTML-ish tag, or a ruby tag the OCR cut off at the end of a line. */
const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^<>\n]*?(\/?)>|<\/?(?:ruby|rt|rp|rb)\b[^<>\n]*$/g;
const SUPERSCRIPT = /\$\^\{?([^$}]*)\}?\$/g;
const HEADING = /^(#{1,6})\s+(.+)$/;
const DIVIDER = "---";
const HASHIYA_TITLE = "الحاشية";
const FOOTNOTE_MARKER = /(?:^|\s)\(([٠-٩0-9]+)\)\s*/g;

/** One line with each gloss's base wrapped in anchors, and the glosses in the same order. */
interface Anchored {
  text: string;
  glosses: string[];
}

/**
 * Reads the OCR's ruby markup on one line. Well-formed glosses get anchors; markup the
 * OCR broke (a ruby without a gloss, a stray closing tag) falls back to plain text, and
 * no tag ever reaches the text. A gloss left open runs to the end of the line.
 */
const anchorGlosses = (line: string): Anchored => {
  let out = "";
  let gloss = "";
  let baseAt = -1;
  let state = "text" as "text" | "base" | "gloss" | "after";
  const glosses: string[] = [];

  const dropBase = () => {
    out = out.slice(0, baseAt) + out.slice(baseAt + 1);
    state = "text";
  };
  const openBase = () => {
    baseAt = out.length;
    out += BASE_START;
    state = "base";
  };
  const openGloss = () => {
    out += BASE_END;
    gloss = "";
    state = "gloss";
  };
  const closeGloss = () => {
    const text = gloss.replace(/[^\S\n]+/g, " ").replace(/ ?\n ?/g, "\n").trim();
    if (text) glosses.push(text);
    // An empty gloss leaves its base as plain text; the end anchor is the last thing written.
    else out = out.slice(0, baseAt) + out.slice(baseAt + 1, -1);
    state = "after";
  };
  const write = (text: string) => {
    if (state === "gloss") gloss += text;
    else out += text;
  };

  let last = 0;
  for (const m of line.matchAll(TAG)) {
    write(line.slice(last, m.index));
    last = m.index + m[0].length;
    const closing = m[1] === "/" || m[0].startsWith("</");
    const name = (m[2] ?? m[0].replace(/^<\/?/, "").match(/^[a-zA-Z]+/)?.[0] ?? "").toLowerCase();
    if (name === "br") write("\n");
    if (name === "ruby" && !closing) {
      if (state === "base") dropBase();
      if (state === "gloss") closeGloss();
      openBase();
    } else if (name === "ruby") {
      if (state === "base") dropBase();
      if (state === "gloss") closeGloss();
      state = "text";
    } else if (name === "rt" && m[3] === "/") {
      if (state === "base") dropBase();
    } else if (name === "rt" && !closing) {
      if (state === "base") openGloss();
      else if (state !== "gloss") {
        // A gloss without its <ruby>: anchor it on the word before it.
        baseAt = out.length;
        out += BASE_START;
        openGloss();
      }
    } else if (name === "rt") {
      if (state === "base") dropBase();
      if (state === "gloss") closeGloss();
    }
  }
  write(line.slice(last));
  if (state === "base") dropBase();
  if (state === "gloss") closeGloss();
  return { text: out, glosses };
};

const anchorLines = (text: string): Anchored => {
  const lines = text.split("\n").map(anchorGlosses);
  return { text: lines.map((l) => l.text).join("\n"), glosses: lines.flatMap((l) => l.glosses) };
};

const tidy = (text: string): string => text.replace(SUPERSCRIPT, "$1").trim();

/** A line's text with glosses kept as anchors, for parsing on before the words are counted. */
const clean = (text: string): Anchored => {
  const anchored = anchorLines(text);
  return { text: tidy(anchored.text), glosses: anchored.glosses };
};

const plain = (text: string): string => clean(text).text.replace(ANCHOR, "").trim();

type Placed = Omit<Gloss, "part" | "line">;

/**
 * Takes the anchors out of finished text and turns each into a word range. A base with
 * no words of its own goes on the word before it, or the one after at the start of a line;
 * on a line with no words at all its glosses come back as `orphans`.
 * `pending` is consumed in order, since anchors keep the order of the glosses.
 */
const resolveGlosses = ({ text, pending }: { text: string; pending: string[] }): { text: string; words: number; glosses: Placed[]; orphans: string[] } => {
  let plainText = "";
  const bases: { start: number; end: number }[] = [];
  let start = 0;
  for (const ch of text) {
    if (ch === BASE_START) start = plainText.length;
    else if (ch === BASE_END) bases.push({ start, end: plainText.length });
    else plainText += ch;
  }
  const words = [...plainText.matchAll(/\S+/g)].map((m) => ({ start: m.index, end: m.index + m[0].length }));
  const glosses: Placed[] = [];
  const orphans: string[] = [];
  for (const base of bases) {
    const gloss = pending.shift();
    if (gloss === undefined) continue;
    if (words.length === 0) {
      orphans.push(gloss);
      continue;
    }
    const covered = words.flatMap((w, i) => (w.start < base.end && w.end > base.start ? [i + 1] : []));
    const nearest = Math.max(1, words.filter((w) => w.end <= base.start).length);
    glosses.push({ from: covered[0] ?? nearest, to: covered.at(-1) ?? nearest, text: gloss });
  }
  return { text: plainText.trim(), words: words.length, glosses, orphans };
};

/**
 * Collects glosses line by line. A gloss on a line of its own (the OCR gives some a line
 * with no base) goes on the last word of the line before, or the first word of the next.
 */
const glossCollector = (part: Gloss["part"]) => {
  const glosses: Gloss[] = [];
  let previous: { line: number; words: number } | null = null;
  let waiting: string[] = [];
  return {
    glosses,
    add: ({ line, resolved }: { line: number; resolved: ReturnType<typeof resolveGlosses> }) => {
      if (resolved.words > 0) {
        glosses.push(...waiting.map((text) => ({ part, line, from: 1, to: 1, text })));
        waiting = [];
        glosses.push(...resolved.glosses.map((g) => ({ part, line, ...g })));
        previous = { line, words: resolved.words };
      }
      const last = previous;
      if (last) glosses.push(...resolved.orphans.map((text) => ({ part, line: last.line, from: last.words, to: last.words, text })));
      else waiting.push(...resolved.orphans);
    },
  };
};

const isHashiyaTitle = (line: string): boolean => {
  const heading = line.match(HEADING);
  return heading !== null && heading[2]?.trim() === HASHIYA_TITLE;
};

const splitHeader = (lines: string[]): { header: string | null; body: string[] } => {
  const dividerAt = lines.findIndex((l) => l.trim() === DIVIDER);
  if (dividerAt === -1) return { header: null, body: lines };
  const before = lines.slice(0, dividerAt).filter((l) => l.trim().length > 0);
  const isRunningHeader = before.length === 1 && !isHashiyaTitle(before[0] ?? "");
  if (!isRunningHeader) return { header: null, body: lines };
  return { header: plain(before[0] ?? ""), body: lines.slice(dividerAt + 1) };
};

const parseFootnotes = (text: string): Footnote[] => {
  if (!text) return [];
  const markers = [...text.matchAll(FOOTNOTE_MARKER)];
  if (markers.length === 0) return [{ marker: null, text }];

  const notes: Footnote[] = [];
  const lead = text.slice(0, markers[0]?.index ?? 0).trim();
  if (lead) notes.push({ marker: null, text: lead });
  markers.forEach((match, i) => {
    const start = (match.index ?? 0) + match[0].length;
    const end = markers[i + 1]?.index ?? text.length;
    notes.push({ marker: match[1] ?? null, text: text.slice(start, end).trim() });
  });
  return notes;
};

export const parsePage = (source: string): Page => {
  const { header, body } = splitHeader(source.split(/\r?\n/));

  const hashiyaAt = body.findIndex((l) => isHashiyaTitle(l.trim()));
  const matnLines = hashiyaAt === -1 ? body : body.slice(0, hashiyaAt);
  const hashiyaLines = hashiyaAt === -1 ? [] : body.slice(hashiyaAt + 1);

  const matn: MatnBlock[] = [];
  const matnGlosses = glossCollector("matn");
  for (const raw of matnLines) {
    const line = raw.trim();
    if (!line || line === DIVIDER) continue;
    const heading = line.match(HEADING);
    const number = matn.length + 1;
    const anchored = clean(heading ? (heading[2] ?? "") : line);
    const resolved = resolveGlosses({ text: anchored.text, pending: anchored.glosses });
    matnGlosses.add({ line: number, resolved });
    const { text } = resolved;
    matn.push(heading ? { kind: "heading", level: heading[1]?.length ?? 2, text, line: number } : { kind: "paragraph", text, line: number });
  }

  const anchored = clean(hashiyaLines.filter((l) => l.trim() && l.trim() !== DIVIDER).join("\n"));
  const hashiyaGlosses = glossCollector("hashiya");
  const hashiya = parseFootnotes(anchored.text).map((f, i) => {
    const resolved = resolveGlosses({ text: f.text, pending: anchored.glosses });
    hashiyaGlosses.add({ line: i + 1, resolved });
    return { ...f, text: resolved.text };
  });

  return { header, matn, hashiya, glosses: [...matnGlosses.glosses, ...hashiyaGlosses.glosses] };
};
