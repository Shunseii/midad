import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { ROOT } from "../lib/app.mjs";
import { LONG_BOOK, SHORT_BOOK } from "../lib/fixture.mjs";

export const name = "Pin book";

const CLI = join(ROOT, "out/cli/midad.mjs");
const cliBooks = (userData) =>
  JSON.parse(execFileSync(process.execPath, ["--no-warnings", CLI, "books", "--json"], { env: { ...process.env, MIDAD_DB: join(userData, "midad.db") }, stdio: "pipe" }).toString());

const card = (bookId) => `[data-shelf-card][data-book="${bookId}"]`;
const toggle = (bookId) => `${card(bookId)} [data-pin-toggle]`;
const shelf = (page) => page.ev(`[...document.querySelectorAll("[data-shelf-card]")].map((b) => b.dataset.book)`);
const continuing = (page) => page.ev(`document.querySelector("[data-book]:not([data-shelf-card])")?.dataset.book ?? null`);
const opacityOf = (page, selector) => page.ev(`Number(getComputedStyle(document.querySelector(${JSON.stringify(selector)})).opacity)`);
const pressed = (page, bookId) => page.ev(`document.querySelector(${JSON.stringify(toggle(bookId))}).getAttribute("aria-pressed")`);
const shelfIs = (page, books, message) => page.waitFor(`JSON.stringify([...document.querySelectorAll("[data-shelf-card]")].map((b) => b.dataset.book)) === ${JSON.stringify(JSON.stringify(books))}`, { message });

const RECORD_TRANSITIONS = `(() => {
  window.__reorders = [];
  if (window.__recordingReorders) return;
  window.__recordingReorders = true;
  const start = document.startViewTransition.bind(document);
  document.startViewTransition = (arg) => {
    window.__reorders.push(document.documentElement.dataset.reorder ?? null);
    return start(arg);
  };
})()`;

export const checks = [
  [
    "a card's pin shows on hover, and pressing it moves the book to the top in a view transition",
    async (page) => {
      await page.go("#/", `!!document.querySelector(${JSON.stringify(card(SHORT_BOOK))})`);
      await page.sleep(400);
      assert.deepEqual(await shelf(page), [LONG_BOOK, SHORT_BOOK]);
      assert.equal(await opacityOf(page, toggle(SHORT_BOOK)), 0, "the pin shows before hover");
      const r = await page.rectOf(card(SHORT_BOOK));
      await page.move(r.cx, r.y + 60);
      await page.waitFor(`Number(getComputedStyle(document.querySelector(${JSON.stringify(toggle(SHORT_BOOK))})).opacity) === 1`, { message: "the pin didn't show on hover" });
      assert.equal(await page.ev(`document.querySelector(${JSON.stringify(toggle(SHORT_BOOK))}).getAttribute("aria-label")`), "Pin رسالة قصيرة");
      assert.equal(await pressed(page, SHORT_BOOK), "false");
      const t = await page.rectOf(toggle(SHORT_BOOK));
      assert.equal(await page.ev(`document.elementFromPoint(${t.cx}, ${t.cy})?.closest("button")?.hasAttribute("data-pin-toggle")`), true, "the pin isn't what a click at its centre hits");
      await page.ev(RECORD_TRANSITIONS);
      await page.click(toggle(SHORT_BOOK));
      await shelfIs(page, [SHORT_BOOK, LONG_BOOK], "the pinned book didn't move to the top");
      assert.equal(await pressed(page, SHORT_BOOK), "true");
      assert.deepEqual(await page.ev("window.__reorders"), ["library"], "pinning didn't reorder in a view transition");
      await page.waitFor(`!document.documentElement.dataset.reorder`, { message: "the reorder mark wasn't cleared" });
      await page.move(5, 5);
      await page.sleep(300);
      assert.equal(await opacityOf(page, toggle(SHORT_BOOK)), 1, "a pinned book's pin should stay shown");
      assert.equal(await continuing(page), LONG_BOOK, "Continue reading should still be the book read last");
    },
  ],
  [
    "the pin is saved: it survives a reload and the midad CLI lists the book first",
    async (page, app) => {
      await page.ev("window.__beforeReload = true; location.reload()");
      await page.waitFor(`!window.__beforeReload && !!document.querySelector(${JSON.stringify(card(SHORT_BOOK))})`, { timeout: 8000, message: "the library didn't come back after the reload" });
      assert.deepEqual(await shelf(page), [SHORT_BOOK, LONG_BOOK]);
      const books = cliBooks(app.userData);
      assert.deepEqual(books.map((b) => b.bookId), [SHORT_BOOK, LONG_BOOK]);
      assert.equal(typeof books[0].pinnedAt, "number");
      assert.equal(books[1].pinnedAt, null);
    },
  ],
  [
    "Unpin in the book menu puts the book back in its place",
    async (page, app) => {
      const r = await page.rectOf(card(SHORT_BOOK));
      await page.move(r.cx, r.y + 60);
      await page.click(`${card(SHORT_BOOK)} [data-book-actions]`);
      await page.waitFor(`document.querySelector("[data-pin-item]")?.textContent === "Unpin"`, { message: "the menu doesn't offer Unpin" });
      await page.click("[data-pin-item]");
      await shelfIs(page, [LONG_BOOK, SHORT_BOOK], "unpinning didn't put the book back");
      assert.equal(await pressed(page, SHORT_BOOK), "false");
      assert.ok(cliBooks(app.userData).every((b) => b.pinnedAt === null), "the library file still has the pin");
    },
  ],
  [
    "from the keyboard: Tab reaches a card's pin, Space pins and unpins, and focus stays on it",
    async (page) => {
      await page.move(5, 5);
      await page.ev(`document.activeElement?.blur()`);
      let reached = false;
      for (let i = 0; i < 40 && !reached; i++) {
        await page.press("Tab", { code: "Tab" });
        reached = await page.ev(`document.activeElement?.matches(${JSON.stringify(toggle(SHORT_BOOK))}) ?? false`);
      }
      assert.ok(reached, "Tab never reached the pin");
      await page.waitFor(`Number(getComputedStyle(document.querySelector(${JSON.stringify(toggle(SHORT_BOOK))})).opacity) === 1`, { message: "the focused pin isn't shown" });
      await page.press(" ", { code: "Space" });
      await shelfIs(page, [SHORT_BOOK, LONG_BOOK], "Space didn't pin the book");
      await page.waitFor(`document.activeElement?.matches(${JSON.stringify(toggle(SHORT_BOOK))})`, { message: "focus left the pin after pinning" });
      assert.equal(await pressed(page, SHORT_BOOK), "true");
      await page.press(" ", { code: "Space" });
      await shelfIs(page, [LONG_BOOK, SHORT_BOOK], "Space didn't unpin the book");
      await page.waitFor(`document.activeElement?.matches(${JSON.stringify(toggle(SHORT_BOOK))})`, { message: "focus left the pin after unpinning" });
    },
  ],
];
