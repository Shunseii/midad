import { describe, expect, it } from "vitest";
import { existingNoteFor, type Note, spansOverlap } from "./annotations";

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

describe("existingNoteFor", () => {
  const span = (a: number, b: number) => ({ part: "matn" as const, start: { line: 2, word: a }, end: { line: 2, word: b } });
  const note = ({ id, from, to, kind = "words", stale = false }: { id: string; from: number; to: number; kind?: Note["kind"]; stale?: boolean }): Note => ({
    id, bookId: "b", position: 1, span: span(from, to), quote: "", stale, author: "me", createdAt: 0, kind, body: "x", updatedAt: 0,
  });

  it("opens the note already on the selected words instead of making a new one", () => {
    expect(existingNoteFor({ notes: [note({ id: "a", from: 3, to: 3 })], span: span(3, 3) })?.id).toBe("a");
  });
  it("opens the note whose words take in a selection inside it", () => {
    expect(existingNoteFor({ notes: [note({ id: "a", from: 2, to: 5 })], span: span(3, 4) })?.id).toBe("a");
  });
  it("makes a new note when the selection reaches past every note, or misses them", () => {
    const notes = [note({ id: "a", from: 3, to: 4 })];
    expect(existingNoteFor({ notes, span: span(3, 5) })).toBeNull();
    expect(existingNoteFor({ notes, span: span(6, 6) })).toBeNull();
  });
  it("prefers the exact match, and makes a new note when several cover it and none matches", () => {
    expect(existingNoteFor({ notes: [note({ id: "wide", from: 1, to: 6 }), note({ id: "exact", from: 3, to: 4 })], span: span(3, 4) })?.id).toBe("exact");
    expect(existingNoteFor({ notes: [note({ id: "a", from: 1, to: 6 }), note({ id: "b", from: 2, to: 5 })], span: span(3, 4) })).toBeNull();
  });
  it("leaves out line notes and stale notes", () => {
    expect(existingNoteFor({ notes: [note({ id: "l", from: 1, to: 9, kind: "line" }), note({ id: "s", from: 3, to: 3, stale: true })], span: span(3, 3) })).toBeNull();
  });
});
