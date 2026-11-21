/** The tint a revealed passage takes for a moment: held, then faded out. */
const REVEAL_TINT: Keyframe[] = [
  { backgroundColor: "var(--color-accent-soft)" },
  { backgroundColor: "var(--color-accent-soft)", offset: 0.6 },
  { backgroundColor: "transparent" },
];

/**
 * Tints words for a moment, along with the spaces between neighbouring words
 * so the tint reads as one band. Each word sits in a wrapper with any gloss ring
 * after it; a space is the wrapper's next sibling.
 */
export const tintWords = (words: HTMLElement[]) => {
  words.forEach((el, i) => {
    const wrapper = el.parentElement;
    const glossRings = wrapper ? [...wrapper.children].filter((c): c is HTMLElement => c !== el && c instanceof HTMLElement) : [];
    const gap = wrapper?.nextElementSibling;
    const nextWrapper = words[i + 1]?.parentElement;
    const tinted = [el, ...glossRings, ...(gap && nextWrapper && gap.nextElementSibling === nextWrapper ? [gap] : [])];
    for (const target of tinted) target.animate(REVEAL_TINT, { duration: 3000, easing: "ease-out" });
  });
};

/** Scrolls an element to the middle of its scroll area, at once under reduced motion. */
export const scrollToMiddle = (el: Element | null | undefined) =>
  el?.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
