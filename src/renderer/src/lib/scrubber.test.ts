import { describe, expect, it } from "vitest";
import { type Chapter, nearestMarkPage, nextMarkPage, pageAtFraction, pageFraction, previewFirstLine, TICK_GAP, stickyMarkPage, thinMarks, topLevelChapters } from "./scrubber";

const thinChapters = ({ chapters, total, width }: { chapters: Chapter[]; total: number; width: number }) =>
  thinMarks({ marks: chapters, weight: (c) => c.pages, total, width, gap: TICK_GAP });

const gaps = ({ marks, total, width }: { marks: { position: number }[]; total: number; width: number }) =>
  marks.slice(1).map((m, i) => (pageFraction({ position: m.position, total }) - pageFraction({ position: marks[i]?.position ?? 0, total })) * width);

describe("page geometry", () => {
  it("puts each page in the middle of its own stretch, page 1 at the right end", () => {
    expect(pageFraction({ position: 1, total: 4 })).toBe(0.125);
    expect(pageFraction({ position: 4, total: 4 })).toBe(0.875);
  });

  it("maps any point in a page's stretch back to that page", () => {
    expect(pageAtFraction({ fraction: 0, total: 25 })).toBe(1);
    expect(pageAtFraction({ fraction: 0.039, total: 25 })).toBe(1);
    expect(pageAtFraction({ fraction: 0.041, total: 25 })).toBe(2);
    expect(pageAtFraction({ fraction: 1, total: 25 })).toBe(25);
  });

  it("stays on the book's pages past either end", () => {
    expect(pageAtFraction({ fraction: -0.2, total: 25 })).toBe(1);
    expect(pageAtFraction({ fraction: 1.3, total: 25 })).toBe(25);
  });
});

describe("topLevelChapters", () => {
  it("keeps the shallowest level and measures each chapter up to the next", () => {
    const entries = [
      { position: 1, level: 2 },
      { position: 3, level: 3 },
      { position: 10, level: 2 },
      { position: 12, level: 3 },
      { position: 12, level: 2 },
    ];
    expect(topLevelChapters({ entries, total: 20 })).toEqual([
      { position: 1, pages: 9 },
      { position: 10, pages: 2 },
      { position: 12, pages: 9 },
    ]);
  });

  it("has nothing for a book without contents", () => {
    expect(topLevelChapters({ entries: [], total: 20 })).toEqual([]);
  });
});

describe("thinMarks", () => {
  it("keeps every tick when they are far enough apart", () => {
    const chapters = [{ position: 1, pages: 5 }, { position: 6, pages: 5 }, { position: 11, pages: 15 }];
    expect(thinChapters({ chapters, total: 25, width: 700 })).toEqual(chapters);
  });

  it("keeps the larger chapter when two ticks collide", () => {
    const chapters = [{ position: 100, pages: 1 }, { position: 101, pages: 40 }, { position: 141, pages: 2 }];
    expect(thinChapters({ chapters, total: 1300, width: 700 })).toEqual([{ position: 101, pages: 40 }, { position: 141, pages: 2 }]);
  });

  it("prefers the earlier page between equal chapters", () => {
    const chapters = [{ position: 10, pages: 3 }, { position: 13, pages: 3 }];
    expect(thinChapters({ chapters, total: 1300, width: 700 })).toEqual([{ position: 10, pages: 3 }]);
  });

  describe("a 1,300-page book with 200 chapters", () => {
    let seed = 11;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const starts = new Set([1]);
    while (starts.size < 200) starts.add(1 + Math.floor(random() * 1300));
    const sorted = [...starts].sort((a, b) => a - b);
    const chapters = sorted.map((position, i) => ({ position, pages: (sorted[i + 1] ?? 1301) - position }));

    for (const width of [320, 700, 1400]) {
      it(`leaves no two ticks closer than ${TICK_GAP}px at ${width}px`, () => {
        const kept = thinChapters({ chapters, total: 1300, width });
        expect(kept.length).toBeGreaterThan(0);
        expect(kept.length).toBeLessThanOrEqual(Math.floor(width / TICK_GAP) + 1);
        expect(Math.min(...gaps({ marks: kept, total: 1300, width }))).toBeGreaterThanOrEqual(TICK_GAP);
        // The biggest chapter always keeps its tick.
        const biggest = chapters.reduce((a, b) => (b.pages > a.pages ? b : a));
        expect(kept).toContainEqual(biggest);
        // Every dropped chapter lost to a kept one at least as big, within the gap.
        for (const c of chapters.filter((c) => !kept.includes(c))) {
          const x = pageFraction({ position: c.position, total: 1300 }) * width;
          expect(kept.some((k) => Math.abs(pageFraction({ position: k.position, total: 1300 }) * width - x) < TICK_GAP && k.pages >= c.pages)).toBe(true);
        }
      });
    }

    it("keeps more ticks on a wider line", () => {
      const narrow = thinChapters({ chapters, total: 1300, width: 320 }).length;
      const wide = thinChapters({ chapters, total: 1300, width: 1400 }).length;
      expect(wide).toBeGreaterThan(narrow);
    });
  });
});

