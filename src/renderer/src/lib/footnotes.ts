/** Persian digits (۱۲۳), which the OCR sometimes uses, as the Arabic-Indic digits (١٢٣) the rest of the page uses. */
export const toArabicIndic = (digits: string): string => digits.replace(/[۰-۹]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0x06f0 + 0x0660));

/** Footnote text by marker. Entries without a marker continue the one before them. */
export const footnotesByMarker = (entries: { marker: string | null; text: string }[]): Map<string, string> => {
  const byMarker = new Map<string, string>();
  let current: string | null = null;
  for (const { marker, text } of entries) {
    if (marker) current = toArabicIndic(marker);
    if (current === null) continue;
    const before = byMarker.get(current);
    byMarker.set(current, before ? `${before} ${text}` : text);
  }
  return byMarker;
};

/** A footnote reference written into the text, such as (١). */
export const FOOTNOTE_REF = /\(([٠-٩۰-۹0-9]+)\)/;

/** Splits text around its first footnote reference; null when it has none. */
export const splitFootnoteRef = (text: string): { before: string; marker: string; after: string } | null => {
  const match = FOOTNOTE_REF.exec(text);
  if (!match?.[1]) return null;
  return { before: text.slice(0, match.index), marker: toArabicIndic(match[1]), after: text.slice(match.index + match[0].length) };
};
