import { describe, expect, it } from "vitest";
import type { Highlight, Span } from "../../../shared/annotations";
import type { Page } from "../../../shared/page";
import { sweepOrder } from "./sweep";

const page: Page = {
  header: null,
  matn: [
    { kind: "paragraph", line: 1, text: "واحد اثنان ثلاثة" },
    { kind: "paragraph", line: 2, text: "أربعة خمسة" },
  ],
  hashiya: [{ marker: "١", text: "حاشية أولى" }],
};

const highlight = (span: Span): Highlight => ({
  id: "h1",
  bookId: "b",
  position: 1,
  span,
  quote: "",
  stale: false,
  author: "me",
  createdAt: 0,
  color: "yellow",
});

describe("sweepOrder", () => {
  it("numbers the words a highlight covers in reading order, across lines", () => {
    const sweep = sweepOrder({ page, highlight: highlight({ part: "matn", start: { line: 1, word: 2 }, end: { line: 2, word: 1 } }) });
    expect([...sweep.order.entries()]).toEqual([
      ["matn:1:2", 0],
      ["matn:1:3", 1],
      ["matn:2:1", 2],
    ]);
    expect(sweep.count).toBe(3);
    expect(sweep.id).toBe("h1");
  });

  it("leaves out words outside the highlight", () => {
    const sweep = sweepOrder({ page, highlight: highlight({ part: "matn", start: { line: 1, word: 2 }, end: { line: 1, word: 2 } }) });
    expect(sweep.order.has("matn:1:1")).toBe(false);
    expect(sweep.order.has("matn:1:3")).toBe(false);
    expect(sweep.count).toBe(1);
  });

  it("reads hashiya highlights from the footnotes", () => {
    const sweep = sweepOrder({ page, highlight: highlight({ part: "hashiya", start: { line: 1, word: 1 }, end: { line: 1, word: 2 } }) });
    expect([...sweep.order.keys()]).toEqual(["hashiya:1:1", "hashiya:1:2"]);
  });

  it("never divides by zero when the text under a highlight is gone", () => {
    const sweep = sweepOrder({ page, highlight: highlight({ part: "matn", start: { line: 9, word: 1 }, end: { line: 9, word: 2 } }) });
    expect(sweep.order.size).toBe(0);
    expect(sweep.count).toBe(1);
  });
});
