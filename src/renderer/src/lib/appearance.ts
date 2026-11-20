import { useEffect } from "react";
import type { Theme } from "../../../shared/ipc";
import { midad } from "./midad";
import { usePref } from "./prefs";

export type PageWidth = "narrow" | "wide";

export const useTheme = () => usePref<Theme>({ key: "appearance.theme", fallback: "system" });
export const usePageWidth = () => usePref<PageWidth>({ key: "reader.pageWidth", fallback: "narrow" });
export const useFocusMode = () => usePref<boolean>({ key: "reader.focusMode", fallback: false });

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
