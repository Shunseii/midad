// Harakat and tanwin (U+064B–U+0652) plus superscript alef (U+0670).
// Built from code points: a literal character class of combining marks is easy
// for an editor or formatter to corrupt.
const HARAKAT = new RegExp(`[${String.fromCodePoint(0x064b)}-${String.fromCodePoint(0x0652)}${String.fromCodePoint(0x0670)}]`, "g");

export const stripHarakat = (text: string): string => text.replace(HARAKAT, "");
