import assert from "node:assert/strict";
import { LONG_BOOK, LONG_PAGES } from "../lib/fixture.mjs";
import { SLIDER, clickPageArea, currentPage, focusRing, tabTo, near, openReader, pageChangedFrom, scrubberPoint } from "../lib/reader.mjs";

export const name = "Scrubber";

/** The scrubber runs right to left: a point `fraction` from its left end is this page. */
const pageAt = (fraction) => Math.round((1 - fraction) * LONG_PAGES);

export const checks = [
  [
    "four clicks in a row each turn the page",
    async (page) => {
      await openReader(page, { bookId: LONG_BOOK, position: 150 });
      for (const fraction of [0.2, 0.7, 0.4, 0.9]) {
        const before = await currentPage(page);
        const p = await scrubberPoint(page, fraction);
        await page.clickAt(p.x, p.y);
        const after = await pageChangedFrom(page, before, `click at ${fraction} of the bar didn't turn the page (still ${before})`);
        near(after, pageAt(fraction), 6, `click at ${fraction} of the bar`);
        await page.sleep(250);
      }
    },
  ],
  [
    "dragging the thumb turns the page",
    async (page) => {
      await openReader(page, { bookId: LONG_BOOK, position: 30 });
      const from = await scrubberPoint(page, 0.9);
      const to = await scrubberPoint(page, 0.3);
      await page.drag({ from, to });
      const after = await pageChangedFrom(page, 30, "the drag didn't turn the page");
      near(after, pageAt(0.3), 6, "page after dragging to 0.3 of the bar");
    },
  ],
  [
    "Esc during a drag cancels it",
    async (page) => {
      await openReader(page, { bookId: LONG_BOOK, position: 30 });
      const from = await scrubberPoint(page, 0.9);
      const to = await scrubberPoint(page, 0.3);
      await page.drag({ from, to, release: false });
      assert.ok(await page.ev(`document.querySelector('${SLIDER}').hasAttribute("data-dragging")`), "the bar should be dragging before Esc");
      await page.press("Escape");
      await page.mouse("mouseReleased", to.x, to.y, { clickCount: 1 });
      await page.sleep(500);
      assert.equal(await currentPage(page), 30, "Esc should put the reader back on the page it was on");
      assert.equal(await page.ev(`document.querySelector('${SLIDER}').hasAttribute("data-dragging")`), false, "still dragging after Esc");
    },
  ],
  [
    "no keyboard hint appears when the bar is focused",
    async (page) => {
      await openReader(page, { bookId: LONG_BOOK, position: 30 });
      await clickPageArea(page);
      await tabTo(page, SLIDER, { backward: true });
      await page.sleep(400);
      assert.equal(await focusRing(page), "Page", "the bar should show a focus ring");
      const text = await page.ev(`document.querySelector('${SLIDER}').parentElement.innerText`);
      assert.doesNotMatch(text, /PgUp|PgDn|Home|Shift/, `scrubber area shows a hint: ${JSON.stringify(text)}`);
    },
  ],
  [
    "hovering a mark opens a card with exactly one page section",
    async (page) => {
      await openReader(page, { bookId: LONG_BOOK, position: 30 });
      const bar = await page.rectOf(SLIDER);
      // A note at page 160, away from the other marks.
      const mark = await page.rectOf(`js:[...document.querySelectorAll('[data-mark=note]')].sort((a, b) => a.getBoundingClientRect().x - b.getBoundingClientRect().x)[0]`);
      await page.move(bar.x + 5, bar.cy - 120);
      await page.move(mark.cx, bar.cy);
      await page.waitFor(`document.querySelector('[data-mark-preview]')?.dataset.state === "open"`, { message: "no mark card opened over the note" });
      await page.sleep(300);
      const sections = await page.ev(`[...document.querySelectorAll('[data-mark-preview] [data-mark-page]')].map((s) => s.dataset.markPage)`);
      assert.equal(sections.length, 1, `expected one page section, got ${JSON.stringify(sections)}`);
      assert.equal(sections[0], "160", "the card should show the note's page");
    },
  ],
  [
    "moving away, the mark card fades where it was",
    async (page) => {
      const card = `document.querySelector('[data-mark-preview]')`;
      assert.equal(await page.ev(`${card}.dataset.state`), "open", "needs the card open from the previous check");
      const openLeft = await page.ev(`${card}.offsetLeft`);
      const bar = await page.rectOf(SLIDER);
      await page.move(bar.x + bar.width * 0.5, bar.cy - 250);
      const samples = [];
      for (let i = 0; i < 8; i++) {
        samples.push(await page.ev(`({ state: ${card}.dataset.state, left: ${card}.offsetLeft })`));
        await page.sleep(25);
      }
      assert.ok(samples.every((s) => s.state === "closed"), `card should close: ${JSON.stringify(samples)}`);
      assert.ok(samples.every((s) => Math.abs(s.left - openLeft) <= 1), `card moved while fading (open at ${openLeft}): ${JSON.stringify(samples.map((s) => s.left))}`);
    },
  ],
];
