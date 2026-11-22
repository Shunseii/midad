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
];
