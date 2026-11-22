import { type FocusEvent, useEffect, useRef, useState } from "react";

const CHROME = "[data-chrome]";

const isTextEntry = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el.isContentEditable);

/**
 * Whether the pointer or keyboard is in the bars, rail or panels, for focus mode
 * to keep them up. Spread `props` on each of them.
 *
 * A view transition (switching a list's tab, turning the page) covers the window
 * with its snapshots, so the pointer seems to leave whatever it is over, though
 * it never moved. A leave during a transition is checked again once it has
 * finished, against what is under the pointer then.
 *
 * Keyboard focus holds them when it got there by Tab, or when it is in a field,
 * so a question or note being typed doesn't vanish when the pointer wanders off.
 */
export const useChromeHover = () => {
  const [pointerIn, setPointerIn] = useState(false);
  const [keyboardIn, setKeyboardIn] = useState(false);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const tabbing = useRef(false);

  useEffect(() => {
    const onMove = (e: MouseEvent) => (pointer.current = { x: e.clientX, y: e.clientY });
    const onKey = (e: KeyboardEvent) => (tabbing.current = e.key === "Tab");
    const onPointer = () => (tabbing.current = false);
    window.addEventListener("mousemove", onMove, { passive: true, capture: true });
    window.addEventListener("keydown", onKey, { capture: true });
    window.addEventListener("pointerdown", onPointer, { capture: true });
    return () => {
      window.removeEventListener("mousemove", onMove, { capture: true });
      window.removeEventListener("keydown", onKey, { capture: true });
      window.removeEventListener("pointerdown", onPointer, { capture: true });
    };
  }, []);

  const props = {
    "data-chrome": "",
    onMouseEnter: () => setPointerIn(true),
    onMouseLeave: (e: { clientX: number; clientY: number }) => {
      const transition = document.activeViewTransition;
      if (!transition) {
        setPointerIn(false);
        return;
      }
      const left = { x: e.clientX, y: e.clientY };
      void transition.finished.finally(() => {
        const at = pointer.current ?? left;
        setPointerIn(document.elementFromPoint(at.x, at.y)?.closest(CHROME) != null);
      });
    },
    onFocus: (e: FocusEvent) => setKeyboardIn(tabbing.current || isTextEntry(e.target)),
    onBlur: () => setKeyboardIn(false),
  };

  return { pointerIn, keyboardIn, props };
};
