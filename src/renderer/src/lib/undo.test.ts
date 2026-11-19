import { describe, expect, it } from "vitest";
import type { HighlightColor, LetterRef, Span } from "../../../shared/annotations";
import { createUndoStack, type MarkerAt, type PageWrites } from "./undo";

const SPAN: Span = { part: "matn", start: { line: 2, word: 1 }, end: { line: 2, word: 3 } };
const REF: LetterRef = { part: "matn", line: 2, word: 1, letter: 2 };

/** An in-memory page: what the stack writes is what a reader would see. */
const fakePage = () => {
  let next = 0;
  const highlights = new Map<string, { span: Span; color: HighlightColor }>();
  const notes = new Map<string, { span: Span; body: string }>();
  const harakat = new Map<string, string>();
  const book = { marker: null as MarkerAt };
  const writes: PageWrites = {
    addHighlight: async ({ span, color }) => {
      const id = `h${++next}`;
      highlights.set(id, { span, color });
      return id;
    },
    removeHighlight: async (id) => {
      if (!highlights.delete(id)) throw new Error(`no highlight ${id}`);
    },
    addNote: async ({ span, body }) => {
      const id = `n${++next}`;
      notes.set(id, { span, body });
      return id;
    },
    updateNote: async ({ id, body }) => {
      const note = notes.get(id);
      if (!note) throw new Error(`no note ${id}`);
      notes.set(id, { ...note, body });
    },
    deleteNote: async (id) => {
      if (!notes.delete(id)) throw new Error(`no note ${id}`);
    },
    setMarks: async ({ ref, marks }) => {
      if (marks) harakat.set(JSON.stringify(ref), marks);
      else harakat.delete(JSON.stringify(ref));
    },
    setMarker: async (at) => {
      book.marker = at;
    },
  };
  return { writes, highlights, notes, harakat, book };
};

