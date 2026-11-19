import type { HighlightColor, LetterRef, Span } from "../../../shared/annotations";

/** Where the book's last-read marker sits; `null` when there is none. */
export type MarkerAt = { position: number; line: number; word: number } | null;
import { EMPTY_HISTORY, type History, record, redo, undo } from "./history";

/** The writes the stack makes on one page. Adds return the new item's id. */
export interface PageWrites {
  addHighlight: (input: { span: Span; color: HighlightColor }) => Promise<string>;
  removeHighlight: (id: string) => Promise<void>;
  addNote: (input: { span: Span; body: string }) => Promise<string>;
  updateNote: (input: { id: string; body: string }) => Promise<void>;
  deleteNote: (id: string) => Promise<void>;
  /** Empty marks remove the reader's harakat from the letter. */
  setMarks: (input: { ref: LetterRef; marks: string }) => Promise<void>;
  setMarker: (at: MarkerAt) => Promise<void>;
}

export type Change =
  | { kind: "highlight"; op: "add" | "remove"; id: string; span: Span; color: HighlightColor }
  | { kind: "note"; op: "add" | "delete"; id: string; span: Span; body: string }
  | { kind: "note-edit"; id: string; before: string; after: string }
  | { kind: "harakat"; ref: LetterRef; before: string; after: string }
  | { kind: "marker"; before: MarkerAt; after: MarkerAt };

/**
 * Every edit on a page goes through here so Ctrl+Z can take it back. Undoing a
 * delete re-creates the item under a new id; later entries still name the old
 * one, so ids are followed through `renamed`.
 */
export const createUndoStack = (writes: PageWrites) => {
  let history: History<Change> = EMPTY_HISTORY;
  const renamed = new Map<string, string>();
  const current = (id: string): string => {
    let at = id;
    for (let next = renamed.get(at); next !== undefined; next = renamed.get(at)) at = next;
    return at;
  };
  const recreated = (oldId: string, newId: string) => renamed.set(current(oldId), newId);

  // Writes are async; running them one at a time keeps each Ctrl+Z on its own entry.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => undefined);
    return run;
  };

  const highlight = async (c: Extract<Change, { kind: "highlight" }>, present: boolean) => {
    if (present) recreated(c.id, await writes.addHighlight({ span: c.span, color: c.color }));
    else await writes.removeHighlight(current(c.id));
  };
  const note = async (c: Extract<Change, { kind: "note" }>, present: boolean) => {
    if (present) recreated(c.id, await writes.addNote({ span: c.span, body: c.body }));
    else await writes.deleteNote(current(c.id));
  };

  /** Puts the page in the state from before (`forward` false) or after the change. */
  const apply = (c: Change, forward: boolean): Promise<void> => {
    switch (c.kind) {
      case "highlight":
        return highlight(c, (c.op === "add") === forward);
      case "note":
        return note(c, (c.op === "add") === forward);
      case "note-edit":
        return writes.updateNote({ id: current(c.id), body: forward ? c.after : c.before });
      case "harakat":
        return writes.setMarks({ ref: c.ref, marks: forward ? c.after : c.before });
      case "marker":
        return writes.setMarker(forward ? c.after : c.before);
    }
  };

  const step = (direction: "undo" | "redo"): Promise<Change | null> => serial(async () => {
    const next = (direction === "undo" ? undo : redo)(history);
    if (!next.entry) return null;
    await apply(next.entry, direction === "redo");
    history = next.history;
    return next.entry;
  });

  return {
    addHighlight({ span, color }: { span: Span; color: HighlightColor }): Promise<string> {
      return serial(async () => {
        const id = await writes.addHighlight({ span, color });
        history = record(history, { kind: "highlight", op: "add", id, span, color });
        return id;
      });
    },
    removeHighlight({ id, span, color }: { id: string; span: Span; color: HighlightColor }): Promise<void> {
      return serial(async () => {
        await writes.removeHighlight(id);
        history = record(history, { kind: "highlight", op: "remove", id, span, color });
      });
    },
    addNote({ span, body }: { span: Span; body: string }): Promise<string> {
      return serial(async () => {
        const id = await writes.addNote({ span, body });
        history = record(history, { kind: "note", op: "add", id, span, body });
        return id;
      });
    },
    /** Edits saved while typing merge into the note's last entry, so one undo takes back the whole session. */
    updateNote({ id, before, after }: { id: string; before: string; after: string }): Promise<void> {
      return serial(async () => {
        await writes.updateNote({ id, body: after });
        const last = history.done.at(-1);
        const sameNote = last && (last.kind === "note-edit" || (last.kind === "note" && last.op === "add")) && current(last.id) === current(id);
        if (!sameNote) {
          history = record(history, { kind: "note-edit", id, before, after });
          return;
        }
        const merged: Change = last.kind === "note-edit" ? { ...last, after } : { ...last, body: after };
        history = { done: [...history.done.slice(0, -1), merged], undone: [] };
      });
    },
    deleteNote({ id, span, body }: { id: string; span: Span; body: string }): Promise<void> {
      return serial(async () => {
        await writes.deleteNote(id);
        history = record(history, { kind: "note", op: "delete", id, span, body });
      });
    },
    setMarks({ ref, before, after }: { ref: LetterRef; before: string; after: string }): Promise<void> {
      return serial(async () => {
        if (before === after) return;
        await writes.setMarks({ ref, marks: after });
        history = record(history, { kind: "harakat", ref, before, after });
      });
    },
    setMarker({ before, after }: { before: MarkerAt; after: MarkerAt }): Promise<void> {
      return serial(async () => {
        await writes.setMarker(after);
        history = record(history, { kind: "marker", before, after });
      });
    },
    undo: () => step("undo"),
    redo: () => step("redo"),
  };
};

export type UndoStack = ReturnType<typeof createUndoStack>;
