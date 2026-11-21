/**
 * While a view transition plays, its snapshots cover the window and every
 * press lands on the root element instead of the control under the pointer.
 * A press that starts during a transition skips it, which puts the live page
 * back under the pointer at once, and goes to the control there: the press
 * now, and the click it ends in.
 */
export const passPressesThroughTransitions = () => {
  let pressed: Element | null = null;

  const onPointerDown = (e: PointerEvent) => {
    if (!e.isTrusted) return;
    const transition = document.activeViewTransition;
    pressed = null;
    if (!transition || e.target !== document.documentElement) return;
    transition.skipTransition();
    const under = document.elementFromPoint(e.clientX, e.clientY);
    if (!under || under === document.documentElement) return;
    // Stops the real mousedown too, whose default would move focus to the page and end a scrubber drag at once.
    e.preventDefault();
    e.stopImmediatePropagation();
    pressed = under;
    under.dispatchEvent(new PointerEvent("pointerdown", e));
    under.dispatchEvent(new MouseEvent("mousedown", e));
  };

  // The real click goes to what the press and release share, the root; hand it to the control that was pressed.
  const onClick = (e: MouseEvent) => {
    if (!e.isTrusted) return;
    const target = pressed;
    pressed = null;
    if (!target || e.target !== document.documentElement) return;
    e.stopImmediatePropagation();
    target.dispatchEvent(new MouseEvent("click", e));
  };

  window.addEventListener("pointerdown", onPointerDown, { capture: true });
  window.addEventListener("click", onClick, { capture: true });
  return () => {
    window.removeEventListener("pointerdown", onPointerDown, { capture: true });
    window.removeEventListener("click", onClick, { capture: true });
  };
};
