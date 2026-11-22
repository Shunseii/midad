import assert from "node:assert/strict";
import { LONG_BOOK, SHORT_BOOK } from "../lib/fixture.mjs";
import { buttonByText, openReader } from "../lib/reader.mjs";

export const name = "Library";

/** Records each view transition: the root's data attributes when it starts, and the named covers once it's ready. */
const RECORD_TRANSITIONS = `(() => {
  window.__transitions = [];
  if (window.__recording) return;
  window.__recording = true;
  const start = document.startViewTransition.bind(document);
  document.startViewTransition = (arg) => {
    const root = document.documentElement;
    const entry = { listSwitch: root.dataset.listSwitch ?? null, target: root.dataset.listSwitchTarget ?? null, closing: root.dataset.closing ?? null };
    window.__transitions.push(entry);
    const t = start(arg);
    t.ready.then(() => {
      entry.closingWhenReady = root.dataset.closing ?? null;
      entry.coversNamed = [...document.querySelectorAll("[data-cover]")].filter((e) => e.style.viewTransitionName === "book-cover").map((e) => e.closest("[data-book]")?.dataset.book);
    });
    return t;
  };
})()`;

// On All, the book being read shows twice: under Continue reading and on the shelf.
const shelfBooks = (page) => page.ev(`[...new Set([...document.querySelectorAll("[data-switch-list=library] [data-book]")].map((b) => b.dataset.book))]`);

export const checks = [
  [
    "shelf tabs switch the list in a view transition, forward and back",
    async (page) => {
      await page.go("#/", `!!document.querySelector("[data-book]")`);
      await page.sleep(500);
      await page.ev(RECORD_TRANSITIONS);
      for (const [tab, books] of [["Reading", [LONG_BOOK]], ["Finished", [SHORT_BOOK]], ["All", [LONG_BOOK, SHORT_BOOK]]]) {
        await page.click(buttonByText(tab));
        await page.sleep(600);
        assert.deepEqual(await shelfBooks(page), books, `books on the ${tab} shelf`);
      }
      const transitions = await page.ev("window.__transitions");
      assert.deepEqual(
        transitions.map((t) => [t.target, t.listSwitch]),
        [["library", "forward"], ["library", "forward"], ["library", "back"]],
        "All → Reading → Finished → All",
      );
      assert.equal(await page.ev(`document.documentElement.dataset.listSwitch ?? null`), null, "the switch marks weren't cleared");
    },
  ],
  [
    "Back to Library shrinks the page into exactly one book cover, then clears the marks",
    async (page) => {
      await page.go("#/", `!!document.querySelector("[data-book]")`);
      await page.sleep(300);
      await openReader(page, { bookId: LONG_BOOK, position: 12 });
      await page.sleep(800);
      await page.ev(RECORD_TRANSITIONS);
      await page.click('a[aria-label="Back to Library"]');
      await page.waitFor(`window.__transitions[0]?.coversNamed !== undefined`, { timeout: 3000, message: "Back to Library didn't start a view transition" });
      const [t] = await page.ev("window.__transitions");
      assert.equal(t.closing, LONG_BOOK, "data-closing should name the book when the transition starts");
      assert.equal(t.closingWhenReady, LONG_BOOK, "data-closing should stay set while the transition plays");
      assert.deepEqual(t.coversNamed, [LONG_BOOK], "exactly one cover, this book's, should carry the book-cover name");
      await page.sleep(1200);
      assert.equal(await page.ev(`location.hash`), "#/");
      assert.equal(await page.ev(`document.documentElement.dataset.closing ?? null`), null, "data-closing wasn't cleared");
      assert.equal(await page.ev(`[...document.querySelectorAll("[data-cover]")].filter((e) => e.style.viewTransitionName).length`), 0, "a cover kept its transition name");
    },
  ],
];