describe("undo stack", () => {
  it("undoes and redoes adding a highlight", async () => {
    const page = fakePage();
    const stack = createUndoStack(page.writes);
    await stack.addHighlight({ span: SPAN, color: "green" });
    expect(page.highlights.size).toBe(1);
    await stack.undo();
    expect(page.highlights.size).toBe(0);
    await stack.redo();
    expect([...page.highlights.values()]).toEqual([{ span: SPAN, color: "green" }]);
  });

  it("brings back a removed highlight, and can remove it again after", async () => {
    const page = fakePage();
    const id = await page.writes.addHighlight({ span: SPAN, color: "pink" });
    const stack = createUndoStack(page.writes);
    await stack.removeHighlight({ id, span: SPAN, color: "pink" });
    await stack.undo();
    expect([...page.highlights.values()]).toEqual([{ span: SPAN, color: "pink" }]);
    await stack.redo();
    expect(page.highlights.size).toBe(0);
  });

  it("undoes note edits and deletes in order, following a note that came back with a new id", async () => {
    const page = fakePage();
    const stack = createUndoStack(page.writes);
    const id = await stack.addNote({ span: SPAN, body: "first" });
    await stack.setMarks({ ref: REF, before: "", after: "\u064e" });
    await stack.updateNote({ id, before: "first", after: "second" });
    await stack.deleteNote({ id, span: SPAN, body: "second" });
    expect(page.notes.size).toBe(0);

    await stack.undo();
    expect([...page.notes.values()]).toEqual([{ span: SPAN, body: "second" }]);
    await stack.undo();
    expect([...page.notes.values()]).toEqual([{ span: SPAN, body: "first" }]);
    await stack.undo();
    await stack.undo();
    expect(page.notes.size).toBe(0);

    await stack.redo();
    await stack.redo();
    await stack.redo();
    expect([...page.notes.values()]).toEqual([{ span: SPAN, body: "second" }]);
  });

  it("undoes harakat back to the marks that were there before", async () => {
    const page = fakePage();
    const stack = createUndoStack(page.writes);
    await stack.setMarks({ ref: REF, before: "", after: "َ" });
    await stack.setMarks({ ref: REF, before: "َ", after: "ِ" });
    await stack.undo();
    expect(page.harakat.get(JSON.stringify(REF))).toBe("َ");
    await stack.undo();
    expect(page.harakat.size).toBe(0);
  });

  it("reports what it undid, and nothing when there is nothing to undo or redo", async () => {
    const page = fakePage();
    const stack = createUndoStack(page.writes);
    expect(await stack.undo()).toBeNull();
    await stack.setMarks({ ref: REF, before: "", after: "َ" });
    expect(await stack.undo()).toMatchObject({ kind: "harakat", ref: REF });
    expect(await stack.redo()).toMatchObject({ kind: "harakat", ref: REF });
    expect(await stack.redo()).toBeNull();
  });

  it("drops the redo list after a new change", async () => {
    const page = fakePage();
    const stack = createUndoStack(page.writes);
    await stack.addHighlight({ span: SPAN, color: "blue" });
    await stack.undo();
    await stack.setMarks({ ref: REF, before: "", after: "َ" });
    expect(await stack.redo()).toBeNull();
    expect(page.highlights.size).toBe(0);
  });

  it("keeps a failed undo on the stack so it can be tried again", async () => {
    const page = fakePage();
    const stack = createUndoStack(page.writes);
    const id = await stack.addNote({ span: SPAN, body: "x" });
    page.notes.delete(id);
    await expect(stack.undo()).rejects.toThrow(/no note/);
    page.notes.set(id, { span: SPAN, body: "x" });
    await stack.undo();
    expect(page.notes.size).toBe(0);
  });

  it("takes back a whole typing session on a note in one step", async () => {
    const page = fakePage();
    const id = await page.writes.addNote({ span: SPAN, body: "old" });
    const stack = createUndoStack(page.writes);
    await stack.updateNote({ id, before: "old", after: "n" });
    await stack.updateNote({ id, before: "n", after: "ne" });
    await stack.updateNote({ id, before: "ne", after: "new" });
    await stack.undo();
    expect(page.notes.get(id)?.body).toBe("old");
    expect(await stack.undo()).toBeNull();
  });

  it("undoes a new note and the text typed into it together", async () => {
    const page = fakePage();
    const stack = createUndoStack(page.writes);
    const id = await stack.addNote({ span: SPAN, body: "h" });
    await stack.updateNote({ id, before: "h", after: "hello" });
    await stack.undo();
    expect(page.notes.size).toBe(0);
    await stack.redo();
    expect([...page.notes.values()]).toEqual([{ span: SPAN, body: "hello" }]);
  });

  it("runs quick presses one after another, so each undoes a different change", async () => {
    const page = fakePage();
    const stack = createUndoStack(page.writes);
    await stack.addHighlight({ span: SPAN, color: "blue" });
    await stack.addHighlight({ span: SPAN, color: "pink" });
    await Promise.all([stack.undo(), stack.undo()]);
    expect(page.highlights.size).toBe(0);
  });

  it("moves the last-read marker back to where it was, or clears it if there was none", async () => {
    const page = fakePage();
    const stack = createUndoStack(page.writes);
    const first = { position: 4, line: 2, word: 1 };
    const second = { position: 4, line: 7, word: 3 };
    await stack.setMarker({ before: null, after: first });
    await stack.setMarker({ before: first, after: second });
    await stack.undo();
    expect(page.book.marker).toEqual(first);
    await stack.undo();
    expect(page.book.marker).toBeNull();
    await stack.redo();
    expect(page.book.marker).toEqual(first);
  });

  it("brings back a cleared marker", async () => {
    const page = fakePage();
    const at = { position: 4, line: 2, word: 1 };
    page.book.marker = at;
    const stack = createUndoStack(page.writes);
    await stack.setMarker({ before: at, after: null });
    expect(page.book.marker).toBeNull();
    await stack.undo();
    expect(page.book.marker).toEqual(at);
  });
});
