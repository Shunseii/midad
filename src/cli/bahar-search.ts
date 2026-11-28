/**
 * Searching the reader's Bahar dictionary without minding harakat or the alef's hamza. One list of
 * character folds drives both the query's normalizer (in JS) and the column's (a nested SQL
 * replace()), so the two can't drift apart.
 */

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

const ALEF = 0x0627;

/** [character, replacement] by code point; null drops the character. */
const STRICT_FOLDS: ReadonlyArray<readonly [number, number | null]> = [
  // Harakat and tanwin, maddah and hamza above/below, tatweel, superscript alef.
  ...range(0x064b, 0x0655).map((c) => [c, null] as const),
  [0x0640, null],
  [0x0670, null],
  // أ إ آ ٱ are all alef. ى stays: على and علي are different words.
  ...[0x0623, 0x0625, 0x0622, 0x0671].map((c) => [c, ALEF] as const),
];

/** ة read as ه too: matches that need it rank below ones that don't. */
const LOOSE_FOLDS: ReadonlyArray<readonly [number, number | null]> = [...STRICT_FOLDS, [0x0629, 0x0647]];

const foldWith = (folds: ReadonlyArray<readonly [number, number | null]>) => {
  const map = new Map(folds.map(([from, to]) => [String.fromCodePoint(from), to === null ? "" : String.fromCodePoint(to)]));
  return (text: string) => [...text].map((ch) => map.get(ch) ?? ch).join("");
};

export const normalizeArabic = foldWith(STRICT_FOLDS);
export const normalizeArabicLoose = foldWith(LOOSE_FOLDS);

const sqlFold = ({ folds, column }: { folds: ReadonlyArray<readonly [number, number | null]>; column: string }) =>
  folds.reduce((sql, [from, to]) => `replace(${sql}, char(${from}), ${to === null ? "''" : `char(${to})`})`, column);

export const normalizedSql = (column: string) => sqlFold({ folds: STRICT_FOLDS, column });
export const normalizedLooseSql = (column: string) => sqlFold({ folds: LOOSE_FOLDS, column });

export const DEFAULT_LIMIT = 10;
export const MAX_LIMIT = 50;

export interface BaharEntry {
  id: string;
  word: string;
  translation: string;
  type: string | null;
  root: string[];
  tags: string[];
  definition: string | null;
}

const OPTIONAL_COLUMNS = ["type", "root", "tags", "definition"] as const;
type OptionalColumn = (typeof OPTIONAL_COLUMNS)[number];

/**
 * The one SELECT search runs, for the columns the table has. Parameters: ?1 the query folded
 * strictly, ?2 folded loosely, ?3 lower-cased as typed, ?4 its letters for a root, ?5 the limit.
 * Ranks exact matches, then prefixes, then substrings; within each, the word before the root
 * and the translation, and strict folding before loose.
 */
export const searchSql = (columns: ReadonlySet<string>): string => {
  const has = (c: OptionalColumn) => columns.has(c);
  const strict = normalizedSql("word");
  const loose = normalizedLooseSql("word");
  const translation = "lower(translation)";
  const like = (expr: string, pattern: string) => `${expr} LIKE ${pattern} ESCAPE '\\'`;
  const escaped = (n: number) => `replace(replace(replace(?${n}, '\\', '\\\\'), '%', '\\%'), '_', '\\_')`;
  const prefix = (n: number) => `${escaped(n)} || '%'`;
  const substring = (n: number) => `'%' || ${escaped(n)} || '%'`;
  const rootMatch = has("root")
    ? `(?4 <> '' AND json_valid(entry.root) AND json_type(entry.root) = 'array' AND (SELECT group_concat(${normalizedSql("value")}, '') FROM json_each(entry.root)) = ?4)`
    : "0";
  const tiers = [
    `${strict} = ?1`,
    `${loose} = ?2`,
    rootMatch,
    `${translation} = ?3`,
    like(strict, prefix(1)),
    like(loose, prefix(2)),
    like(translation, prefix(3)),
    like(strict, substring(1)),
    like(loose, substring(2)),
    like(translation, substring(3)),
  ];
  const rank = `CASE ${tiers.map((t, i) => `WHEN ${t} THEN ${i}`).join(" ")} END`;
  const select = ["id", "word", "translation", ...OPTIONAL_COLUMNS.map((c) => (has(c) ? c : `NULL AS ${c}`))].join(", ");
  return `SELECT ${select}, rank FROM (SELECT *, ${rank} AS rank FROM dictionary_entries AS entry) WHERE rank IS NOT NULL ORDER BY rank, length(${strict}), word LIMIT ?5`;
};

/** The parameters for searchSql, or null when the query has nothing to search for. */
export const searchArgs = ({ query, limit }: { query: string; limit: number }): (string | number)[] | null => {
  const trimmed = query.trim();
  const strict = normalizeArabic(trimmed);
  if (!strict.trim()) return null;
  const letters = [...strict].filter((ch) => /\p{Script=Arabic}/u.test(ch) && /\p{L}/u.test(ch)).join("");
  const rootLetters = letters.length >= 2 && letters.length <= 5 && !/[^\p{Script=Arabic}\s\-،,]/u.test(strict) ? letters : "";
  return [strict, normalizeArabicLoose(trimmed), trimmed.toLowerCase(), rootLetters, limit];
};

const jsonList = (value: unknown): string[] => {
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return typeof parsed === "string" ? [parsed] : [];
    return parsed.flatMap((item: unknown) => {
      if (typeof item === "string") return [item];
      if (item && typeof item === "object" && "name" in item && typeof item.name === "string") return [item.name];
      return [];
    });
  } catch {
    return [value];
  }
};

const text = (value: unknown) => (value === null || value === undefined ? null : String(value));

export const toEntry = (row: Record<string, unknown>): BaharEntry => ({
  id: String(row.id ?? ""),
  word: String(row.word ?? ""),
  translation: String(row.translation ?? ""),
  type: text(row.type),
  root: jsonList(row.root),
  tags: jsonList(row.tags),
  definition: text(row.definition),
});

export const formatEntries = (entries: BaharEntry[]): string =>
  entries.length === 0
    ? "No matches in the reader's Bahar dictionary.\n"
    : `${entries
        .map((e) =>
          [
            `${e.word} — ${e.translation}`,
            ...(e.type ? [e.type] : []),
            ...(e.root.length ? [`root ${e.root.join("-")}`] : []),
            ...(e.tags.length ? [`tags ${e.tags.join(", ")}`] : []),
            `id ${e.id}`,
          ].join(" · "),
        )
        .join("\n")}\n`;
