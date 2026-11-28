import { describe, expect, it } from "vitest";
import { AUTO_SCROLL_EDGE, autoScrollStep, granularityFor, unitSpan } from "./pointer-selection";

describe("granularityFor", () => {
  it("selects by point on a single press", () => {
    expect(granularityFor({ clicks: 1, onWord: true, onLine: true })).toBe("char");
  });

  it("selects by word on a double-click over a word, by point elsewhere", () => {
    expect(granularityFor({ clicks: 2, onWord: true, onLine: true })).toBe("word");
    expect(granularityFor({ clicks: 2, onWord: false, onLine: true })).toBe("char");
  });

  it("selects by line on a triple-click over a line, even off its words", () => {
    expect(granularityFor({ clicks: 3, onWord: false, onLine: true })).toBe("line");
    expect(granularityFor({ clicks: 4, onWord: true, onLine: true })).toBe("line");
    expect(granularityFor({ clicks: 3, onWord: false, onLine: false })).toBe("char");
  });
});

describe("unitSpan", () => {
  const word = (i: number) => ({ first: i, last: i });

  it("runs forward from the starting unit to the pointer's", () => {
    expect(unitSpan({ anchor: word(4), focus: word(7) })).toEqual({ from: 4, to: 7, backward: false });
  });

  it("runs backward, keeping the starting unit, when the pointer goes before it", () => {
    expect(unitSpan({ anchor: word(4), focus: word(1) })).toEqual({ from: 1, to: 4, backward: true });
  });

  it("keeps a whole starting line while the pointer is inside it", () => {
    expect(unitSpan({ anchor: { first: 10, last: 23 }, focus: word(15) })).toEqual({ from: 10, to: 23, backward: false });
  });

  it("takes in the pointer's whole line on either side", () => {
    expect(unitSpan({ anchor: { first: 10, last: 23 }, focus: { first: 24, last: 37 } })).toEqual({ from: 10, to: 37, backward: false });
    expect(unitSpan({ anchor: { first: 10, last: 23 }, focus: { first: 0, last: 9 } })).toEqual({ from: 0, to: 23, backward: true });
  });
});

describe("autoScrollStep", () => {
  const view = { top: 100, bottom: 700 };

  it("doesn't scroll away from the edges", () => {
    expect(autoScrollStep({ y: 400, ...view })).toBe(0);
    expect(autoScrollStep({ y: view.top + AUTO_SCROLL_EDGE, ...view })).toBe(0);
    expect(autoScrollStep({ y: view.bottom - AUTO_SCROLL_EDGE, ...view })).toBe(0);
  });

  it("scrolls up near the top and down near the bottom", () => {
    expect(autoScrollStep({ y: view.top + 10, ...view })).toBeLessThan(0);
    expect(autoScrollStep({ y: view.bottom - 10, ...view })).toBeGreaterThan(0);
  });

  it("goes faster deeper into the edge and past it, up to a limit", () => {
    const near = autoScrollStep({ y: view.bottom - 30, ...view });
    const past = autoScrollStep({ y: view.bottom + 60, ...view });
    expect(past).toBeGreaterThan(near);
    expect(autoScrollStep({ y: view.bottom + 5000, ...view })).toBe(40);
  });
});
