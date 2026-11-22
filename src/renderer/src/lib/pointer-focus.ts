/**
 * Like a desktop app, a control clicked with the mouse doesn't keep keyboard
 * focus: otherwise the next shortcut (← to turn the page) lights up a focus
 * ring on the last button clicked, and closing its menu with Esc rings it
 * again. Focus reached with Tab stays, rings and all, and text fields keep
 * focus however they're reached.
 */
const CONTROL = 'button, a[href], [role="button"], [role="slider"], [role="tab"], [role="radio"], [role="switch"], [role="checkbox"], [role="menuitem"]';

export const dropFocusFromClickedControls = () => {
  const clicked = new WeakSet<Element>();
  let tabbing = false;

  const release = (el: Element) =>
    requestAnimationFrame(() => {
      if (document.activeElement === el && el instanceof HTMLElement) el.blur();
    });

  document.addEventListener("keydown", (e) => (tabbing = e.key === "Tab"), true);
  document.addEventListener("pointerdown", () => (tabbing = false), true);
  document.addEventListener("click", (e) => {
    // A click from the keyboard (Enter or Space on a focused button) keeps focus where it is.
    if (e.detail === 0 || !(e.target instanceof Element)) return;
    const control = e.target.closest(CONTROL);
    if (!control) return;
    clicked.add(control);
    release(control);
  });
  // A menu or popover hands focus back to the button that opened it when it closes.
  document.addEventListener("focusin", (e) => {
    if (e.target instanceof Element && clicked.has(e.target) && !tabbing) release(e.target);
  });
};
