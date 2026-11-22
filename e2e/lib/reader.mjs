import assert from "node:assert/strict";

export const SLIDER = "[role=slider][aria-label=Page]";

/** Opens a book in the reader at a page and waits for the page text and scrubber. */
export const openReader = async (page, { bookId, position }) => {
  await page.go(`#/read/${bookId}?p=${position}`, `!!document.querySelector('${SLIDER}') && !!document.querySelector('[data-page-area] [data-w]')`);
  await page.sleep(400);
};

/** The reader's current page position, from the URL. */
export const currentPage = (page) => page.ev(`Number(new URLSearchParams(location.hash.split("?")[1] ?? "").get("p") ?? NaN)`);

/** Waits for the page position to change from `from`, returning the new one. */
export const pageChangedFrom = async (page, from, message) => {
  await page.waitFor(`Number(new URLSearchParams(location.hash.split("?")[1] ?? "").get("p")) !== ${from}`, { timeout: 3000, message });
  return currentPage(page);
};

/** The point at a fraction of the scrubber's length, measured from its left end. */
export const scrubberPoint = async (page, fraction) => {
  const r = await page.rectOf(SLIDER);
  return { x: r.x + r.width * fraction, y: r.cy };
};

/** Describes the element showing a focus ring, or null when none does. */
export const focusRing = (page) =>
  page.ev(`(() => { const el = document.querySelector(":focus-visible"); return el ? (el.getAttribute("aria-label") ?? el.tagName.toLowerCase()) : null; })()`);

/** A button, tab or link whose visible text is `text` (or, with `partial`, contains it). */
export const buttonByText = (text, { partial = false } = {}) =>
  `js:[...document.querySelectorAll("button, [role=radio], [role=tab], a")].find((b) => ${partial ? `b.textContent.includes(${JSON.stringify(text)})` : `b.textContent.trim() === ${JSON.stringify(text)}`})`;

/** Clicks an empty spot of the page area, away from words and controls. */
export const clickPageArea = async (page) => {
  const r = await page.rectOf("[data-page-area]");
  await page.clickAt(r.x + 12, r.y + r.height - 140);
  await page.sleep(150);
};

export const shortcutsOpen = (page) => page.ev(`!!document.querySelector("[data-slot=dialog-content]")`);

export const near = (actual, expected, tolerance, message) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: expected ${expected} ±${tolerance}, got ${actual}`);

/** Presses Tab until the element matching `selector` has focus, as a keyboard user would reach it. */
export const tabTo = async (page, selector, { max = 60, backward = false } = {}) => {
  for (let i = 0; i < max; i++) {
    if (await page.ev(`document.activeElement?.matches(${JSON.stringify(selector)}) ?? false`)) return;
    await page.press("Tab", { shift: backward });
  }
  throw new Error(`Tab never reached ${selector}`);
};
