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

/** How far (in px) from a mark the pointer can be and still pick it: a bigger target than the mark itself. */
export const MARK_HIT_PX = 7;

/**
 * The page of the mark nearest the pointer, or null when none is within
 * `radius` px. `offset` is the pointer's distance from the line's right end.
 */
export const nearestMarkPage = ({
  pages,
  offset,
  total,
  width,
  radius = MARK_HIT_PX,
}: {
  /** The pages that carry a mark on the line. */
  pages: number[];
  offset: number;
  total: number;
  width: number;
  radius?: number;
}): number | null => {
  let best: number | null = null;
  let bestDistance = radius;
  for (const page of pages) {
    const distance = Math.abs(pageFraction({ position: page, total }) * width - offset);
    if (distance <= bestDistance && (best === null || distance < bestDistance || page < best)) {
      best = page;
      bestDistance = distance;
    }
  }
  return best;
};

/** A picked mark stays picked while the pointer is this close (in px), so it doesn't flicker between neighbours. */
export const MARK_KEEP_PX = 11;
/** Another mark takes over from the picked one only when it is this much (in px) closer. */
export const MARK_SWITCH_PX = 2;

/**
 * Like nearestMarkPage, but sticky: the mark already picked (`current`) holds
 * while the pointer stays within `keep` px of it, unless another mark is
 * clearly closer. Without a current mark it is plain nearestMarkPage.
 */
export const stickyMarkPage = ({
  pages,
  offset,
  total,
  width,
  current,
  radius = MARK_HIT_PX,
  keep = MARK_KEEP_PX,
  margin = MARK_SWITCH_PX,
}: {
  pages: number[];
  offset: number;
  total: number;
  width: number;
  current: number | null;
  radius?: number;
  keep?: number;
  margin?: number;
}): number | null => {
  const nearest = nearestMarkPage({ pages, offset, total, width, radius });
  if (current === null || !pages.includes(current)) return nearest;
  const distance = (page: number) => Math.abs(pageFraction({ position: page, total }) * width - offset);
  const held = distance(current);
  if (held > keep) return nearest;
  return nearest !== null && nearest !== current && distance(nearest) + margin < held ? nearest : current;
};

/** The next marked page after `from` (direction 1) or before it (-1), or null when there is none that way. */
export const nextMarkPage = ({ pages, from, direction }: { pages: number[]; from: number; direction: 1 | -1 }): number | null => {
  let found: number | null = null;
  for (const page of pages) {
    if (direction === 1 ? page > from && (found === null || page < found) : page < from && (found === null || page > found)) found = page;
  }
  return found;
};

