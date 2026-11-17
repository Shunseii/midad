/**
 * The reader's own harakat. They're stored per letter (line, word, letter) and
 * never written into the corpus text. On a letter that already has corpus
 * marks, the reader's mark replaces the corpus mark of the same kind: a
 * shadda replaces a shadda, a vowel (or tanwin, sukun, dagger alef) replaces a
 * vowel. So a reader's kasra on a corpus shadda-fatha shows shadda-kasra.
 */

const cp = (n: number) => String.fromCodePoint(n);

export const MARK = {
  fathatan: cp(0x064b),
  dammatan: cp(0x064c),
  kasratan: cp(0x064d),
  fatha: cp(0x064e),
  damma: cp(0x064f),
  kasra: cp(0x0650),
  shadda: cp(0x0651),
  sukun: cp(0x0652),
  daggerAlef: cp(0x0670),
} as const;

export type MarkName = keyof typeof MARK;

const ALL_MARKS = new Set<string>(Object.values(MARK));

export const isMark = (ch: string): boolean => ALL_MARKS.has(ch);

const isShadda = (ch: string) => ch === MARK.shadda;

export interface Letter {
  base: string;
  /** The marks that follow the base letter, as written. */
  marks: string;
}

/** Splits a word into base letters, each with the marks written after it. Marks before any letter are dropped. */
export const lettersOf = (word: string): Letter[] => {
  const letters: Letter[] = [];
  for (const ch of word) {
    const last = letters[letters.length - 1];
    if (isMark(ch)) {
      if (last) last.marks += ch;
    } else {
      letters.push({ base: ch, marks: "" });
    }
  }
  return letters;
};

/** Shadda first, then at most one vowel. Throws on anything that isn't a single valid combination of marks. */
export const normalizeMarks = (marks: string): string => {
  const chars = [...marks];
  if (chars.length === 0) throw new Error("No harakat given.");
  const bad = chars.find((c) => !isMark(c));
  if (bad) throw new Error(`"${bad}" (U+${bad.codePointAt(0)?.toString(16).toUpperCase()}) isn't a haraka.`);
  const shaddas = chars.filter(isShadda);
  const vowels = chars.filter((c) => !isShadda(c));
  if (shaddas.length > 1 || vowels.length > 1) throw new Error("A letter takes at most one shadda and one vowel.");
  return shaddas.join("") + vowels.join("");
};

/** What typing `typed` on a letter that already has the reader's `existing` marks leaves. Shadda toggles; a vowel replaces the vowel. */
export const mergeMarks = ({ existing, typed }: { existing: string; typed: string }): string => {
  const chars = [...existing];
  const hasShadda = chars.some(isShadda);
  const vowel = chars.find((c) => !isShadda(c)) ?? "";
  if (isShadda(typed)) return (hasShadda ? "" : MARK.shadda) + vowel;
  return (hasShadda ? MARK.shadda : "") + (vowel === typed ? "" : typed);
};

/** Splits a letter's marks for display: corpus marks the reader hasn't replaced, and the reader's own. */
export const displayMarks = ({ corpus, mine }: { corpus: string; mine: string }): { corpus: string; mine: string } => {
  const mineHasShadda = [...mine].some(isShadda);
  const mineHasVowel = [...mine].some((c) => !isShadda(c));
  const kept = [...corpus].filter((c) => (isShadda(c) ? !mineHasShadda : !mineHasVowel)).join("");
  return { corpus: kept, mine };
};

const ZWJ = String.fromCodePoint(0x200d);

// Letters that join only to the letter before them (Unicode joining type R), and ones that never join (U).
const JOINS_BEFORE_ONLY = new Set([..."اأإآٱدذرزوؤة"]);
const NEVER_JOINS = new Set([..."ء"]);

const joinsBefore = (ch: string | undefined) => ch !== undefined && !NEVER_JOINS.has(ch) && /\p{Script=Arabic}/u.test(ch) && !isMark(ch);
const joinsAfter = (ch: string | undefined) => joinsBefore(ch) && !JOINS_BEFORE_ONLY.has(ch ?? "");

/**
 * The letter in the shape it has inside its word, as a standalone string:
 * zero-width joiners stand in for the neighbours it connects to.
 */
export const inContext = ({ letters, index }: { letters: Letter[]; index: number }): { before: string; after: string } => {
  const self = letters[index]?.base;
  return {
    before: joinsAfter(letters[index - 1]?.base) && joinsBefore(self) ? ZWJ : "",
    after: joinsAfter(self) && joinsBefore(letters[index + 1]?.base) ? ZWJ : "",
  };
};

/**
 * Physical keys of the Arabic (101) layout, for typing harakat when the OS
 * layout isn't Arabic. All are shifted.
 */
const SHIFTED_CODES: Record<string, string> = {
  KeyQ: MARK.fatha,
  KeyW: MARK.fathatan,
  KeyE: MARK.damma,
  KeyR: MARK.dammatan,
  KeyA: MARK.kasra,
  KeyS: MARK.kasratan,
  KeyX: MARK.sukun,
  Backquote: MARK.shadda,
};

/** The haraka a key press types, from the Arabic layout's character or, failing that, the physical key. */
export const markFromKey = ({ key, code, shiftKey }: { key: string; code: string; shiftKey: boolean }): string | null => {
  if (isMark(key)) return key;
  return shiftKey ? (SHIFTED_CODES[code] ?? null) : null;
};