describe("previewFirstLine", () => {
  it("drops the first line when it is the heading the card already shows", () => {
    expect(previewFirstLine({ chapter: "[مخالفته تعالى للحوادث]", firstLine: "[مخالفته تعالى للحوادث]" })).toBeNull();
  });

  it("matches the heading through harakat, brackets, punctuation and spacing", () => {
    expect(previewFirstLine({ chapter: "مخالفته تعالى للحوادث", firstLine: "[مُخَالَفَتُهُ  تَعَالَى لِلْحَوَادِثِ]:" })).toBeNull();
  });

  it("keeps a first line that differs from the heading", () => {
    expect(previewFirstLine({ chapter: "باب الكلام", firstLine: "الكلام هو اللفظ المركب المفيد" })).toBe("الكلام هو اللفظ المركب المفيد");
  });

  it("keeps the first line when there is no heading, and passes a missing line through", () => {
    expect(previewFirstLine({ chapter: null, firstLine: "سطر" })).toBe("سطر");
    expect(previewFirstLine({ chapter: "باب", firstLine: null })).toBeNull();
  });
});

describe("nearestMarkPage", () => {
  // 100 pages on a 1000px line: page n's mark sits (n - 0.5) * 10 px from the right end.
  const line = { total: 100, width: 1000 };

  it("picks the mark under the pointer, or a few px off it", () => {
    expect(nearestMarkPage({ pages: [10, 40], offset: 95, ...line })).toBe(10);
    expect(nearestMarkPage({ pages: [10, 40], offset: 101, ...line })).toBe(10);
  });

  it("picks nothing over empty track", () => {
    expect(nearestMarkPage({ pages: [10, 40], offset: 250, ...line })).toBeNull();
    expect(nearestMarkPage({ pages: [], offset: 95, ...line })).toBeNull();
  });

  it("picks the closer of two nearby marks, and the earlier page on a tie", () => {
    expect(nearestMarkPage({ pages: [10, 11], offset: 103, ...line })).toBe(11);
    expect(nearestMarkPage({ pages: [11, 10], offset: 100, ...line })).toBe(10);
  });

  it("takes a custom radius", () => {
    expect(nearestMarkPage({ pages: [10], offset: 110, ...line })).toBeNull();
    expect(nearestMarkPage({ pages: [10], offset: 110, radius: 20, ...line })).toBe(10);
  });
});

describe("nearestMarkPage at the ends and in crowds", () => {
  it("reaches marks on the first and last page", () => {
    // 10 pages on 100px: page 1 at 5px from the right end, page 10 at 95px.
    expect(nearestMarkPage({ pages: [1, 10], offset: 0, total: 10, width: 100 })).toBe(1);
    expect(nearestMarkPage({ pages: [1, 10], offset: 100, total: 10, width: 100 })).toBe(10);
  });

  it("in a crowd of marks 2px apart, picks the one under the pointer", () => {
    // 500 pages on 1000px: pages 2px apart.
    const crowd = Array.from({ length: 50 }, (_, i) => 100 + i);
    expect(nearestMarkPage({ pages: crowd, offset: (120 - 0.5) * 2, total: 500, width: 1000 })).toBe(120);
    expect(nearestMarkPage({ pages: crowd, offset: (120 - 0.5) * 2 + 0.9, total: 500, width: 1000 })).toBe(120);
  });

  it("ignores repeated pages", () => {
    expect(nearestMarkPage({ pages: [10, 10, 10], offset: 95, total: 100, width: 1000 })).toBe(10);
  });
});

describe("stickyMarkPage", () => {
  const line = { total: 100, width: 1000 };

  it("behaves like nearestMarkPage with nothing picked yet", () => {
    expect(stickyMarkPage({ pages: [10, 11], offset: 103, current: null, ...line })).toBe(11);
  });

  it("keeps the picked mark while the pointer drifts toward a neighbour", () => {
    // Marks at 95 and 105; at 101 the pointer is 6px from page 10 and 4px from page 11.
    expect(stickyMarkPage({ pages: [10, 11], offset: 101, current: 10, ...line })).toBe(10);
  });

  it("hands over once the neighbour is clearly closer", () => {
    expect(stickyMarkPage({ pages: [10, 11], offset: 104, current: 10, ...line })).toBe(11);
  });

  it("keeps the picked mark a little past the pick radius, then lets go", () => {
    expect(stickyMarkPage({ pages: [10], offset: 105, current: 10, ...line })).toBe(10);
    expect(stickyMarkPage({ pages: [10], offset: 110, current: 10, ...line })).toBeNull();
  });

  it("drops a picked mark that is no longer on the line", () => {
    expect(stickyMarkPage({ pages: [40], offset: 95, current: 10, ...line })).toBeNull();
  });
});

describe("nextMarkPage", () => {
  const pages = [30, 4, 12, 12, 50];

  it("finds the next marked page either way, in page order whatever the input order", () => {
    expect(nextMarkPage({ pages, from: 12, direction: 1 })).toBe(30);
    expect(nextMarkPage({ pages, from: 12, direction: -1 })).toBe(4);
    expect(nextMarkPage({ pages, from: 13, direction: -1 })).toBe(12);
  });

  it("is null past the last or before the first mark", () => {
    expect(nextMarkPage({ pages, from: 50, direction: 1 })).toBeNull();
    expect(nextMarkPage({ pages, from: 4, direction: -1 })).toBeNull();
    expect(nextMarkPage({ pages: [], from: 1, direction: 1 })).toBeNull();
  });
});
