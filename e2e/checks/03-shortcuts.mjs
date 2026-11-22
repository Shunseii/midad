import assert from "node:assert/strict";
import { LONG_BOOK } from "../lib/fixture.mjs";
import { clickPageArea, currentPage, openReader, shortcutsOpen } from "../lib/reader.mjs";

export const name = "Shortcuts dialog";

const question = (page) => page.press("?", { code: "Slash", shift: true });
const waitOpen = (page, where) => page.waitFor(`!!document.querySelector("[data-slot=dialog-content]")`, { timeout: 2000, message: `'?' didn't open the shortcuts in ${where}` });
const waitClosed = (page, how) => page.waitFor(`!document.querySelector("[data-slot=dialog-content]")`, { timeout: 2000, message: `${how} didn't close the shortcuts` });

export const checks = [
  [
    "in the reader: '?' opens, ← and Esc don't reach the page, '?' and Esc close",
    async (page) => {
      await openReader(page, { bookId: LONG_BOOK, position: 50 });
      await clickPageArea(page);
      await question(page);
      await waitOpen(page, "the reader");
      await page.press("ArrowLeft");
      await page.sleep(300);
      assert.equal(await currentPage(page), 50, "← turned the page behind the dialog");
      await question(page);
      await waitClosed(page, "'?'");
      await question(page);
      await waitOpen(page, "the reader");
      await page.press("Escape");
      await waitClosed(page, "Esc");
      await page.sleep(300);
      assert.match(await page.ev("location.hash"), /#\/read\//, "Esc left the reader");
      assert.equal(await currentPage(page), 50, "Esc changed the page");
    },
  ],
  [
    "'؟' (Arabic layout, Shift+Slash) opens it too",
    async (page) => {
      await clickPageArea(page);
      await page.press("؟", { code: "Slash", shift: true });
      await waitOpen(page, "the reader with an Arabic layout");
      await page.press("Escape");
      await waitClosed(page, "Esc");
    },
  ],
  [
    "in the library",
    async (page) => {
      await page.go("#/", `!!document.querySelector("[data-book]")`);
      await page.sleep(300);
      await question(page);
      await waitOpen(page, "the library");
      await page.press("Escape");
      await waitClosed(page, "Esc");
      assert.equal(await page.ev("location.hash"), "#/");
    },
  ],
  [
    "in settings",
    async (page) => {
      await page.go("#/settings", `document.body.innerText.includes("Focus mode")`);
      await page.sleep(300);
      await question(page);
      await waitOpen(page, "settings");
      await page.press("Escape");
      await waitClosed(page, "Esc");
      await page.sleep(300);
      assert.equal(await shortcutsOpen(page), false);
      assert.match(await page.ev("location.hash"), /settings/, "Esc closing the dialog also left settings");
    },
  ],
];
