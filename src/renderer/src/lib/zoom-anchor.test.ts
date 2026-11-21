import { describe, expect, it } from "vitest";
import { continuesBurst, firstFullyVisible, nearestWord, restoredScrollTop, wordSelector } from "./zoom-anchor";

const box = ({ top, height = 40, left = 0, width = 60 }: { top: number; height?: number; left?: number; width?: number }) => ({
  top,
  bottom: top + height,
  left,
  right: left + width,
});

describe("firstFullyVisible", () => {
  const view = { top: 100, bottom: 600 };

  it("skips words cut off by the top of the view", () => {
    const words = [box({ top: 40 }), box({ top: 80 }), box({ top: 130 }), box({ top: 130, left: 70 })];
    expect(firstFullyVisible({ words, view })).toBe(2);
  });

  it("finds nothing when no word fits in the view", () => {
    expect(firstFullyVisible({ words: [box({ top: 50, height: 600 })], view })).toBe(-1);
  });
});

describe("nearestWord", () => {
  const words = [box({ top: 0, left: 0 }), box({ top: 0, left: 100 }), box({ top: 60, left: 0 }), box({ top: 60, left: 100 })];

  it("picks the word under the point", () => {
    expect(nearestWord({ words, x: 120, y: 70 })).toBe(3);
  });

  it("prefers the nearest row over a nearer word on another row", () => {
    expect(nearestWord({ words, x: 300, y: 55 })).toBe(3);
  });

  it("finds nothing without words", () => {
    expect(nearestWord({ words: [], x: 0, y: 0 })).toBe(-1);
  });
});

describe("continuesBurst", () => {
  it("keeps the anchor for steps in quick succession", () => {
    expect(continuesBurst({ anchoredAt: 1000, now: 1200 })).toBe(true);
  });

  it("picks a new anchor after a pause, or when there is none", () => {
    expect(continuesBurst({ anchoredAt: 1000, now: 1600 })).toBe(false);
    expect(continuesBurst({ anchoredAt: null, now: 1000 })).toBe(false);
  });
});

describe("restoredScrollTop", () => {
  it("scrolls so the anchor is back at its offset", () => {
    // The anchor was 150px below the view's top; after zooming in it sits 420px below.
    expect(restoredScrollTop({ scrollTop: 300, anchorTop: 80 + 420, viewTop: 80, offset: 150, maxScrollTop: 5000 })).toBe(570);
  });

  it("scrolls back up when zooming out moved the anchor up", () => {
    expect(restoredScrollTop({ scrollTop: 600, anchorTop: 80 + 20, viewTop: 80, offset: 150, maxScrollTop: 5000 })).toBe(470);
  });

  it("stops at the top and bottom of the scroll range", () => {
    expect(restoredScrollTop({ scrollTop: 50, anchorTop: 80, viewTop: 80, offset: 150, maxScrollTop: 5000 })).toBe(0);
    expect(restoredScrollTop({ scrollTop: 900, anchorTop: 900, viewTop: 80, offset: 0, maxScrollTop: 1000 })).toBe(1000);
  });

  it("stays at the top when the page no longer scrolls", () => {
    expect(restoredScrollTop({ scrollTop: 0, anchorTop: 300, viewTop: 80, offset: 10, maxScrollTop: -4 })).toBe(0);
  });
});

describe("saving and restoring a place", () => {
  it("puts the saved word back at its saved height after the page re-lays out", () => {
    const view = { top: 100, bottom: 600 };
    const before = [box({ top: 60 }), box({ top: 140 }), box({ top: 220 })];
    const saved = firstFullyVisible({ words: before, view });
    const offset = before[saved]!.top - view.top;
    // Relaunched at the top of the page, at a larger text size: the word is now 900px further down.
    const scrollTop = restoredScrollTop({ scrollTop: 0, anchorTop: 140 + 900, viewTop: view.top, offset, maxScrollTop: 5000 });
    expect(140 + 900 - scrollTop - view.top).toBe(offset);
  });
});

describe("wordSelector", () => {
  it("matches a word by part, line and index", () => {
    expect(wordSelector({ part: "hashiya", line: 4, word: 2 })).toBe('[data-part="hashiya"][data-line="4"][data-w="2"]');
  });
});
