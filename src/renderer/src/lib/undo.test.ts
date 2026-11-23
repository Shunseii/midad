import { describe, expect, it } from "vitest";
import type { HighlightColor, LetterRef, NoteTarget, Span } from "../../../shared/annotations";
import { type BookmarkState, createUndoStack, type MarkerAt, type PageWrites } from "./undo";

const SPAN: Span = { part: "matn", start: { line: 2, word: 1 }, end: { line: 2, word: 3 } };
const REF: LetterRef = { part: "matn", line: 2, word: 1, letter: 2 };

/** An in-memory page: what the stack writes is what a reader would see. */
const fakePage = () => {
  let next = 0;
  const highlights = new Map<string, { span: Span; color: HighlightColor }>();
  const notes = new Map<string, { target: NoteTarget; body: string }>();
  const harakat = new Map<string, string>();
  const book = { marker: null as MarkerAt, bookmarks: new Map<number, NonNullable<BookmarkState>>() };
  const writes: PageWrites = {
    addHighlight: async ({ span, color }) => {
      const id = `h${++next}`;
      highlights.set(id, { span, color });
      return id;
    },
    removeHighlight: async (id) => {
      if (!highlights.delete(id)) throw new Error(`no highlight ${id}`);
    },
    addNote: async ({ body, ...target }) => {
      const id = `n${++next}`;
      notes.set(id, { target, body });
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
    clearMarks: async (span) => {
      const removed = [...harakat.entries()]
        .map(([key, marks]) => ({ ref: JSON.parse(key) as LetterRef, marks }))
        .filter(({ ref }) => ref.part === span.part && ref.line >= span.start.line && ref.line <= span.end.line);
      for (const { ref } of removed) harakat.delete(JSON.stringify(ref));
      return removed;
    },
    setMarker: async (at) => {
      book.marker = at;
    },
    setBookmark: async ({ position, bookmark }) => {
      if (bookmark) book.bookmarks.set(position, { createdAt: book.bookmarks.get(position)?.createdAt ?? 1, ...bookmark });
      else book.bookmarks.delete(position);
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
    const id = await stack.addNote({ target: { span: SPAN }, body: "first" });
    await stack.setMarks({ ref: REF, before: "", after: "\u064e" });
    await stack.updateNote({ id, before: "first", after: "second" });
    await stack.deleteNote({ id, target: { span: SPAN }, body: "second" });
    expect(page.notes.size).toBe(0);

    await stack.undo();
    expect([...page.notes.values()]).toEqual([{ target: { span: SPAN }, body: "second" }]);
    await stack.undo();
    expect([...page.notes.values()]).toEqual([{ target: { span: SPAN }, body: "first" }]);
    await stack.undo();
    await stack.undo();
    expect(page.notes.size).toBe(0);

    await stack.redo();
    await stack.redo();
    await stack.redo();
    expect([...page.notes.values()]).toEqual([{ target: { span: SPAN }, body: "second" }]);
  });

  it("brings back a deleted page note and line note as the same kind of note", async () => {
    const page = fakePage();
    const stack = createUndoStack(page.writes);
    const pageNote = await stack.addNote({ target: { page: true }, body: "summary" });
    const lineNote = await stack.addNote({ target: { line: { part: "matn", line: 4 } }, body: "line" });
    await stack.deleteNote({ id: pageNote, target: { page: true }, body: "summary" });
    await stack.deleteNote({ id: lineNote, target: { line: { part: "matn", line: 4 } }, body: "line" });
    await stack.undo();
    await stack.undo();
    expect([...page.notes.values()]).toEqual([
      { target: { line: { part: "matn", line: 4 } }, body: "line" },
      { target: { page: true }, body: "summary" },
    ]);
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
    const id = await stack.addNote({ target: { span: SPAN }, body: "x" });
    page.notes.delete(id);
    await expect(stack.undo()).rejects.toThrow(/no note/);
    page.notes.set(id, { target: { span: SPAN }, body: "x" });
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
    const id = await stack.addNote({ target: { span: SPAN }, body: "h" });
    await stack.updateNote({ id, before: "h", after: "hello" });
    await stack.undo();
    expect(page.notes.size).toBe(0);
    await stack.redo();
    expect([...page.notes.values()]).toEqual([{ target: { span: SPAN }, body: "hello" }]);
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
    const first = { position: 4, part: "matn" as const, line: 2, word: 1 };
    const second = { position: 4, part: "hashiya" as const, line: 7, word: 3 };
    await stack.setMarker({ before: null, after: first });
    await stack.setMarker({ before: first, after: second });
    await stack.undo();
    expect(page.book.marker).toEqual(first);
    await stack.undo();
    expect(page.book.marker).toBeNull();
    await stack.redo();
    expect(page.book.marker).toEqual(first);
  });

  it("undoes adding, renaming and deleting a bookmark, keeping the date it was added", async () => {
    const page = fakePage();
    const stack = createUndoStack(page.writes);
    await stack.setBookmark({ position: 12, before: null, after: { name: null } });
    const added = page.book.bookmarks.get(12);
    await stack.setBookmark({ position: 12, before: { name: null, createdAt: added?.createdAt }, after: { name: "الفاعل" } });
    await stack.setBookmark({ position: 12, before: { name: "الفاعل", createdAt: 77 }, after: null });
    expect(page.book.bookmarks.has(12)).toBe(false);
    await stack.undo();
    expect(page.book.bookmarks.get(12)).toEqual({ name: "الفاعل", createdAt: 77 });
    await stack.undo();
    expect(page.book.bookmarks.get(12)?.name).toBeNull();
    await stack.undo();
    expect(page.book.bookmarks.has(12)).toBe(false);
    await stack.redo();
    expect(page.book.bookmarks.has(12)).toBe(true);
  });

  it("brings back a cleared marker", async () => {
    const page = fakePage();
    const at = { position: 4, part: "matn" as const, line: 2, word: 1 };
    page.book.marker = at;
    const stack = createUndoStack(page.writes);
    await stack.setMarker({ before: at, after: null });
    expect(page.book.marker).toBeNull();
    await stack.undo();
    expect(page.book.marker).toEqual(at);
  });

  it("clears a passage's marks in one step and puts every one back on undo", async () => {
    const page = fakePage();
    const stack = createUndoStack(page.writes);
    const other = { ...REF, line: 5 };
    await stack.setMarks({ ref: REF, before: "", after: "َ" });
    await stack.setMarks({ ref: { ...REF, letter: 3 }, before: "", after: "ِ" });
    await stack.setMarks({ ref: other, before: "", after: "ُ" });
    expect(await stack.clearMarks(SPAN)).toBe(2);
    expect([...page.harakat.keys()]).toEqual([JSON.stringify(other)]);
    await stack.undo();
    expect(page.harakat.get(JSON.stringify(REF))).toBe("َ");
    expect(page.harakat.get(JSON.stringify({ ...REF, letter: 3 }))).toBe("ِ");
    await stack.redo();
    expect(page.harakat.size).toBe(1);
  });

  it("clears several highlights in one step and brings them all back, then clears them again", async () => {
    const page = fakePage();
    const a = await page.writes.addHighlight({ span: SPAN, color: "yellow" });
    const b = await page.writes.addHighlight({ span: { ...SPAN, start: { line: 3, word: 1 }, end: { line: 3, word: 2 } }, color: "blue" });
    const stack = createUndoStack(page.writes);
    await stack.clearHighlights([...page.highlights].map(([id, h]) => ({ id, ...h })));
    expect(page.highlights.size).toBe(0);
    await stack.undo();
    expect([...page.highlights.values()].map((h) => h.color).sort()).toEqual(["blue", "yellow"]);
    expect(page.highlights.has(a) || page.highlights.has(b)).toBe(false);
    await stack.redo();
    expect(page.highlights.size).toBe(0);
  });

  it("adds no undo step when there was nothing to clear", async () => {
    const page = fakePage();
    const stack = createUndoStack(page.writes);
    await stack.setMarks({ ref: REF, before: "", after: "َ" });
    expect(await stack.clearMarks({ ...SPAN, start: { line: 9, word: 1 }, end: { line: 9, word: 2 } })).toBe(0);
    await stack.undo();
    expect(page.harakat.size).toBe(0);
  });
});
