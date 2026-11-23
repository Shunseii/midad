import { useEffect, useReducer, useRef, useState } from "react";
import { chromeHidden, type FocusChoice, focusReducer, initialFocus, msUntilChange, pointerAtEdge } from "./focus";

/** Activity closer together than this is one burst; the chrome is never hidden while it lasts. */
const ACTIVITY_THROTTLE_MS = 250;

/**
 * Whether focus mode has the top bar, rail and scrubber stepped aside right now.
 * In Auto any mouse movement, click, scroll or key press brings them back, and
 * they leave again once the reader is idle. In Locked only resting the pointer
 * against an edge of the window, or pushing it out past one, brings them back.
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
      // The pointer crossing the window while another app has focus isn't the reader coming back.
      if (!document.hasFocus()) return;
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
    const report = ({ e, leftWindow }: { e: MouseEvent; leftWindow: boolean }) =>
      dispatch({
        type: "pointer",
        now: Date.now(),
        atEdge: pointerAtEdge({ x: e.clientX, y: e.clientY, width: window.innerWidth, height: window.innerHeight, buttons: e.buttons, leftWindow }),
      });
    const onMove = (e: MouseEvent) => {
      if (document.hasFocus()) report({ e, leftWindow: false });
    };
    // Pushing past the edge into the title bar, a panel or the dock still counts as holding it there,
    // but not leaving for another window: switching apps moves the pointer out too.
    const onLeave = (e: MouseEvent) => {
      if (e.relatedTarget === null && document.hasFocus()) report({ e, leftWindow: true });
    };
    const onBlur = () => dispatch({ type: "pointer", now: Date.now(), atEdge: false });
    window.addEventListener("blur", onBlur);
    // Capture, so nothing on the page can keep a move from us by stopping it on the way up.
    window.addEventListener("mousemove", onMove, { passive: true, capture: true });
    window.addEventListener("mouseout", onLeave, { passive: true, capture: true });
    return () => {
      window.removeEventListener("mousemove", onMove, { capture: true });
      window.removeEventListener("mouseout", onLeave, { capture: true });
      window.removeEventListener("blur", onBlur);
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

/** The value as it was when the chrome last showed: what is laid out, while a change waits for the chrome to come back. */
export const useSteadyWhileHidden = <T>({ value, hidden }: { value: T; hidden: boolean }): T => {
  const [shown, setShown] = useState(value);
  if (!hidden && shown !== value) setShown(value);
  return hidden ? shown : value;
};
