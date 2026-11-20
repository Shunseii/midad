import { describe, expect, it } from "vitest";
import { entryIndexFor, visibleEntries } from "./contents";

// Entry 0 starts on page 1; page 5 has two headings (entries 1 and 2, lines 3 and 9).
const entries = [{ position: 1 }, { position: 5 }, { position: 5 }, { position: 8 }];
const page5 = { entries, position: 5, headingLines: [3, 9] };

describe("entryIndexFor", () => {
  it("picks the last entry starting on or before the page", () => {
    expect(entryIndexFor(entries, 6)).toBe(2);
    expect(entryIndexFor(entries, 0)).toBe(-1);
  });
});

describe("visibleEntries", () => {
  it("highlights only the first heading's entry while its lines are on screen", () => {
    expect(visibleEntries({ ...page5, visibleLines: [3, 4, 5] })).toEqual([1]);
  });

  it("highlights only the second heading's entry once scrolled past the first", () => {
    expect(visibleEntries({ ...page5, visibleLines: [9, 10, 11] })).toEqual([2]);
  });

  it("highlights both when both sections are on screen", () => {
    expect(visibleEntries({ ...page5, visibleLines: [7, 8, 9, 10] })).toEqual([1, 2]);
  });

  it("counts lines above the first heading toward the previous entry", () => {
    expect(visibleEntries({ ...page5, visibleLines: [1, 2, 3] })).toEqual([0, 1]);
  });

  it("falls back to the page's entry before anything is measured", () => {
    expect(visibleEntries({ ...page5, visibleLines: [] })).toEqual([2]);
  });

  it("uses the page's entry on a page without headings", () => {
    expect(visibleEntries({ entries, position: 6, headingLines: [], visibleLines: [1, 2] })).toEqual([2]);
  });

  it("keeps the simple rule when entries don't match the page's headings", () => {
    expect(visibleEntries({ entries, position: 5, headingLines: [3], visibleLines: [1, 3] })).toEqual([2]);
  });

  it("returns nothing before the first entry", () => {
    expect(visibleEntries({ entries, position: 0, headingLines: [], visibleLines: [1] })).toEqual([]);
  });
});
