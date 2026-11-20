/** A contents entry, reduced to what working out the current one needs. */
export interface EntryAt {
  position: number;
}

/** The contents entry a page falls under: the last one that starts on or before it. */
export const entryIndexFor = (entries: EntryAt[], position: number) =>
  entries.reduce((found, e, i) => (e.position <= position ? i : found), -1);

/**
 * The contents entries the reader is looking at. A page with several headings
 * has one entry per heading; each line on screen counts toward the heading
 * above it, and lines above the page's first heading count toward the entry
 * before it. With nothing measured yet, it falls back to the page's entry.
 */
export const visibleEntries = ({
  entries,
  position,
  headingLines,
  visibleLines,
}: {
  entries: EntryAt[];
  position: number;
  /** The page's heading lines, in order; one per entry that starts on this page. */
  headingLines: number[];
  visibleLines: number[];
}): number[] => {
  const fallback = entryIndexFor(entries, position);
  const first = entries.findIndex((e) => e.position === position);
  const onPage = first === -1 ? 0 : entries.slice(first).findIndex((e) => e.position !== position);
  const count = onPage === -1 ? entries.length - first : onPage;
  // Entries that don't line up with the page's headings (a book without headings) keep the simple rule.
  if (first === -1 || count !== headingLines.length || visibleLines.length === 0) return fallback === -1 ? [] : [fallback];
  const found = new Set<number>();
  for (const line of visibleLines) {
    const under = headingLines.filter((h) => h <= line).length - 1;
    const index = under === -1 ? first - 1 : first + under;
    if (index >= 0) found.add(index);
  }
  return [...found].sort((a, b) => a - b);
};
