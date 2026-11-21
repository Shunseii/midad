import { describe, expect, it } from "vitest";
import { attachment, type GlossBox, type LayoutOptions, layoutRow, overlapsIn, type RowInput } from "./gloss-layout";

const options: LayoutOptions = { gap: 6, reach: 40 };
const bounds = { left: 0, right: 600 };
const noObstacles = { below: [], above: [] };

const gloss = ({ id, at, size = 40, width, two = null }: { id: string; at: number; size?: number; width: number; two?: number | null }): GlossBox => ({
  id,
  base: { left: at, right: at + size },
  width,
  twoLineWidth: two,
});

const place = (row: RowInput) => {
  const layout = layoutRow({ row, options });
  expect(overlapsIn({ layout, obstacles: row.obstacles, gap: options.gap })).toBe(false);
  for (const p of layout.placed) {
    expect(p.left).toBeGreaterThanOrEqual(row.bounds.left - 0.5);
    expect(p.left + p.width).toBeLessThanOrEqual(row.bounds.right + 0.5);
  }
  return { layout, of: (id: string) => layout.placed.find((p) => p.id === id)! };
};

describe("layoutRow", () => {
  it("centres a lone gloss under its words", () => {
    const { layout, of } = place({ bounds, glosses: [gloss({ id: "a", at: 300, width: 100 })], obstacles: noObstacles });
    expect(of("a")).toEqual({ id: "a", slot: "below", lane: 0, lines: 1, left: 270, width: 100 });
    expect(layout).toMatchObject({ below: 1, above: 0 });
  });

  it("keeps a gloss inside the column at the edge of a row", () => {
    const { of } = place({ bounds, glosses: [gloss({ id: "a", at: 570, size: 30, width: 120 })], obstacles: noObstacles });
    expect(of("a")).toMatchObject({ slot: "below", left: 480 });
  });

  it("spreads neighbours apart before moving either", () => {
    const { of } = place({ bounds, glosses: [gloss({ id: "a", at: 200, width: 100 }), gloss({ id: "b", at: 290, width: 100 })], obstacles: noObstacles });
    expect(of("a").slot).toBe("below");
    expect(of("b").slot).toBe("below");
    expect(of("b").left - (of("a").left + of("a").width)).toBeCloseTo(options.gap);
    // Each moved half the overlap.
    expect(of("a").left + 50 - 220).toBeCloseTo(-(of("b").left + 50 - 310));
  });

  it("moves a gloss above its words when spreading would push it out of reach", () => {
    const glosses = [gloss({ id: "a", at: 200, width: 200 }), gloss({ id: "b", at: 250, width: 200 }), gloss({ id: "c", at: 300, width: 200 })];
    const { layout } = place({ bounds: { left: 0, right: 520 }, glosses, obstacles: noObstacles });
    expect(layout.placed.map((p) => p.slot).sort()).toEqual(["above", "below", "below"]);
    expect(layout).toMatchObject({ below: 1, above: 1 });
  });

  it("treats note corners and footnote refs as taken space in the lane next to the words", () => {
    const { of } = place({
      bounds,
      glosses: [gloss({ id: "a", at: 300, width: 60 })],
      obstacles: { below: [{ left: 320, right: 330 }], above: [] },
    });
    // Centred it would cover the corner; the lane allows a nudge within reach.
    expect(of("a").slot).toBe("below");
    expect(of("a").left + of("a").width <= 320 - options.gap || of("a").left >= 330 + options.gap).toBe(true);
  });

  it("wraps a long gloss onto two lines when it fits neither under nor over", () => {
    const glosses = [
      gloss({ id: "a", at: 100, width: 150 }),
      gloss({ id: "b", at: 230, width: 150 }),
      gloss({ id: "long", at: 165, width: 300, two: 140 }),
      gloss({ id: "c", at: 165, width: 150 }),
    ];
    const { of } = place({ bounds: { left: 0, right: 420 }, glosses, obstacles: { below: [], above: [{ left: 60, right: 380 }] } });
    expect(of("long")).toMatchObject({ lines: 2, width: 140 });
  });

  it("opens a further lane under the row only as a last resort", () => {
    const glosses = [0, 1, 2, 3, 4].map((i) => gloss({ id: `g${i}`, at: 100 + i * 20, size: 10, width: 200 }));
    const { layout } = place({ bounds: { left: 0, right: 420 }, glosses, obstacles: noObstacles });
    expect(layout.placed.some((p) => p.lane > 0)).toBe(true);
    expect(layout.below).toBeGreaterThan(1);
  });

  it("never overlaps, whatever the row holds", () => {
    let seed = 7;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let round = 0; round < 300; round += 1) {
      const width = 300 + random() * 500;
      const count = 1 + Math.floor(random() * 8);
      const glosses = Array.from({ length: count }, (_, i) => {
        const w = 30 + random() * 260;
        return gloss({ id: `g${i}`, at: random() * (width - 40), size: 10 + random() * 60, width: w, two: random() < 0.6 ? w * 0.55 : null });
      });
      const obstacles = {
        below: Array.from({ length: Math.floor(random() * 3) }, () => {
          const at = random() * width;
          return { left: at, right: at + 8 };
        }),
        above: Array.from({ length: Math.floor(random() * 3) }, () => {
          const at = random() * width;
          return { left: at, right: at + 12 };
        }),
      };
      const row = { bounds: { left: 0, right: width }, glosses, obstacles };
      const { layout } = place(row);
      expect(layout.placed).toHaveLength(count);
      expect(layout.placed).toHaveLength(count);
    }
  });
});

describe("attachment", () => {
  it("puts a gloss whose words wrap on the row holding more of them, under just those words", () => {
    const words = [
      { row: 0, box: { left: 10, right: 60 } },
      { row: 1, box: { left: 500, right: 560 } },
      { row: 1, box: { left: 430, right: 490 } },
    ];
    expect(attachment(words)).toEqual({ row: 1, base: { left: 430, right: 560 } });
  });

  it("keeps the earlier row on a tie", () => {
    expect(attachment([{ row: 2, box: { left: 0, right: 10 } }, { row: 3, box: { left: 50, right: 60 } }])).toEqual({ row: 2, base: { left: 0, right: 10 } });
  });
});
