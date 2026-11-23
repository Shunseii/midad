import assert from "node:assert/strict";
import { LONG_BOOK } from "../lib/fixture.mjs";
import { buttonByText, openReader } from "../lib/reader.mjs";

export const name = "Ask AI";

const COMPOSER = "[role=textbox][aria-multiline]";
const SCROLLER = `document.querySelector('[aria-label="Jump to latest"]').parentElement.querySelector(".overflow-y-auto")`;
const QUESTION = "Long answer please";

const headerButtons = (page) =>
  page.ev(`[...document.querySelector('[aria-label="Saved conversations"]').parentElement.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"))`);
const composerHeight = (page) => page.ev(`Math.round(document.querySelector("${COMPOSER}").getBoundingClientRect().height)`);
const position = (page) =>
  page.ev(`(() => { const e = ${SCROLLER}; return { gap: Math.round(e.scrollHeight - e.scrollTop - e.clientHeight), top: Math.round(e.scrollTop), height: e.scrollHeight, jump: document.querySelector('[aria-label="Jump to latest"]').dataset.state }; })()`);
const streaming = (page) => page.ev(`!!document.querySelector('[aria-label="Stop"]')`);

export const checks = [
  [
    "the header has Saved conversations",
    async (page) => {
      await openReader(page, { bookId: LONG_BOOK, position: 10 });
      await page.click('[aria-label^="Ask AI"]');
      await page.waitFor(`!!document.querySelector("${COMPOSER}")`, { message: "Ask AI didn't open" });
      await page.waitStill(COMPOSER);
      assert.ok((await headerButtons(page)).includes("Saved conversations"), "no Saved conversations button");
    },
  ],
  [
    "page starters coach rather than answer, and Check my understanding waits for the reader",
    async (page) => {
      const starters = await page.ev(`[...document.querySelectorAll("button")].map((b) => b.textContent.trim()).filter((t) => /Quiz me|Check my|Key terms|Translate|Summarise/.test(t))`);
      assert.deepEqual(starters, ["Quiz me on this page", "Check my understanding", "Key terms on this page"]);
      await page.click(buttonByText("Check my understanding"));
      await page.sleep(200);
      assert.equal(await page.ev(`document.querySelector("${COMPOSER}").innerText.trim()`), "My understanding of this page:");
      assert.ok(await page.ev(`document.activeElement === document.querySelector("${COMPOSER}")`), "the composer isn't focused");
      assert.ok(!(await streaming(page)), "the starter sent a question");
      await page.press("a", { code: "KeyA", ctrl: true, commands: ["selectAll"] });
      await page.press("Backspace", { commands: ["deleteBackward"] });
      await page.sleep(100);
    },
  ],
  [
    "the composer grows from one line to three, then stops, and shrinks back",
    async (page) => {
      await page.click(COMPOSER);
      await page.type("Short");
      await page.sleep(150);
      const heights = [await composerHeight(page)];
      const textHeight = () => page.ev(`document.querySelector("${COMPOSER}").scrollHeight`);
      // Word by word until the text runs to five lines, noting where the composer settles after each new line.
      for (let lines = await textHeight(), words = 0; lines < 120 && words < 200; words++) {
        await page.type(" question");
        await page.sleep(20);
        const now = await textHeight();
        if (now === lines) continue;
        lines = now;
        await page.sleep(450);
        heights.push(await composerHeight(page));
      }
      assert.deepEqual(heights, [24, 48, 72, 72, 72], "composer height at one to five lines of text");
      await page.press("a", { code: "KeyA", ctrl: true, commands: ["selectAll"] });
      await page.type(QUESTION);
      await page.sleep(400);
      assert.equal(await composerHeight(page), 24, "back to one line");
    },
  ],
  [
    "a streaming answer stays pinned to the bottom",
    async (page) => {
      await page.press("Enter");
      await page.waitFor(`!!document.querySelector('[aria-label="Stop"]')`, { message: "the question didn't start an answer" });
      await page.waitFor(`${SCROLLER}.scrollHeight > ${SCROLLER}.clientHeight + 400`, { timeout: 8000, message: "the answer never overflowed the panel" });
      assert.ok(await streaming(page), "the answer finished too soon to check streaming");
      const p = await position(page);
      assert.ok(p.gap <= 2, `not at the bottom while streaming: ${JSON.stringify(p)}`);
    },
  ],
  [
    "scrolling up mid-stream holds the position and shows Jump to latest",
    async (page) => {
      const box = await page.rectOf(`js:${SCROLLER}`);
      await page.wheel(box.cx, box.cy, -300);
      await page.sleep(400);
      const a = await position(page);
      await page.sleep(1000);
      const b = await position(page);
      assert.ok(await streaming(page), "the answer finished before the check could see it grow");
      assert.ok(b.height > a.height, "the answer didn't grow while scrolled up");
      assert.equal(b.top, a.top, `the view moved while scrolled up: ${a.top} → ${b.top}`);
      assert.equal(b.jump, "shown", "Jump to latest isn't shown");
    },
  ],
  [
    "Jump to latest mid-stream returns to the bottom and keeps following (3 tries)",
    async (page) => {
      const box = await page.rectOf(`js:${SCROLLER}`);
      // Whether text arrives while the jump is scrolling is down to timing, so try a few times.
      for (let attempt = 1; attempt <= 3; attempt++) {
        if (attempt > 1) {
          for (let i = 0; i < 3; i++) await page.wheel(box.cx, box.cy, -300);
          await page.waitFor(`document.querySelector('[aria-label="Jump to latest"]').dataset.state === "shown"`, { message: "Jump to latest didn't show after scrolling up" });
        }
        assert.ok(await streaming(page), `the answer finished before try ${attempt}`);
        const before = await position(page);
        await page.click('[aria-label="Jump to latest"]');
        await page.sleep(1200);
        // Sampled between new text and the scroll that follows it, the gap can read a line short for a moment.
        const following = await page
          .waitFor(`(() => { const e = ${SCROLLER}; return e.scrollHeight - e.scrollTop - e.clientHeight <= 2 && document.querySelector('[aria-label="Jump to latest"]').dataset.state === "hidden"; })()`, { timeout: 600 })
          .catch(() => false);
        const after = await position(page);
        assert.ok(following, `try ${attempt}: ${before.gap}px from the bottom when clicked, 1.8s later ${after.gap}px behind the stream with Jump to latest ${after.jump}`);
      }
    },
  ],
  [
    "after a turn the header has Save and New conversation",
    async (page) => {
      await page.waitFor(`!document.querySelector('[aria-label="Stop"]')`, { timeout: 20_000, message: "the answer never finished" });
      const buttons = await headerButtons(page);
      for (const label of ["Saved conversations", "Save conversation", "New conversation"]) assert.ok(buttons.includes(label), `no ${label} in ${JSON.stringify(buttons)}`);
    },
  ],
  [
    "a saved conversation reopens at the bottom",
    async (page) => {
      await page.click('[aria-label="Save conversation"]');
      await page.waitFor(`!!document.querySelector('[aria-label="Saved"]')`, { message: "Save didn't save" });
      await page.click('[aria-label="New conversation"]');
      await page.sleep(500);
      await page.click('[aria-label="Saved conversations"]');
      await page.sleep(600);
      await page.click(buttonByText(QUESTION, { partial: true }));
      await page.waitFor(`!!document.querySelector('[aria-label="Jump to latest"]') && ${SCROLLER}.scrollHeight > ${SCROLLER}.clientHeight`, { message: "the saved conversation didn't open" });
      await page.sleep(800);
      const p = await position(page);
      assert.equal(p.gap, 0, `reopened ${p.gap}px above the bottom`);
    },
  ],
  [
    "Name with Claude gives a saved conversation a name from the quick model",
    async (page) => {
      await page.click('[aria-label="Saved conversations"]');
      await page.sleep(600);
      const row = `js:[...document.querySelectorAll("[class*='group/row'] > button")].find((b) => b.textContent.includes(${JSON.stringify(QUESTION)}))`;
      const r = await page.rectOf(row);
      await page.move(r.cx, r.cy);
      await page.sleep(300);
      await page.click(`js:[...document.querySelectorAll('[aria-label="Name with Claude"]')].find((b) => b.closest("[class*='group/row']")?.textContent.includes(${JSON.stringify(QUESTION)}))`);
      await page.waitFor(`!!document.querySelector('[aria-label="Naming…"]')`, { timeout: 2000, message: "no naming state" });
      await page.waitFor(`[...document.querySelectorAll("[class*='group/row']")].some((r) => r.textContent.includes("Kalam and its parts"))`, { timeout: 8000, message: "the conversation wasn't renamed" });
      const titles = await page.ev(`[...document.querySelectorAll("[class*='group/row'] span.truncate.text-sm")].map((s) => s.textContent)`);
      assert.ok(titles.includes("Kalam and its parts"), `the name kept its quotes or full stop: ${JSON.stringify(titles)}`);
    },
  ],
  [
    "a new conversation drops the selected passage",
    async (page) => {
      await openReader(page, { bookId: LONG_BOOK, position: 12 });
      const from = await page.rectOf('[data-part=matn][data-line="2"][data-w="2"]');
      const to = await page.rectOf('[data-part=matn][data-line="2"][data-w="4"]');
      await page.drag({ from: { x: from.x + from.width - 2, y: from.cy }, to: { x: to.x + 2, y: to.cy } });
      await page.sleep(400);
      await page.waitFor(`!!(${buttonByText("Ask").slice(3)})`, { message: `no Ask button after selecting: "${await page.ev(`getSelection().toString()`)}"` });
      await page.click(buttonByText("Ask"));
      await page.waitFor(`document.body.textContent.includes("Ask about this passage")`, { message: "the selection didn't reach Ask AI" });
      // New conversation is always in the saved-conversations screen's header.
      await page.click('[aria-label="Saved conversations"]');
      await page.sleep(500);
      await page.click('[aria-label="New conversation"]');
      await page.sleep(500);
      assert.ok(await page.ev(`document.body.textContent.includes("Ask about this page")`), "the selected passage stayed after New conversation");
      assert.equal(await page.ev(`document.body.textContent.includes("Ask about this passage")`), false);
    },
  ],
];
