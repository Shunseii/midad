/** What finishing an in-place note edit does: save the new text, or nothing when it's blank or unchanged. Blank notes aren't saved, as in the margin editor. */
export const noteEditOutcome = ({ before, draft }: { before: string; draft: string }): { kind: "save"; body: string } | { kind: "keep" } =>
  draft.trim() === "" || draft === before ? { kind: "keep" } : { kind: "save", body: draft };
