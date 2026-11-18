import type { Span } from "../../../shared/annotations";

/** Text copied from the page, remembered so pasting it into Ask AI can quote it with its lines. */
export interface CopiedPassage {
  text: string;
  span: Span;
  position: number;
}

let last: CopiedPassage | null = null;

const normalize = (text: string) => text.replace(/\s+/g, " ").trim();

export const rememberCopy = (passage: CopiedPassage) => {
  last = { ...passage, text: normalize(passage.text) };
};

/** The passage this pasted text came from, if it was copied from the page. */
export const copiedPassage = (pasted: string): CopiedPassage | null =>
  last && normalize(pasted) === last.text ? last : null;
