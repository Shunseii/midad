/**
 * Parses one corpus page (the markdown the arabic-digitization OCR produces)
 * into what Midad shows: the running header, the matn, and the ḥāshiya.
 *
 * Interlinear glosses (`<ruby>base<rt>gloss</rt></ruby>`) keep only the base.
 * Highlights, notes, harakat and AI citations all address this cleaned text,
 * so the parser is the single source of truth for line numbers and offsets.
 */

export type MatnBlock =
  | { kind: "heading"; level: number; text: string; line: number }
  | { kind: "paragraph"; text: string; line: number };

export interface Footnote {
  /** The footnote number as printed (e.g. "١"), or null for unmarked text. */
  marker: string | null;
  text: string;
}

export interface Page {
  header: string | null;
  matn: MatnBlock[];
  hashiya: Footnote[];
}

const RUBY = /<ruby>([\s\S]*?)<rt>[\s\S]*?<\/rt><\/ruby>/g;
const BR = /<br\s*\/?>/gi;
const SUPERSCRIPT = /\$\^\{?([^$}]*)\}?\$/g;
const HEADING = /^(#{1,6})\s+(.+)$/;
const DIVIDER = "---";
const HASHIYA_TITLE = "الحاشية";
const FOOTNOTE_MARKER = /(?:^|\s)\(([٠-٩0-9]+)\)\s*/g;

const clean = (text: string): string =>
  text.replace(RUBY, "$1").replace(BR, "\n").replace(SUPERSCRIPT, "$1").trim();

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
  return { header: clean(before[0] ?? ""), body: lines.slice(dividerAt + 1) };
};

const parseFootnotes = (raw: string): Footnote[] => {
  const text = clean(raw);
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
  for (const raw of matnLines) {
    const line = raw.trim();
    if (!line || line === DIVIDER) continue;
    const heading = line.match(HEADING);
    const number = matn.length + 1;
    if (heading) {
      matn.push({ kind: "heading", level: heading[1]?.length ?? 2, text: clean(heading[2] ?? ""), line: number });
    } else {
      matn.push({ kind: "paragraph", text: clean(line), line: number });
    }
  }

  const hashiya = parseFootnotes(
    hashiyaLines.filter((l) => l.trim() && l.trim() !== DIVIDER).join("\n"),
  );

  return { header, matn, hashiya };
};
