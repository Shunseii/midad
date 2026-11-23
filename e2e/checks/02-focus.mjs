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
    "clicking the page leaves the Ask AI input, so shortcuts work again",
    async (page) => {
      const composer = '[role=textbox][aria-multiline]';
      await openReader(page, { bookId: LONG_BOOK, position: 50 });
      await page.click('[aria-label^="Ask AI"]');
      await page.waitFor(`!!document.querySelector('${composer}')`, { message: "Ask AI didn't open" });
      await page.waitStill(composer);
      await page.click(composer);
      await page.waitFor(`document.activeElement?.matches('${composer}')`, { message: "clicking the Ask AI input didn't focus it" });
      // In the margin beside a line: a press near the text starts the page's own drag selection, which stops the
      // browser moving focus.
      const area = await page.rectOf("[data-page-area]");
      const word = await page.rectOf("[data-w]");
      await page.clickAt(area.x + 12, word.y + word.height / 2);
      await page.sleep(150);
      assert.equal(await page.ev(`document.activeElement?.matches('${composer}') ?? false`), false, "the Ask AI input kept focus after clicking the page");
      await page.press("ArrowLeft");
      assert.equal(await pageChangedFrom(page, 50, "← after leaving the Ask AI input didn't turn the page"), 51, "← is the next page");
      await page.click('[aria-label^="Ask AI"]');
    },
  ],
  [
    "Escape leaves the Ask AI input, keeping the draft and the panel open",
    async (page) => {
      const composer = '[role=textbox][aria-multiline]';
      await openReader(page, { bookId: LONG_BOOK, position: 50 });
      await page.click('[aria-label^="Ask AI"]');
      await page.waitFor(`!!document.querySelector('${composer}')`, { message: "Ask AI didn't open" });
      await page.waitStill(composer);
      await page.click(composer);
      await page.type("half a question");
      await page.press("Escape");
      await page.sleep(150);
      assert.equal(await page.ev(`document.activeElement?.matches('${composer}') ?? false`), false, "Escape didn't leave the Ask AI input");
      assert.equal(await page.ev(`document.querySelector('${composer}')?.innerText.trim()`), "half a question", "Escape lost the draft");
      assert.ok(await page.ev(`!!document.querySelector('${composer}')`), "Escape closed the panel");
      await page.press("ArrowLeft");
      assert.equal(await pageChangedFrom(page, 50, "← after Escape didn't turn the page"), 51, "← is the next page");
      await page.click('[aria-label^="Ask AI"]');
    },
  ],
  [
    "pressing the Ask AI box's padding keeps the input focused",
    async (page) => {
      const composer = '[role=textbox][aria-multiline]';
      await openReader(page, { bookId: LONG_BOOK, position: 50 });
      await page.click('[aria-label^="Ask AI"]');
      await page.waitFor(`!!document.querySelector('${composer}')`, { message: "Ask AI didn't open" });
      await page.waitStill(composer);
      await page.click(composer);
      const box = await page.rectOf("[data-field-box]");
      // Twice: the first press focuses it, the second must not take focus away.
      for (let i = 0; i < 2; i++) {
        await page.clickAt(box.x + 5, box.y + 4);
        await page.sleep(150);
        assert.ok(await page.ev(`document.activeElement?.matches('${composer}') ?? false`), `press ${i + 1} on the box's padding left the input`);
      }
      await page.click('[aria-label^="Ask AI"]');
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
