/** Corners: marks at the ends of each note's words, and one mark per row in the margin. Margin: only the margin marks. */
export type NoteIcons = "corners" | "margin";
/** Under: printed small under their words, as the book does. Hover: shown while the words are hovered. Hidden: not shown. */
export type GlossMode = "under" | "hover" | "hidden";

/** "words" (an icon on each note's first word) became the corner marks. */
export const noteIconsFrom = (stored: unknown): NoteIcons => (stored === "margin" ? "margin" : "corners");

/** Until a mode is chosen, the old switch for the rings after glossed words decides: off hides the glosses, on prints them under their words. */
export const glossModeFrom = ({ stored, legacyMarkers }: { stored: unknown; legacyMarkers: unknown }): GlossMode =>
  stored === "under" || stored === "hover" || stored === "hidden" ? stored : legacyMarkers === false ? "hidden" : "under";
