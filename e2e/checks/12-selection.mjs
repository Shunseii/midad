import assert from "node:assert/strict";
import { LONG_BOOK } from "../lib/fixture.mjs";
import { openReader } from "../lib/reader.mjs";

export const name = "Selection";

const word = (line, w) => `[data-part=matn][data-line="${line}"][data-w="${w}"]`;
/** The selected words, as "line:word". */
const selectedWords = (page) =>
  page.ev(`[...document.querySelectorAll("[data-part=matn][data-w][data-in-selection]")].map((w) => w.dataset.line + ":" + w.dataset.w)`);
/** Spaces still painted in the selection colour, by attribute or by a fading background. */
const paintedSpaces = (page) =>
  page.ev(`[...document.querySelectorAll("[data-part=matn] [data-space], [data-space]")].filter((s) => { const c = getComputedStyle(s); return c.boxShadow !== "none" || (c.backgroundColor !== "rgba(0, 0, 0, 0)" && c.backgroundColor !== "transparent"); }).length`);

/** Drags across line 2 from its third word to its sixth (right to left). */
const selectWords = async (page) => {
  const from = await page.rectOf(word(2, 3));
  const to = await page.rectOf(word(2, 6));
  await page.drag({ from: { x: from.x + from.width - 2, y: from.cy }, to: { x: to.x + 2, y: to.cy } });
  await page.sleep(200);
};

