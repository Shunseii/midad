import assert from "node:assert/strict";
import { LONG_BOOK } from "../lib/fixture.mjs";
import { clickPageArea, near, openReader, pageChangedFrom } from "../lib/reader.mjs";

export const name = "Page scroll";

const SCROLLER = `(() => { for (let el = document.querySelector("[data-page-area]"); el; el = el.parentElement) { const o = getComputedStyle(el).overflowY; if ((o === "auto" || o === "scroll") && el.scrollHeight > el.clientHeight) return el; } return null; })()`;
const scrollTop = (page) => page.ev(`Math.round(${SCROLLER}.scrollTop)`);
const maxScrollTop = (page) => page.ev(`Math.round(${SCROLLER}.scrollHeight - ${SCROLLER}.clientHeight)`);
const scrollTo = async (page, top) => {
  await page.ev(`${SCROLLER}.scrollTo({ top: ${top}, behavior: "instant" })`);
  await page.sleep(300);
};
const turn = async (page, { key, from }) => {
  await page.press(key);
  await pageChangedFrom(page, from, `${key} didn't turn the page`);
  await page.sleep(300);
};

export const checks = [
  [
    "each page comes back where it was left, and a page not seen yet starts at the top",
    async (page) => {
      await openReader(page, { bookId: LONG_BOOK, position: 50 });
      assert.ok(await page.ev(`!!${SCROLLER}`), "the page area doesn't scroll at this height");
      const bottomOf50 = await maxScrollTop(page);
      await scrollTo(page, bottomOf50);
      assert.ok((await scrollTop(page)) > 100, "couldn't scroll the page down");
      await clickPageArea(page);

      await turn(page, { key: "ArrowLeft", from: 50 });
      assert.equal(await scrollTop(page), 0, "page 51, not seen yet, didn't start at the top");
      const middleOf51 = Math.round((await maxScrollTop(page)) / 2);
      await scrollTo(page, middleOf51);

      await turn(page, { key: "ArrowRight", from: 51 });
      near(await scrollTop(page), bottomOf50, 2, "page 50 didn't come back at its bottom");

      await turn(page, { key: "ArrowLeft", from: 50 });
      near(await scrollTop(page), middleOf51, 2, "page 51 didn't come back at its middle");

      await turn(page, { key: "ArrowRight", from: 51 });
      await turn(page, { key: "ArrowRight", from: 50 });
      assert.equal(await scrollTop(page), 0, "page 49, not seen yet, didn't start at the top when going back to it");
    },
  ],
  [
    "a remembered place holds its word when the text size changed in between",
    async (page) => {
      await openReader(page, { bookId: LONG_BOOK, position: 60 });
      await scrollTo(page, 500);
      const topWord = `(() => { const v = ${SCROLLER}.getBoundingClientRect(); const w = [...document.querySelectorAll("[data-page-area] [data-w]")].find((el) => el.getBoundingClientRect().top >= v.top); return w ? w.dataset.line + ":" + w.dataset.w : null; })()`;
      const before = await page.ev(topWord);
      assert.ok(before, "no word at the top of page 60");
      await clickPageArea(page);
      await turn(page, { key: "ArrowLeft", from: 60 });
      await page.press("=", { code: "Equal", ctrl: true });
      await page.sleep(400);
      await turn(page, { key: "ArrowRight", from: 61 });
      assert.notEqual(await scrollTop(page), 500, "the text size didn't change the layout, so this check proves nothing");
      assert.equal(await page.ev(topWord), before, "page 60 came back at a different word after zooming");
      await page.press("0", { code: "Digit0", ctrl: true });
      await page.sleep(400);
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
