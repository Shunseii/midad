import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { ROOT } from "../lib/app.mjs";
import { LONG_BOOK, SHORT_BOOK, SHORT_PAGES } from "../lib/fixture.mjs";
import { openReader } from "../lib/reader.mjs";

export const name = "Remove book";

const CLI = join(ROOT, "out/cli/midad.mjs");
const cli = ({ userData, args }) => {
  try {
    return { code: 0, stdout: execFileSync(process.execPath, ["--no-warnings", CLI, ...args], { env: { ...process.env, MIDAD_DB: join(userData, "midad.db") }, stdio: "pipe" }).toString() };
  } catch (err) {
    return { code: err.status, stdout: String(err.stdout) };
  }
};

const DIALOG = "[data-remove-book-dialog]";
const card = (bookId) => `[data-switch-list=library] [data-book="${bookId}"]`;
const shelf = (page) => page.ev(`[...new Set([...document.querySelectorAll("[data-switch-list=library] [data-book]")].map((b) => b.dataset.book))]`);

const openRemoveDialog = async (page, bookId) => {
  const r = await page.rectOf(card(bookId));
  await page.move(r.cx, r.y + 40);
  await page.click(`${card(bookId)} [data-book-actions]`);
  await page.waitFor(`!!document.querySelector("[data-remove-book-item]")`, { message: "the book menu didn't open" });
  await page.click("[data-remove-book-item]");
  await page.waitFor(`!!document.querySelector(${JSON.stringify(DIALOG)}) && !!document.querySelector("[data-removal-counts]")`, { message: "the remove dialog didn't open with counts" });
  await page.sleep(250);
};

export const checks = [
  [
    "the book menu offers Sync and Remove; the dialog names the book and counts what goes",
    async (page) => {
      await page.go("#/", `!!document.querySelector(${JSON.stringify(card(SHORT_BOOK))})`);
      await openRemoveDialog(page, SHORT_BOOK);
      const text = await page.ev(`document.querySelector("[data-slot=dialog-content]").innerText`);
      assert.match(text, /Remove book\?/);
      assert.ok(text.includes("رسالة قصيرة"), `the dialog doesn't name the book: ${text}`);
      const counts = await page.ev(`document.querySelector("[data-removal-counts]").textContent`);
      assert.ok(counts.startsWith(`${SHORT_PAGES} pages`), `counts: ${counts}`);
      assert.ok(!/\b0 /.test(counts), `counts show a zero: ${counts}`);
      assert.ok(text.includes("Can't be undone. The corpus copy stays."));
      assert.equal(await page.ev(`document.activeElement?.textContent`), "Cancel", "focus doesn't start on Cancel");
    },
  ],
  [
    "Remove is what a click at its centre hits",
    async (page) => {
      const r = await page.rectOf("[data-remove-book]");
      assert.equal(await page.ev(`document.elementFromPoint(${r.cx}, ${r.cy})?.closest("button")?.hasAttribute("data-remove-book")`), true);
    },
  ],
  [
    "Esc closes the dialog and keeps the book",
    async (page) => {
      await page.press("Escape");
      await page.waitFor(`!document.querySelector(${JSON.stringify(DIALOG)})`, { message: "Esc didn't close the dialog" });
      assert.ok((await shelf(page)).includes(SHORT_BOOK));
    },
  ],
  [
    "Remove takes the book off the shelf, says so, and the library file no longer has it",
    async (page, app) => {
      await openRemoveDialog(page, SHORT_BOOK);
      await page.click("[data-remove-book]");
      await page.waitFor(`!document.querySelector(${JSON.stringify(DIALOG)})`, { message: "the dialog didn't close after Remove" });
      await page.waitFor(`!document.querySelector(${JSON.stringify(card(SHORT_BOOK))})`, { message: "the card didn't leave the shelf" });
      await page.waitFor(`document.body.innerText.includes("Removed رسالة قصيرة")`, { message: "no toast" });
      assert.ok(!(await page.ev(`!!document.querySelector("[data-waiting-books]")`)), "the removed book shows as waiting");
      const books = cli({ userData: app.userData, args: ["books"] }).stdout;
      assert.ok(!books.includes(SHORT_BOOK) && books.includes(LONG_BOOK), books);
    },
  ],
  [
    "a removal from the midad CLI takes the open book back to the library, live",
    async (page, app) => {
      await openReader(page, { bookId: LONG_BOOK, position: 3 });
      const dry = cli({ userData: app.userData, args: ["book", "remove", LONG_BOOK] });
      assert.equal(dry.code, 1);
      assert.match(dry.stdout, /Would remove/);
      assert.equal(cli({ userData: app.userData, args: ["book", "remove", LONG_BOOK, "--yes"] }).code, 0);
      await page.waitFor(`location.hash === "#/"`, { timeout: 8000, message: "the reader didn't go back to the library" });
      await page.waitFor(`!document.querySelector("[data-book]") && document.body.innerText.includes("Your library is empty")`, { timeout: 5000, message: "the library still shows the book" });
      assert.ok(!(await page.ev(`!!document.querySelector("[data-waiting-books]")`)), "the removed book shows as waiting");
    },
  ],
];
