import assert from "node:assert/strict";
import { LONG_BOOK } from "../lib/fixture.mjs";
import { openReader } from "../lib/reader.mjs";

export const name = "Ask AI across screens";

const COMPOSER = "[role=textbox][aria-multiline]";
const KEPT = "Kept question [12 words]";
const STREAMED = "Streamed while away [300 words]";

const questions = (page) => page.ev(`[...document.querySelectorAll("p.self-end")].map((q) => q.textContent.trim())`);
const answerTo = (page, question) =>
  page.ev(`[...document.querySelectorAll("p.self-end")].find((q) => q.textContent.trim() === ${JSON.stringify(question)})?.parentElement.textContent.length ?? 0`);
const streaming = (page) => page.ev(`!!document.querySelector('[aria-label="Stop"]')`);

// A closed panel can still be in the page, just off its edge.
const COMPOSER_SHOWN = `(() => { const r = document.querySelector("${COMPOSER}")?.getBoundingClientRect(); return !!r && r.right <= innerWidth && r.left >= 0; })()`;

const openAsk = async (page) => {
  if (!(await page.ev(COMPOSER_SHOWN))) await page.click('[aria-label^="Ask AI"]');
  await page.waitFor(COMPOSER_SHOWN, { message: "Ask AI didn't open" });
  await page.waitStill(COMPOSER);
};

const toSettingsAndBack = async (page, { away = 600 } = {}) => {
  await page.click('[aria-label="Display"]');
  await page.waitFor(`!!document.querySelector("[data-slot=popover-content]")`, { message: "the Display menu didn't open" });
  const allSettings = `js:[...document.querySelectorAll("[data-slot=popover-content] button, [data-slot=popover-content] a")].find((b) => /settings/i.test(b.textContent))`;
  await page.waitStill(allSettings);
  await page.click(allSettings);
  await page.waitFor(`location.hash.includes("settings")`, { message: "didn't reach Settings" });
  await page.waitFor(`!document.querySelector("[data-page-area]")`, { message: "the reader stayed mounted on Settings, so this check proves nothing" });
  await page.sleep(away);
  await page.press("Escape");
  await page.waitFor(`location.hash.includes("/read/")`, { message: "Esc didn't go back to the book" });
  await page.waitFor(`!!document.querySelector("[data-page-area] [data-w]")`);
  await page.sleep(800);
  await openAsk(page);
};

export const checks = [
  [
    "an unsaved conversation and the composer's draft come back after Settings",
    async (page) => {
      await openReader(page, { bookId: LONG_BOOK, position: 10 });
      await openAsk(page);
      await page.click(COMPOSER);
      await page.type(KEPT);
      await page.press("Enter");
      await page.waitFor(`!!document.querySelector('[aria-label="Stop"]')`, { message: "the question didn't start an answer" });
      await page.waitFor(`!document.querySelector('[aria-label="Stop"]')`, { timeout: 10_000, message: "the answer never finished" });
      await page.click(COMPOSER);
      await page.type("not sent yet");
      await page.sleep(200);

      await toSettingsAndBack(page);
      assert.deepEqual(await questions(page), [KEPT], "the conversation didn't come back");
      assert.ok(await page.ev(`!!document.querySelector('[aria-label="Save conversation"]')`), "the conversation came back saved, or without its Save button");
      assert.equal((await page.ev(`document.querySelector("${COMPOSER}").innerText`)).trim(), "not sent yet", "the draft didn't come back");
    },
  ],
  [
    "an answer streaming when leaving keeps arriving and is there on return",
    async (page) => {
      await page.click(COMPOSER);
      await page.press("a", { code: "KeyA", ctrl: true, commands: ["selectAll"] });
      await page.type(STREAMED);
      await page.press("Enter");
      await page.waitFor(`!!document.querySelector('[aria-label="Stop"]')`, { message: "the question didn't start an answer" });
      await page.sleep(800);
      assert.ok(await streaming(page), "the answer finished before leaving");
      const before = await answerTo(page, STREAMED);

      await toSettingsAndBack(page, { away: 1500 });
      assert.deepEqual(await questions(page), [KEPT, STREAMED], "the conversation didn't come back with both questions");
      const after = await answerTo(page, STREAMED);
      assert.ok(after > before + 100, `the answer didn't grow while away: ${before} → ${after} characters`);
      assert.ok(await streaming(page), "the answer finished while away, so this can't show it still streams on return");
      await page.waitFor(`!document.querySelector('[aria-label="Stop"]')`, { timeout: 15_000, message: "the answer never finished after coming back" });
      await page.waitFor(`document.body.textContent.includes("word298")`, { timeout: 5000, message: "the finished answer is missing its end" });
    },
  ],
  [
    "the conversation also comes back after the library",
    async (page) => {
      await page.go("#/", `!document.querySelector("[data-page-area]")`);
      await page.sleep(400);
      await openReader(page, { bookId: LONG_BOOK, position: 10 });
      await openAsk(page);
      assert.deepEqual(await questions(page), [KEPT, STREAMED], "the conversation didn't come back from the library");
    },
  ],
];
