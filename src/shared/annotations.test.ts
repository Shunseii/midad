import { describe, expect, it } from "vitest";
import { spansOverlap } from "./annotations";

describe("spansOverlap", () => {
  const span = (a: number, b: number, part: "matn" | "hashiya" = "matn") => ({ part, start: { line: 2, word: a }, end: { line: 2, word: b } });
  it("is true when the spans share a word, and false when they only sit side by side", () => {
    expect(spansOverlap(span(1, 3), span(3, 5))).toBe(true);
    expect(spansOverlap(span(2, 2), span(1, 5))).toBe(true);
    expect(spansOverlap(span(1, 2), span(3, 5))).toBe(false);
  });
  it("is false across matn and ḥāshiya", () => {
    expect(spansOverlap(span(1, 3), span(1, 3, "hashiya"))).toBe(false);
  });
});
