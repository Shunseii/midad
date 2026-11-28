/** What a press selects as the pointer moves: from a point, whole words (double-click) or whole lines (triple-click). */
export type Granularity = "char" | "word" | "line";

/** A run of words, as indexes into the page's words in reading order. */
export interface Unit {
  first: number;
  last: number;
}

export const granularityFor = ({ clicks, onWord, onLine }: { clicks: number; onWord: boolean; onLine: boolean }): Granularity => {
  if (clicks >= 3 && onLine) return "line";
  if (clicks === 2 && onWord) return "word";
  return "char";
};

/**
 * The words a word- or line-wise drag covers: the unit it started on and the one under the pointer,
 * with everything between. Backward when the pointer's unit comes first, so the selection's
 * fixed end stays with the unit it started on.
 */
export const unitSpan = ({ anchor, focus }: { anchor: Unit; focus: Unit }): { from: number; to: number; backward: boolean } =>
  focus.first < anchor.first
    ? { from: focus.first, to: anchor.last, backward: true }
    : { from: anchor.first, to: Math.max(anchor.last, focus.last), backward: false };

/** How close to the scroll area's top or bottom edge a drag starts scrolling it. */
export const AUTO_SCROLL_EDGE = 40;
const MAX_STEP = 40;

/**
 * Pixels to scroll this frame while dragging a selection at `y`: nothing away from the edges,
 * faster the deeper the pointer is into an edge's band or past it, as the browser does.
 */
export const autoScrollStep = ({ y, top, bottom }: { y: number; top: number; bottom: number }): number => {
  const intoTop = top + AUTO_SCROLL_EDGE - y;
  const intoBottom = y - (bottom - AUTO_SCROLL_EDGE);
  const depth = intoTop > 0 ? -intoTop : intoBottom > 0 ? intoBottom : 0;
  if (depth === 0) return 0;
  const step = Math.max(1, Math.round(Math.abs(depth) / 3));
  return Math.sign(depth) * Math.min(step, MAX_STEP);
};
