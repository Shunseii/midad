import assert from "node:assert/strict";
import { LONG_BOOK } from "../lib/fixture.mjs";
import { openReader } from "../lib/reader.mjs";

export const name = "Launch";

const path = (page) => page.ev(`location.hash.split("?")[0]`);

/**
 * Starts the app again the way a launch does: at the library route, with the stored preferences.
 * replaceState moves to the library without the router noticing, so the app is still "closed" where it was.
 */
const relaunch = async (page) => {
  await page.ev(`history.replaceState(null, "", "#/"); location.reload()`);
  await page.sleep(300);
  await page.waitFor(`document.readyState === "complete" && !!document.querySelector("#root > *")`, { timeout: 8000, message: "the app didn't come back after reload" });
  await page.sleep(500);
};

export const checks = [
  [
    "with Continue reading on, closing in a book reopens that book",
    async (page) => {
      await page.ev(`localStorage.setItem("midad.reader.onLaunch", JSON.stringify("continue"))`);
      await openReader(page, { bookId: LONG_BOOK, position: 10 });
      await page.sleep(800);
      await relaunch(page);
      assert.equal(await path(page), `#/read/${LONG_BOOK}`);
    },
  ],
  [
    "with Continue reading on, closing in the library reopens the library",
    async (page) => {
      await page.go("#/", `!!document.querySelector("[data-book]")`);
      await page.sleep(300);
      await relaunch(page);
      assert.equal(await path(page), "#/");
    },
  ],
  [
    "reopening into the book keeps Ask AI open; opening a book from the library doesn't",
    async (page) => {
      const askOpen = () => page.ev(`localStorage.getItem("midad.reader.panelOpen") === "true" && localStorage.getItem("midad.reader.panelTab") === JSON.stringify("ask")`);
      await openReader(page, { bookId: LONG_BOOK, position: 10 });
      await page.click('[aria-label^="Ask AI"]');
      await page.waitFor(`!!document.querySelector("[role=textbox][aria-multiline]")`, { message: "Ask AI didn't open" });
      await page.sleep(500);
      await relaunch(page);
      assert.equal(await path(page), `#/read/${LONG_BOOK}`);
      await page.sleep(500);
      assert.ok(await askOpen(), "Ask AI was closed after reopening");
      await page.click('[aria-label^="Back"], a[href="#/"]');
      await page.waitFor(`!!document.querySelector("[data-book]")`, { message: "didn't get back to the library" });
      await page.sleep(900);
      await page.click(`[data-book="${LONG_BOOK}"] a, a[data-book="${LONG_BOOK}"]`);
      await page.waitFor(`location.hash.startsWith("#/read/")`, { message: "the book didn't open" });
      await page.sleep(900);
      assert.equal(await askOpen(), false, "Ask AI stayed open when opening the book from the library");
    },
  ],
];
