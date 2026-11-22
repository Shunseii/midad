/**
 * Like a desktop app, a control clicked with the mouse doesn't keep keyboard
 * focus: otherwise the next shortcut (← to turn the page) lights up a focus
 * ring on the last button clicked, and closing its menu with Esc rings it
 * again. Focus reached with Tab stays, rings and all, and text fields keep
 * focus however they're reached, until a press lands somewhere else.
 */
const CONTROL = 'button, a[href], [role="button"], [role="slider"], [role="tab"], [role="radio"], [role="switch"], [role="checkbox"], [role="menuitem"]';

export const dropFocusFromClickedControls = () => {
  const clicked = new WeakSet<Element>();
  let tabbing = false;
  // Focus that arrives during a press is the press's own, not focus handed back; dropping it would end a scrubber drag.
  let pressing = false;

  const release = (el: Element) =>
    requestAnimationFrame(() => {
      if (document.activeElement === el && el instanceof HTMLElement) el.blur();
    });

  document.addEventListener("keydown", (e) => (tabbing = e.key === "Tab"), true);
  document.addEventListener(
    "pointerdown",
    () => {
      tabbing = false;
      pressing = true;
    },
    true,
  );
  for (const type of ["pointerup", "pointercancel"]) document.addEventListener(type, () => (pressing = false), true);
  document.addEventListener("click", (e) => {
    // A click from the keyboard (Enter or Space on a focused button) keeps focus where it is.
    if (e.detail === 0 || !(e.target instanceof Element)) return;
    const control = e.target.closest(CONTROL);
    if (!control) return;
    clicked.add(control);
    release(control);
  });
  // A press elsewhere leaves a text field, even where the page stops the press moving focus (its own text selection
  // does), which would otherwise leave the field focused without a caret and every shortcut taken for typing.
  // React's handlers run below the document, so this sees whether they prevented the default.
  // Only a field focused before the press: a press may focus one itself (the Ask box focuses its editor).
  let focusedBefore: Element | null = null;
  document.addEventListener("mousedown", () => (focusedBefore = document.activeElement), true);
  document.addEventListener("mousedown", (e) => {
    const field = document.activeElement;
    if (!e.defaultPrevented || field !== focusedBefore || !(field instanceof HTMLElement) || !(e.target instanceof Node) || field.contains(e.target)) return;
    if (field.isContentEditable || field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) field.blur();
  });
  // A menu or popover hands focus back to the button that opened it when it closes.
  document.addEventListener("focusin", (e) => {
    if (e.target instanceof Element && clicked.has(e.target) && !tabbing && !pressing) release(e.target);
  });
};
