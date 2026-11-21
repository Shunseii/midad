// Built from code points: a literal character class of combining marks is easy
// for an editor or formatter to corrupt.
const cp = (n: number) => String.fromCodePoint(n);
const range = (from: number, to: number) => `${cp(from)}-${cp(to)}`;

/** Harakat and tanwin (U+064B–U+0652) plus superscript alef (U+0670). */
const HARAKAT = new RegExp(`[${range(0x064b, 0x0652)}${cp(0x0670)}]`, "g");

/**
 * Marks that never change which word it is: maddah and hamza above or below
 * (U+0653–U+0655), Quranic annotation marks, tatweel and the invisible joiners
 * and direction marks.
 */
const SILENT = new RegExp(`[${range(0x0653, 0x0655)}${range(0x06d6, 0x06ed)}${cp(0x0640)}${range(0x200c, 0x200f)}]`, "g");

const PUNCTUATION = /\p{P}/gu;

const LETTER_FOLDS: Record<string, string> = {
  "أ": "ا",
  "إ": "ا",
  "آ": "ا",
  "ٱ": "ا",
  "ٲ": "ا",
  "ٳ": "ا",
  "ى": "ي",
  "ی": "ي",
  "ئ": "ي",
  "ؤ": "و",
  "ک": "ك",
};
const TA_MARBUTA = "ة";

const DIGIT = /[٠-٩۰-۹]/g;
const asciiDigit = (d: string) => String((d.codePointAt(0) ?? 0) % 16);

export const stripHarakat = (text: string): string => text.replace(HARAKAT, "");

export interface FoldOptions {
  /** Keep harakat, for matching vowels exactly. */
  keepHarakat?: boolean;
  /** Read ة as ه, so either spelling matches. On by default. */
  foldTaMarbuta?: boolean;
}

/**
 * Arabic text reduced to what tells words apart when searching: no harakat,
 * tatweel or punctuation; one alef, one ya; hamza seats folded to their
 * letter; Arabic-Indic and Persian digits as ASCII. Whitespace is kept as is.
 */
export const foldArabic = (text: string, { keepHarakat = false, foldTaMarbuta = true }: FoldOptions = {}): string => {
  let out = text.replace(SILENT, "").replace(PUNCTUATION, "").replace(DIGIT, asciiDigit);
  if (!keepHarakat) out = stripHarakat(out);
  let folded = "";
  for (const ch of out) folded += ch === TA_MARBUTA ? (foldTaMarbuta ? "ه" : ch) : (LETTER_FOLDS[ch] ?? ch);
  return folded;
};
