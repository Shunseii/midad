import { describe, expect, it } from "vitest";
import { noteEditOutcome } from "./note-edit";

describe("noteEditOutcome", () => {
  it("saves changed text as typed", () => {
    expect(noteEditOutcome({ before: "old", draft: "new text " })).toEqual({ kind: "save", body: "new text " });
  });

  it("keeps the note when nothing changed", () => {
    expect(noteEditOutcome({ before: "same", draft: "same" })).toEqual({ kind: "keep" });
  });

  it("keeps the note when the draft is blank", () => {
    expect(noteEditOutcome({ before: "old", draft: "  \n " })).toEqual({ kind: "keep" });
  });
});