export const checks = [
  [
    "deselecting clears the spaces between words at once, with the words",
    async (page) => {
      await openReader(page, { bookId: LONG_BOOK, position: 12 });
      await selectWords(page);
      assert.deepEqual(await selectedWords(page), ["2:3", "2:4", "2:5", "2:6"]);
      assert.ok((await paintedSpaces(page)) >= 3, "the spaces between the selected words aren't painted");
      // Sampled while the press that deselects is still down, before any fade could finish.
      const spot = await page.rectOf(word(5, 2));
      await page.move(spot.cx, spot.cy);
      await page.mouse("mousePressed", spot.cx, spot.cy, { clickCount: 1, buttons: 1 });
      await page.sleep(40);
      const words = await selectedWords(page);
      const spaces = await paintedSpaces(page);
      await page.mouse("mouseReleased", spot.cx, spot.cy, { clickCount: 1 });
      assert.deepEqual(words, [], "words still selected");
      assert.equal(spaces, 0, "spaces still painted just after deselecting");
    },
  ],
  [
    "Shift+arrows extend the selection a word at a time, then a line",
    async (page) => {
      await selectWords(page);
      // Right to left: the selection's end is at its left, so Shift+← grows it by the next word.
      await page.press("ArrowLeft", { shift: true });
      await page.sleep(100);
      assert.deepEqual(await selectedWords(page), ["2:3", "2:4", "2:5", "2:6", "2:7"]);
      await page.press("ArrowLeft", { code: "ArrowLeft", shift: true, ctrl: true });
      await page.sleep(100);
      assert.deepEqual(await selectedWords(page), ["2:3", "2:4", "2:5", "2:6", "2:7", "2:8"]);
      await page.press("ArrowRight", { shift: true });
      await page.sleep(100);
      assert.deepEqual(await selectedWords(page), ["2:3", "2:4", "2:5", "2:6", "2:7"]);
      // Each press moves a row down; line 2 wraps, so line 3 is a row or two away.
      const counts = [];
      for (let i = 0; i < 3 && !(await selectedWords(page)).some((w) => w.startsWith("3:")); i++) {
        await page.press("ArrowDown", { shift: true });
        await page.sleep(100);
        counts.push((await selectedWords(page)).length);
      }
      assert.ok((await selectedWords(page)).some((w) => w.startsWith("3:")), `Shift+↓ didn't reach line 3: ${JSON.stringify(await selectedWords(page))}`);
      assert.ok(counts.every((n, i) => n > (counts[i - 1] ?? 5)), `each Shift+↓ should grow the selection: ${JSON.stringify(counts)}`);
      await page.press("ArrowUp", { shift: true });
      await page.sleep(100);
      assert.ok((await selectedWords(page)).length < counts.at(-1), "Shift+↑ didn't shrink it back");
      assert.equal(await page.ev(`new URLSearchParams(location.hash.split("?")[1]).get("p")`), "12", "the page turned");
    },
  ],
  [
    "Shift+arrows shrink back past the starting word and keep growing the other way",
    async (page) => {
      await openReader(page, { bookId: LONG_BOOK, position: 12 });
      await page.ev(`window.getSelection().removeAllRanges()`);
      await page.sleep(600);
      const w = await page.rectOf(word(2, 5));
      await page.move(w.cx, w.cy);
      for (const n of [1, 2]) {
        await page.mouse("mousePressed", w.cx, w.cy, { clickCount: n, buttons: 1 });
        await page.sleep(40);
        await page.mouse("mouseReleased", w.cx, w.cy, { clickCount: n });
        await page.sleep(120);
      }
      await page.sleep(150);
      assert.deepEqual(await selectedWords(page), ["2:5"], `double-click didn't select the word: "${await page.ev(`window.getSelection().toString()`)}"`);
      // Leftward is forward in Arabic: grow by one, shrink back past the start, then grow the other way.
      await page.press("ArrowLeft", { shift: true });
      await page.sleep(100);
      assert.deepEqual(await selectedWords(page), ["2:5", "2:6"]);
      const steps = [];
      for (let i = 0; i < 2; i++) {
        await page.press("ArrowRight", { shift: true });
        await page.sleep(100);
        steps.push(`${(await selectedWords(page)).join(",")}|${await page.ev(`(() => { const s = getSelection(); return s.rangeCount + ":" + s.isCollapsed + ":" + (s.focusNode?.parentElement?.closest("[data-w]")?.dataset.w ?? s.focusNode?.nodeName); })()`)}`);
      }
      // As in a text field, the starting edge stays put: past it, the selection covers the words on the other side.
      assert.deepEqual(await selectedWords(page), ["2:4"], `Shift+→ didn't carry on past the starting word: ${steps.join("  ")}`);
      await page.press("ArrowRight", { shift: true });
      await page.sleep(100);
      assert.deepEqual(await selectedWords(page), ["2:3", "2:4"]);
    },
  ],
  [
    "Ctrl+A selects the page's text and nothing in the panels",
    async (page) => {
      await openReader(page, { bookId: LONG_BOOK, position: 12 });
      await page.press("a", { code: "KeyA", ctrl: true });
      await page.sleep(150);
      const all = await page.ev(`document.querySelectorAll("[data-page-area] [data-w]").length`);
      const picked = await page.ev(`document.querySelectorAll("[data-page-area] [data-w][data-in-selection]").length`);
      assert.equal(picked, all, `${picked} of ${all} words selected`);
      const text = await page.ev(`window.getSelection().toString()`);
      assert.ok(!/Contents|Bookmarks|كتاب الاختبار الطويل/.test(text), `the selection reached past the page: ${text.slice(0, 80)}`);
      await page.press("Escape");
    },
  ],
  [
    "triple-click selects the whole line, even one with a note on it",
    async (page) => {
      // Page 90 has a note on line 5, words 2-3.
      await openReader(page, { bookId: LONG_BOOK, position: 90 });
      await page.ev(`window.getSelection().removeAllRanges()`);
      await page.sleep(600);
      const w = await page.rectOf(word(5, 2));
      await page.move(w.cx, w.cy);
      for (const n of [1, 2, 3]) {
        await page.mouse("mousePressed", w.cx, w.cy, { clickCount: n, buttons: 1 });
        await page.sleep(40);
        await page.mouse("mouseReleased", w.cx, w.cy, { clickCount: n });
        await page.sleep(120);
      }
      await page.sleep(150);
      const count = await page.ev(`document.querySelectorAll('[data-part=matn][data-line="5"][data-w]').length`);
      const words = await selectedWords(page);
      assert.deepEqual(words, Array.from({ length: count }, (_, i) => `5:${i + 1}`), "not the whole line");
    },
  ],
  [
    "a new note being written stays open when the pointer moves away",
    async (page) => {
      await openReader(page, { bookId: LONG_BOOK, position: 12 });
      await page.ev(`window.getSelection().removeAllRanges()`);
      await page.sleep(400);
      await selectWords(page);
      await page.click(`js:[...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Note")`);
      await page.waitFor(`!!document.querySelector("[data-slot=popover-content] textarea, [data-slot=popover-content] [contenteditable]")`, { message: "the note editor didn't open" });
      const editor = await page.rectOf(`js:[...document.querySelectorAll("[data-slot=popover-content]")].find((p) => p.querySelector("textarea, [contenteditable]"))`);
      await page.move(editor.cx, editor.cy);
      await page.sleep(200);
      await page.move(editor.cx - 300, editor.cy + 200);
      await page.sleep(900);
      assert.ok(await page.ev(`!!document.querySelector("[data-slot=popover-content] textarea, [data-slot=popover-content] [contenteditable]")`), "the note editor closed when the pointer left it");
      await page.press("Escape");
    },
  ],
];
