import { describe, expect, it } from "vitest";
import { EMPTY_HISTORY, record, redo, undo } from "./history";

describe("history", () => {
  it("undoes the newest change first", () => {
    const h = record(record(EMPTY_HISTORY, "a"), "b");
    const first = undo(h);
    expect(first.entry).toBe("b");
    expect(undo(first.history).entry).toBe("a");
  });

  it("redoes what was undone, newest undo first", () => {
    const undone = undo(undo(record(record(EMPTY_HISTORY, "a"), "b")).history).history;
    const first = redo(undone);
    expect(first.entry).toBe("a");
    expect(redo(first.history).entry).toBe("b");
  });

  it("has nothing to undo or redo when empty", () => {
    expect(undo(EMPTY_HISTORY)).toEqual({ history: EMPTY_HISTORY, entry: null });
    expect(redo(EMPTY_HISTORY)).toEqual({ history: EMPTY_HISTORY, entry: null });
  });

  it("drops the redo stack when a new change is made", () => {
    const undone = undo(record(EMPTY_HISTORY, "a")).history;
    expect(redo(record(undone, "b")).entry).toBeNull();
  });
});
