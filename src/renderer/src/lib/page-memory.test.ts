import { describe, expect, it } from "vitest";
import { arrival, createPageMemory } from "./page-memory";

const bottomOf4 = { anchor: { part: "matn" as const, line: 30, word: 2, offset: 12 } };
const middleOf5 = { anchor: { part: "matn" as const, line: 14, word: 0, offset: 40 } };

describe("arrival", () => {
  it("starts a page not seen this session at the top, whichever way it was reached", () => {
    const memory = createPageMemory();
    memory.remember({ page: { bookId: "a", position: 4 }, place: bottomOf4 });
    expect(arrival({ page: { bookId: "a", position: 3 }, opening: false, hasTarget: false, memory })).toEqual({ kind: "top" });
  });

  it("walks through 4 → 5 → 4 → 5, landing where each page was left", () => {
    const memory = createPageMemory();
    const four = { bookId: "a", position: 4 };
    const five = { bookId: "a", position: 5 };
    memory.remember({ page: four, place: bottomOf4 });
    expect(arrival({ page: five, opening: false, hasTarget: false, memory })).toEqual({ kind: "top" });
    memory.remember({ page: five, place: middleOf5 });
    expect(arrival({ page: four, opening: false, hasTarget: false, memory })).toEqual({ kind: "restore", place: bottomOf4 });
    expect(arrival({ page: five, opening: false, hasTarget: false, memory })).toEqual({ kind: "restore", place: middleOf5 });
  });

  it("keeps the latest place for a page", () => {
    const memory = createPageMemory();
    const page = { bookId: "a", position: 4 };
    memory.remember({ page, place: bottomOf4 });
    memory.remember({ page, place: { scrollTop: 90 } });
    expect(arrival({ page, opening: false, hasTarget: false, memory })).toEqual({ kind: "restore", place: { scrollTop: 90 } });
  });

  it("lets a navigation's own target win over the remembered place", () => {
    const memory = createPageMemory();
    const page = { bookId: "a", position: 4 };
    memory.remember({ page, place: bottomOf4 });
    expect(arrival({ page, opening: false, hasTarget: true, memory })).toEqual({ kind: "target" });
  });

  it("leaves the book's opening page to its saved last-read place", () => {
    const memory = createPageMemory();
    const page = { bookId: "a", position: 4 };
    memory.remember({ page, place: bottomOf4 });
    expect(arrival({ page, opening: true, hasTarget: false, memory })).toEqual({ kind: "opening" });
  });

  it("keeps each book's pages apart", () => {
    const memory = createPageMemory();
    memory.remember({ page: { bookId: "a", position: 4 }, place: bottomOf4 });
    memory.remember({ page: { bookId: "b", position: 4 }, place: middleOf5 });
    expect(memory.recall({ bookId: "a", position: 4 })).toEqual(bottomOf4);
    expect(memory.recall({ bookId: "b", position: 4 })).toEqual(middleOf5);
    expect(memory.recall({ bookId: "c", position: 4 })).toBeNull();
  });

  it("doesn't confuse a book id ending in digits with another page", () => {
    const memory = createPageMemory();
    memory.remember({ page: { bookId: "a1", position: 4 }, place: bottomOf4 });
    expect(memory.recall({ bookId: "a", position: 14 })).toBeNull();
  });
});
