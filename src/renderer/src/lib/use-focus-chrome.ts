import { useEffect, useReducer, useRef } from "react";
import { atWindowEdge, chromeHidden, type FocusChoice, focusReducer, initialFocus, msUntilChange } from "./focus";

/** Activity closer together than this is one burst; the chrome is never hidden while it lasts. */
const ACTIVITY_THROTTLE_MS = 250;

/**
 * Whether focus mode has the top bar, rail and scrubber stepped aside right now.
 * In Auto any mouse movement, click, scroll or key press brings them back, and
 * they leave again once the reader is idle. In Locked only resting the pointer
 * against the top or bottom edge of the window brings them back.
 */
export const useFocusChrome = ({ mode, held, textHeld }: { mode: FocusChoice; held: boolean; textHeld: boolean }) => {
  const [state, dispatch] = useReducer(focusReducer, 0, () => initialFocus(Date.now()));
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const input = { mode, held, textHeld, state, now: Date.now() };
  const hidden = chromeHidden(input);
  const hiddenNow = useRef(hidden);
  hiddenNow.current = hidden;

  useEffect(() => {
    if (mode !== "off") dispatch({ type: "enable", now: Date.now() });
  }, [mode]);

  useEffect(() => {
    if (mode !== "auto") return;
    let last = 0;
    const onActivity = () => {
      const now = Date.now();
      if (!hiddenNow.current && now - last < ACTIVITY_THROTTLE_MS) return;
      last = now;
      dispatch({ type: "activity", now });
    };
    const events = ["mousemove", "pointerdown", "keydown", "wheel"] as const;
    for (const e of events) window.addEventListener(e, onActivity, { passive: true });
    return () => {
      for (const e of events) window.removeEventListener(e, onActivity);
    };
  }, [mode]);

  useEffect(() => {
    if (mode !== "locked") return;
    const onMove = (e: MouseEvent) => dispatch({ type: "pointer", now: Date.now(), atEdge: atWindowEdge({ y: e.clientY, height: window.innerHeight }) });
    // Pushing past the edge into the title bar or panel still counts as holding it there.
    const onLeave = (e: MouseEvent) => {
      if (e.relatedTarget === null) onMove(e);
    };
    window.addEventListener("mousemove", onMove, { passive: true });
    document.addEventListener("mouseout", onLeave, { passive: true });
    return () => {
      window.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseout", onLeave);
      dispatch({ type: "pointer", now: Date.now(), atEdge: false });
    };
  }, [mode]);

  useEffect(() => {
    if (hidden) dispatch({ type: "hidden", now: Date.now() });
    const ms = msUntilChange({ mode, held, textHeld, state, now: Date.now() });
    if (ms === null || (hidden && mode === "auto")) return;
    const timer = setTimeout(rerender, ms);
    return () => clearTimeout(timer);
  }, [mode, held, textHeld, state, hidden]);

  return hidden;
};
