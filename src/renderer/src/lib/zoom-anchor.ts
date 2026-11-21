/**
 * Keeping the reader's place while the text size changes: pick a word before
 * the change, then scroll so it sits at the same height after the re-layout.
 */

export interface Box {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** Zoom steps closer together than this (a wheel burst, held keys) keep the first step's anchor. */
export const ANCHOR_BURST_MS = 500;

/** The first word that shows in full at the top of the view, in reading order; -1 when none does. */
export const firstFullyVisible = ({ words, view }: { words: Box[]; view: { top: number; bottom: number } }) =>
  words.findIndex((w) => w.top >= view.top && w.bottom <= view.bottom);

/** The word under a point, or failing that the nearest one: the closest row first, then along it. -1 when there are none. */
export const nearestWord = ({ words, x, y }: { words: Box[]; x: number; y: number }) => {
  let best = -1;
  let bestScore = Infinity;
  words.forEach((w, i) => {
    const dy = y < w.top ? w.top - y : y > w.bottom ? y - w.bottom : 0;
    const dx = x < w.left ? w.left - x : x > w.right ? x - w.right : 0;
    const score = dy * 10_000 + dx;
    if (score < bestScore) {
      best = i;
      bestScore = score;
    }
  });
  return best;
};

/** Whether a zoom step at `now` continues the burst that picked `anchoredAt`'s anchor. */
export const continuesBurst = ({ anchoredAt, now, windowMs = ANCHOR_BURST_MS }: { anchoredAt: number | null; now: number; windowMs?: number }) =>
  anchoredAt !== null && now - anchoredAt < windowMs;

/**
 * The scroll position that puts the anchor back `offset` px below the view's
 * top, kept within what the view can scroll to.
 */
export const restoredScrollTop = ({
  scrollTop,
  anchorTop,
  viewTop,
  offset,
  maxScrollTop,
}: {
  scrollTop: number;
  /** Where the anchor is now, after the re-layout, in the same coordinates as viewTop. */
  anchorTop: number;
  viewTop: number;
  offset: number;
  maxScrollTop: number;
}) => Math.min(Math.max(scrollTop + anchorTop - viewTop - offset, 0), Math.max(maxScrollTop, 0));

export const wordSelector = ({ part, line, word }: { part: string; line: number | string; word: number | string }) =>
  `[data-part="${part}"][data-line="${line}"][data-w="${word}"]`;
