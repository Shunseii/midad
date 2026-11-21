import { stripHarakat } from "../../../shared/arabic";

/**
 * The page scrubber's geometry: the whole book as one line, page 1 at the
 * right. Every page owns an equal stretch of the line and its marks sit in the
 * middle of that stretch, so a click anywhere in the stretch lands on the page.
 */

/** Chapter ticks closer than this (in px) are thinned out. */
export const TICK_GAP = 8;
/** Highlight and note dots closer than this (in px) are merged. */
export const DOT_GAP = 6;

/** Where a page's mark sits, as a fraction of the line measured from its right (page 1) end. */
export const pageFraction = ({ position, total }: { position: number; total: number }) => (total > 0 ? (position - 0.5) / total : 0);

/** The page under a point on the line, given as a fraction from the right end. */
export const pageAtFraction = ({ fraction, total }: { fraction: number; total: number }) =>
  Math.min(Math.max(Math.floor(fraction * total) + 1, 1), Math.max(total, 1));

export interface Chapter {
  position: number;
  /** How many pages the chapter runs for, up to the next top-level chapter or the end of the book. */
  pages: number;
}

/** The book's top-level chapters: the contents entries at the shallowest heading level, one per page at most. */
export const topLevelChapters = ({ entries, total }: { entries: { position: number; level: number }[]; total: number }): Chapter[] => {
  if (entries.length === 0) return [];
  const top = Math.min(...entries.map((e) => e.level));
  const starts = [...new Set(entries.filter((e) => e.level === top).map((e) => e.position))].sort((a, b) => a - b);
  return starts.map((position, i) => ({ position, pages: (starts[i + 1] ?? total + 1) - position }));
};

/**
 * Drops marks until no two are closer than `gap` px on a line `width` px long.
 * Heavier marks win a collision (bigger chapters, say); between equals, the
 * earlier page wins. Returns the kept marks in page order.
 */
export const thinMarks = <T extends { position: number }>({
  marks,
  weight,
  total,
  width,
  gap,
}: {
  marks: T[];
  weight: (mark: T) => number;
  total: number;
  width: number;
  gap: number;
}): T[] => {
  const x = (m: T) => pageFraction({ position: m.position, total }) * width;
  const byWeight = [...marks].sort((a, b) => weight(b) - weight(a) || a.position - b.position);
  // Kept marks' x positions, in order, for a binary search of the neighbours either side.
  const kept: { x: number; mark: T }[] = [];
  for (const mark of byWeight) {
    const at = x(mark);
    let lo = 0;
    let hi = kept.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((kept[mid]?.x ?? 0) < at) lo = mid + 1;
      else hi = mid;
    }
    const before = kept[lo - 1];
    const after = kept[lo];
    if ((before && at - before.x < gap) || (after && after.x - at < gap)) continue;
    kept.splice(lo, 0, { x: at, mark });
  }
  return kept.map((k) => k.mark);
};

const headingKey = (text: string) => stripHarakat(text).replace(/[\p{P}\sـ]+/gu, "");

/**
 * The page's first line for the preview card, or null when it is the same
 * heading the card already names (a page that opens its own section), so the
 * heading isn't shown twice.
 */
export const previewFirstLine = ({ chapter, firstLine }: { chapter: string | null; firstLine: string | null }) =>
  firstLine !== null && chapter !== null && headingKey(firstLine) === headingKey(chapter) ? null : firstLine;
