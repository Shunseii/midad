import assert from "node:assert/strict";
import { LONG_BOOK, LONG_PAGES } from "../lib/fixture.mjs";
import { SLIDER, clickPageArea, near, openReader, tabTo } from "../lib/reader.mjs";

export const name = "Contents";

const LIST_SCROLLER = `document.querySelector("[data-entry]").closest(".overflow-y-auto")`;

/** Where the current entry sits in the list's viewport. */
const currentEntry = (page) =>
  page.ev(`(() => {
    const cur = document.querySelector("[data-entry][aria-current]");
    if (!cur) return null;
    const v = ${LIST_SCROLLER}.getBoundingClientRect(), a = cur.getBoundingClientRect();
    return { visible: a.top >= v.top - 1 && a.bottom <= v.bottom + 1, text: cur.textContent.trim() };
  })()`);

/** The highlight behind the current entries against the entries themselves. */
const highlightOffset = (page) =>
  page.ev(`(() => {
    const cur = [...document.querySelectorAll("[data-entry][aria-current]")];
    const hl = cur[0]?.parentElement.querySelector("span[aria-hidden].bg-accent-soft");
    if (!hl) return null;
    const a = cur[0].getBoundingClientRect(), z = cur.at(-1).getBoundingClientRect(), b = hl.getBoundingClientRect();
    return { top: Math.round(b.top - a.top), height: Math.round(b.height - (z.bottom - a.top)), width: Math.round(a.width), entryTop: cur[0].offsetTop, entryHeight: Math.round(z.bottom - a.top) };
  })()`);

const focusScrubber = async (page) => {
  await clickPageArea(page);
  await tabTo(page, SLIDER, { backward: true });
};

export const checks = [
  [
    "the current entry is scrolled into view after End jumps to the last page",
    async (page) => {
      await openReader(page, { bookId: LONG_BOOK, position: 8 });
      await page.waitFor(`document.querySelectorAll("[data-entry]").length > 20`, { message: "the contents list didn't load" });
      assert.ok(await page.ev(`${LIST_SCROLLER}.scrollHeight > ${LIST_SCROLLER}.clientHeight`), "the contents list should scroll for this check");
      await focusScrubber(page);
      await page.press("End");
      await page.waitFor(`location.hash.endsWith("p=${LONG_PAGES}")`, { message: "End didn't go to the last page" });
      await page.waitFor(`(() => { const c = document.querySelector("[data-entry][aria-current]"); if (!c) return false; const v = ${LIST_SCROLLER}.getBoundingClientRect(), a = c.getBoundingClientRect(); return a.top >= v.top - 1 && a.bottom <= v.bottom + 1; })()`, {
        timeout: 2500,
        message: "the current entry stayed out of view",
      });
      const entry = await currentEntry(page);
      assert.match(entry.text, /باب 30/, "the last page's entry is the last chapter");
    },
  ],
  [
    "Home goes to page 1, before the first heading, and the list scrolls back to the top",
    async (page) => {
      assert.ok(await page.ev(`${LIST_SCROLLER}.scrollTop > 0`), "needs the list scrolled down by the previous check");
      await page.press("Home");
      await page.waitFor(`location.hash.endsWith("p=1")`, { message: "Home didn't go to page 1" });
      await page.waitFor(`${LIST_SCROLLER}.scrollTop === 0`, { timeout: 2500, message: "the list didn't scroll back to the top" });
      assert.equal(await currentEntry(page), null, "no entry is current before the first heading");
    },
  ],
  [
    "the highlight stays on the current entry while the panel is resized",
    async (page) => {
      // Page 56 opens chapter 6, whose long title wraps, after chapter 3's long title.
      await openReader(page, { bookId: LONG_BOOK, position: 56 });
      await page.waitFor(`!!document.querySelector("[data-entry][aria-current]")`, { message: "no current entry on page 56" });
      await page.sleep(600);
      const start = await highlightOffset(page);
      assert.ok(start, "no highlight behind the current entry");
      assert.deepEqual([start.top, start.height], [0, 0], `misaligned before resizing: ${JSON.stringify(start)}`);
      const handle = await page.rectOf(`nav [aria-label="Resize panel"]`);
      const from = { x: handle.cx, y: handle.cy };
      await page.drag({ from, to: { x: from.x - 70, y: from.y } });
      await page.sleep(400);
      const narrower = await highlightOffset(page);
      assert.ok(narrower.width < start.width, `the panel didn't get narrower: ${start.width} → ${narrower.width}`);
      near(narrower.top, 0, 1, "highlight top after narrowing");
      near(narrower.height, 0, 1, "highlight height after narrowing");
      const moved = await page.rectOf(`nav [aria-label="Resize panel"]`);
      await page.drag({ from: { x: moved.cx, y: moved.cy }, to: { x: moved.cx + 140, y: moved.cy } });
      await page.sleep(400);
      const wider = await highlightOffset(page);
      assert.ok(wider.width > start.width, `the panel didn't get wider: ${start.width} → ${wider.width}`);
      near(wider.top, 0, 1, "highlight top after widening");
      near(wider.height, 0, 1, "highlight height after widening");
      assert.ok(wider.entryTop !== narrower.entryTop || wider.entryHeight !== narrower.entryHeight, "resizing should rewrap the titles, or this check proves nothing");
    },
  ],
];
