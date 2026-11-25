import { describe, expect, it } from "vitest";
import { noteEditOutcome, refreshedDraft } from "./note-edit";

describe("refreshedDraft", () => {
  it("shows another device's newer text when nothing has been typed", () => {
    expect(refreshedDraft({ draft: "old", base: "old", incoming: "theirs" })).toEqual({ draft: "theirs", base: "theirs" });
  });

  it("keeps unsaved typing, and the text it started from", () => {
    expect(refreshedDraft({ draft: "old and mine", base: "old", incoming: "theirs" })).toEqual({ draft: "old and mine", base: "old" });
  });
});

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
