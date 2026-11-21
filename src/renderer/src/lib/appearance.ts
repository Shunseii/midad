import { useCallback, useEffect } from "react";
import type { Theme } from "../../../shared/ipc";
import { type FocusChoice, focusChoiceFromLegacy, type FocusKind, toggledFocus } from "./focus";
import { midad } from "./midad";
import { type GlossMode, glossModeFrom, type NoteIcons, noteIconsFrom } from "./mark-prefs";
import { readPref, usePref } from "./prefs";

export type PageWidth = "narrow" | "wide";
/** Under: a band below the letters, clear of the harakat above. Behind: a fill over the word's full height. */
export type HighlightStyle = "under" | "behind";
export type { GlossMode, NoteIcons } from "./mark-prefs";

export const useTheme = () => usePref<Theme>({ key: "appearance.theme", fallback: "system" });
export const usePageWidth = () => usePref<PageWidth>({ key: "reader.pageWidth", fallback: "narrow" });
export const useHighlightStyle = () => usePref<HighlightStyle>({ key: "reader.highlightStyle", fallback: "under" });
export const useNoteIcons = () => {
  const [stored, set] = usePref<unknown>({ key: "reader.noteIcons", fallback: "corners" });
  return [noteIconsFrom(stored), set as (next: NoteIcons) => void] as const;
};

export const GLOSS_MODES: { value: GlossMode; label: string }[] = [
  { value: "under", label: "Under the words" },
  { value: "hover", label: "On hover" },
  { value: "hidden", label: "Hidden" },
];

export const GLOSS_HINTS: Record<GlossMode, string> = {
  under: "Interlinear glosses printed small under their words, as the book does",
  hover: "A word's gloss shows while you point at it",
  hidden: "Interlinear glosses aren't shown",
};

const GLOSS_FALLBACK = glossModeFrom({ stored: null, legacyMarkers: readPref<unknown>({ key: "reader.glossMarkers", fallback: true }) });
export const useGlossMode = () => {
  const [stored, set] = usePref<unknown>({ key: "reader.glosses", fallback: GLOSS_FALLBACK });
  return [glossModeFrom({ stored, legacyMarkers: true }), set as (next: GlossMode) => void] as const;
};

const FOCUS_FALLBACK = focusChoiceFromLegacy(readPref<unknown>({ key: "reader.focusMode", fallback: false }));

/**
 * Focus mode as Off, Auto or Locked, and the kind the menu's switch and F turn
 * on. Choosing Auto or Locked in Settings also makes it the kind they turn on.
 */
export const useFocusMode = () => {
  const [choice, setChoiceRaw] = usePref<FocusChoice>({ key: "reader.focus", fallback: FOCUS_FALLBACK });
  const [kind, setKind] = usePref<FocusKind>({ key: "reader.focusKind", fallback: FOCUS_FALLBACK === "off" ? "auto" : FOCUS_FALLBACK });
  const setChoice = useCallback(
    (next: FocusChoice) => {
      if (next !== "off") setKind(next);
      setChoiceRaw(next);
    },
    [setKind, setChoiceRaw],
  );
  const toggle = useCallback(() => setChoiceRaw(toggledFocus({ choice, kind })), [choice, kind, setChoiceRaw]);
  return { choice, kind, setChoice, toggle };
};

/** Applies the chosen theme to the page and tells the main process, which colours the window to match. */
export const ThemeSync = () => {
  const [theme] = useTheme();
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") delete root.dataset.theme;
    else root.dataset.theme = theme;
    // A main process started before this channel existed has no handler; the page theme still applies.
    midad["app.setTheme"]?.({ theme }).catch(() => undefined);
  }, [theme]);
  return null;
};
