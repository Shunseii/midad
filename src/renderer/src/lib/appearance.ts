import { useCallback, useEffect } from "react";
import type { Theme } from "../../../shared/ipc";
import { type FocusChoice, focusChoiceFromLegacy, type FocusKind, toggledFocus } from "./focus";
import { midad } from "./midad";
import { readPref, usePref } from "./prefs";

export type PageWidth = "narrow" | "wide";
/** Under: a band below the letters, clear of the harakat above. Behind: a fill over the word's full height. */
export type HighlightStyle = "under" | "behind";
/** Words: an icon at the start of each note. Margin: one mark per row, with a count. */
export type NoteIcons = "words" | "margin";

export const useTheme = () => usePref<Theme>({ key: "appearance.theme", fallback: "system" });
export const usePageWidth = () => usePref<PageWidth>({ key: "reader.pageWidth", fallback: "narrow" });
export const useHighlightStyle = () => usePref<HighlightStyle>({ key: "reader.highlightStyle", fallback: "under" });
export const useNoteIcons = () => usePref<NoteIcons>({ key: "reader.noteIcons", fallback: "words" });

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
