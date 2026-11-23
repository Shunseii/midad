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
];
