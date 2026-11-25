/**
 * An open editor meeting a newer saved text (another device or the agent edited the note): with no
 * unsaved typing it shows the new text; with some, it keeps what's being typed, and saving it then
 * wins, as the latest edit does everywhere. `base` is the saved text the draft started from.
 */
export const refreshedDraft = ({ draft, base, incoming }: { draft: string; base: string; incoming: string }): { draft: string; base: string } =>
  draft === base ? { draft: incoming, base: incoming } : { draft, base };

/** What finishing an in-place note edit does: save the new text, or nothing when it's blank or unchanged. Blank notes aren't saved, as in the margin editor. */
export const noteEditOutcome = ({ before, draft }: { before: string; draft: string }): { kind: "save"; body: string } | { kind: "keep" } =>
  draft.trim() === "" || draft === before ? { kind: "keep" } : { kind: "save", body: draft };
