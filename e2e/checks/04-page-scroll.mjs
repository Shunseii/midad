import assert from "node:assert/strict";
import { LONG_BOOK } from "../lib/fixture.mjs";
import { clickPageArea, openReader, pageChangedFrom } from "../lib/reader.mjs";

export const name = "Page scroll";

const SCROLLER = `(() => { for (let el = document.querySelector("[data-page-area]"); el; el = el.parentElement) { const o = getComputedStyle(el).overflowY; if ((o === "auto" || o === "scroll") && el.scrollHeight > el.clientHeight) return el; } return null; })()`;
const scrollTop = (page) => page.ev(`Math.round(${SCROLLER}.scrollTop)`);
const scrollTo = async (page, top) => {
  await page.ev(`${SCROLLER}.scrollTo({ top: ${top}, behavior: "instant" })`);
  await page.sleep(300);
};

export const checks = [
  [
    "a page turn starts at the top of the new page",
    async (page) => {
      await openReader(page, { bookId: LONG_BOOK, position: 50 });
      assert.ok(await page.ev(`!!${SCROLLER}`), "the page area doesn't scroll at this height");
      await scrollTo(page, 400);
      assert.ok((await scrollTop(page)) > 100, "couldn't scroll the page down");
      await clickPageArea(page);
      await page.press("ArrowLeft");
      await pageChangedFrom(page, 50, "← didn't turn the page");
      await page.waitFor(`${SCROLLER}.scrollTop === 0`, { timeout: 2000, message: "the next page didn't start at the top" });
      await scrollTo(page, 300);
      await page.press("ArrowRight");
      await pageChangedFrom(page, 51, "→ didn't turn the page");
      await page.waitFor(`${SCROLLER}.scrollTop === 0`, { timeout: 2000, message: "the previous page didn't start at the top" });
    },
  ],
  [
    "Settings from the Display menu and Esc back keeps the place on the page",
    async (page) => {
      await openReader(page, { bookId: LONG_BOOK, position: 50 });
      await scrollTo(page, 350);
      const before = await scrollTop(page);
      await page.click('[aria-label="Display"]');
      await page.waitFor(`!!document.querySelector("[data-slot=popover-content]")`, { message: "the Display menu didn't open" });
      const allSettings = `js:[...document.querySelectorAll("[data-slot=popover-content] button, [data-slot=popover-content] a")].find((b) => /settings/i.test(b.textContent))`;
      await page.waitStill(allSettings);
      await page.click(allSettings);
      await page.waitFor(`location.hash.includes("settings")`, { message: "didn't reach Settings" });
      await page.sleep(600);
      await page.press("Escape");
      await page.waitFor(`location.hash.includes("/read/")`, { message: "Esc didn't go back to the book" });
      await page.waitFor(`!!document.querySelector("[data-page-area] [data-w]")`);
      await page.sleep(800);
      const after = await scrollTop(page);
      assert.ok(Math.abs(after - before) <= 2, `scroll position changed: ${before} before Settings, ${after} after`);
      assert.match(await page.ev("location.hash"), /p=50/, "came back to a different page");
    },
  ],
];
