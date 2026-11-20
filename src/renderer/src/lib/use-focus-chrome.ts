import { useEffect, useReducer, useRef } from "react";
import { chromeHidden, focusReducer, initialFocus, msUntilHidden } from "./focus";

/** Activity closer together than this is one burst; the chrome is never hidden while it lasts. */
const ACTIVITY_THROTTLE_MS = 250;

/**
 * Whether focus mode has the top bar and rail stepped aside right now. Any mouse
 * movement, click, scroll or key press brings them back; they leave again after
 * the reader is idle, unless something holds them.
 */
export const useFocusChrome = ({ enabled, held }: { enabled: boolean; held: boolean }) => {
  const [state, dispatch] = useReducer(focusReducer, 0, () => initialFocus(Date.now()));
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const hidden = chromeHidden({ enabled, held, state, now: Date.now() });
  const hiddenNow = useRef(hidden);
  hiddenNow.current = hidden;

  useEffect(() => {
    if (enabled) dispatch({ type: "enable", now: Date.now() });
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
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
  }, [enabled]);

  useEffect(() => {
    if (hidden) {
      dispatch({ type: "hidden" });
      return;
    }
    const ms = msUntilHidden({ enabled, held, state, now: Date.now() });
    if (ms === null) return;
    const timer = setTimeout(rerender, ms);
    return () => clearTimeout(timer);
  }, [enabled, held, state, hidden]);

  return hidden;
};
