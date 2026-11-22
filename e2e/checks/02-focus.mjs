import assert from "node:assert/strict";
import { LONG_BOOK } from "../lib/fixture.mjs";
import { clickPageArea, currentPage, focusRing, openReader, pageChangedFrom, shortcutsOpen } from "../lib/reader.mjs";

export const name = "Focus";

export const checks = [
  [
    "after clicking a header button, ← turns the page without a focus ring",
    async (page) => {
      await openReader(page, { bookId: LONG_BOOK, position: 50 });
      await page.click('[aria-label^="Bookmark page"]');
      await page.sleep(300);
      await page.press("ArrowLeft");
      const after = await pageChangedFrom(page, 50, "← after clicking the bookmark button didn't turn the page");
      assert.equal(after, 51, "← is the next page");
      await page.sleep(200);
      assert.equal(await focusRing(page), null, "a focus ring showed");
    },
  ],
  [
    "closing the Display menu with Esc leaves no focus ring",
    async (page) => {
      await openReader(page, { bookId: LONG_BOOK, position: 50 });
      await page.click('[aria-label="Display"]');
      await page.waitFor(`!!document.querySelector("[data-slot=popover-content]")`, { message: "the Display menu didn't open" });
      await page.press("Escape");
      await page.waitFor(`!document.querySelector("[data-slot=popover-content]")`, { message: "Esc didn't close the Display menu" });
      await page.sleep(200);
      assert.equal(await focusRing(page), null, "a focus ring showed");
    },
  ],
  [
    "Tab shows a focus ring",
    async (page) => {
      await openReader(page, { bookId: LONG_BOOK, position: 50 });
      await clickPageArea(page);
      await page.press("Tab");
      await page.sleep(150);
      assert.notEqual(await focusRing(page), null, "Tab didn't show a focus ring");
    },
  ],
  [
    "the Find field keeps focus and types '?'",
    async (page) => {
      await openReader(page, { bookId: LONG_BOOK, position: 50 });
      await page.click('[aria-label^="Find on page"]');
      await page.waitFor(`document.activeElement?.tagName === "INPUT"`, { message: "Find didn't focus its field" });
      await page.press("?", { code: "Slash", shift: true });
      await page.sleep(200);
      assert.equal(await page.ev(`document.activeElement?.tagName`), "INPUT", "the Find field lost focus");
      assert.equal(await page.ev(`document.activeElement.value`), "?", "'?' wasn't typed into the field");
      assert.equal(await shortcutsOpen(page), false, "'?' in a text field opened the shortcuts");
      assert.equal(await currentPage(page), 50, "typing turned the page");
      await page.press("Escape");
    },
  ],
];
