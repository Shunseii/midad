import { describe, expect, it } from "vitest";
import { type Chapter, pageAtFraction, pageFraction, previewFirstLine, TICK_GAP, thinMarks, topLevelChapters } from "./scrubber";

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
