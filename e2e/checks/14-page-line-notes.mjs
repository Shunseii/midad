import assert from "node:assert/strict";
import { LONG_BOOK } from "../lib/fixture.mjs";
import { buttonByText, openReader } from "../lib/reader.mjs";

export const name = "Page and line notes";

const notesTabOpen = (page) =>
  page.ev(`!![...document.querySelectorAll("h2")].find((h) => h.textContent.startsWith("Notes on this page"))`);
const editor = `[data-new-note] textarea`;
const lineWord = (line, w) => `[data-part=matn][data-line="${line}"][data-w="${w}"]`;

export const checks = [
  [
    "a page note is written from the Notes tab and marks the page number and the scrubber",
    async (page) => {
      await openReader(page, { bookId: LONG_BOOK, position: 20 });
      assert.equal(await page.ev(`!!document.querySelector('[data-mark="page-note"]')`), false, "a page-note mark before any page note");
      await page.click('[aria-label^="Show highlights and notes"]');
      await page.waitFor(`!!document.querySelector('[aria-label="Close panel"]')`, { message: "the panel didn't open" });
      const tab = `js:[...document.querySelectorAll("[role=tab]")].find((t) => t.textContent.trim() === "Notes")`;
      await page.waitStill(tab);
      await page.click(tab);
      await page.waitFor(`!!document.querySelector("[data-add-page-note]")`, { message: "no Add page note row" });
      await page.click("[data-add-page-note]");
      await page.waitFor(`document.activeElement?.matches(${JSON.stringify(editor)})`, { message: "the page-note editor didn't open focused" });
      await page.type("Opens the chapter on the verb.");
      await page.press("Enter", { code: "Enter", ctrl: true });
      await page.waitFor(`document.querySelector("[data-page-note]")?.textContent.includes("Opens the chapter on the verb.")`, { message: "the page note wasn't saved" });
      assert.equal(await page.ev(`!!document.querySelector("[data-add-page-note], [data-new-note]")`), false, "the add row or editor is still showing");
      assert.ok(await page.ev(`document.querySelector("[data-page-number]")?.getAttribute("aria-label")?.endsWith("note")`), "the page number doesn't show the page has a note");
      await page.waitFor(`!!document.querySelector('[data-mark="page-note"]')`, { message: "the scrubber has no page-note mark" });
    },
  ],
  [
    "deleting the page note can be undone",
    async (page) => {
      await page.click('[data-page-note] [aria-label="Delete page note"]');
      await page.waitFor(`!!document.querySelector("[data-add-page-note]")`, { message: "the page note wasn't deleted" });
      await page.press("z", { code: "KeyZ", ctrl: true });
      await page.waitFor(`document.querySelector("[data-page-note]")?.textContent.includes("Opens the chapter on the verb.")`, { message: "undo didn't bring the page note back" });
    },
  ],
  [
    "the page number starts a page note on a page without one",
    async (page) => {
      await openReader(page, { bookId: LONG_BOOK, position: 21 });
      await page.click('[aria-label="Close panel"]');
      await page.ev(`document.querySelector("[data-page-number]").scrollIntoView({ block: "center" })`);
      await page.waitStill("[data-page-number]");
      await page.click("[data-page-number]");
      await page.waitFor(`document.activeElement?.matches(${JSON.stringify(editor)})`, { message: "clicking the page number didn't open the page-note editor" });
      assert.ok(await notesTabOpen(page), "the Notes tab isn't showing");
      await page.press("Escape");
      await page.waitFor(`!document.querySelector("[data-new-note]") && !!document.querySelector("[data-add-page-note]")`, { message: "Esc didn't drop the new page note" });
    },
  ],
  [
    "a line's number adds a whole-line note, shown by the number rather than on the words",
    async (page) => {
      await page.ev(`document.querySelector('${lineWord(3, 1)}').scrollIntoView({ block: "center" })`);
      await page.waitStill(lineWord(3, 1));
      const w = await page.rectOf(lineWord(3, 1));
      await page.move(w.cx, w.cy);
      await page.sleep(250);
      const chip = '[data-line-chip="3"]';
      assert.ok(await page.ev(`getComputedStyle(document.querySelector('${chip}')).opacity > 0.5`), "hovering the line didn't show its + button");
      await page.click(chip);
      await page.waitFor(`document.activeElement?.matches(${JSON.stringify(editor)})`, { message: "the line-note editor didn't open" });
      const lineText = await page.ev(`[...document.querySelectorAll('[data-part=matn][data-line="3"][data-w]')].map((w) => w.textContent.trim()).join(" ")`);
      assert.ok(await page.ev(`document.querySelector("[data-new-note]").textContent.includes("Line 3")`), "the editor isn't labelled with the line");
      assert.ok(await page.ev(`document.querySelector("[data-new-note]").textContent.replace(/\\s+/g, " ").includes(${JSON.stringify(lineText.split(" ")[0])})`), "the editor doesn't show the line");
      await page.type("The whole line is the definition.");
      await page.click(`js:document.querySelector("[data-new-note]") && [...document.querySelectorAll("[data-new-note] button")].find((b) => b.textContent.trim() === "Save")`);
      await page.waitFor(`document.querySelector('${chip}')?.getAttribute("aria-label") === "Line 3 note"`, { message: "the line number doesn't show the line note" });
      assert.ok(await page.ev(`[...document.querySelectorAll("[role=button]")].some((c) => c.textContent.includes("Line 3") && c.textContent.includes("The whole line is the definition."))`), "no Line 3 card in the panel");
      assert.equal(await page.ev(`document.querySelectorAll('[data-line-block="matn-3"] [data-w].note-span, [data-line-block="matn-3"] [data-note-corner]').length`), 0, "the line note is drawn on the words");
    },
  ],
  [
    "pointing at a line note's icon washes its line",
    async (page) => {
      const chip = await page.rectOf('[data-line-chip="3"]');
      await page.move(chip.cx, chip.cy);
      await page.waitFor(`document.querySelector('[data-line-block="matn-3"]')?.hasAttribute("data-line-washed")`, { message: "the line didn't wash" });
      await page.move(chip.cx + 400, chip.cy + 300);
      await page.waitFor(`!document.querySelector('[data-line-block="matn-3"]')?.hasAttribute("data-line-washed")`, { message: "the wash stayed after the pointer left" });
    },
  ],
];
