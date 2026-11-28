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
    "typing lines while an answer streams keeps following it",
    async (page) => {
      assert.ok(await streaming(page), "the answer finished before the check could type");
      await page.click(COMPOSER);
      await page.type("a follow-up");
      const gaps = [];
      for (let i = 0; i < 2; i++) {
        await page.press("Enter", { shift: true, commands: ["insertLineBreak"] });
        await page.type("more");
        await page.sleep(350);
        gaps.push((await position(page)).gap);
      }
      assert.ok(await streaming(page), "the answer finished before the check could see it follow");
      assert.ok(gaps.every((g) => g <= 2), `the view let go of the answer as the composer grew: ${JSON.stringify(gaps)}px from the bottom`);
      await page.press("a", { code: "KeyA", ctrl: true, commands: ["selectAll"] });
      await page.press("Backspace", { commands: ["deleteBackward"] });
      await page.sleep(300);
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
  [
    "a pasted quote pill fits the composer's line, with no scrollbar",
    async (page) => {
      await openReader(page, { bookId: LONG_BOOK, position: 12 });
      await page.ev(`window.getSelection().removeAllRanges()`);
      await page.sleep(300);
      const a = await page.rectOf('[data-part=matn][data-line="3"][data-w="2"]');
      const b = await page.rectOf('[data-part=matn][data-line="3"][data-w="4"]');
      await page.drag({ from: { x: a.x + a.width - 2, y: a.cy }, to: { x: b.x + 2, y: b.cy } });
      await page.sleep(300);
      await page.press("c", { code: "KeyC", ctrl: true, commands: ["copy"] });
      await page.click(COMPOSER);
      await page.press("a", { code: "KeyA", ctrl: true, commands: ["selectAll"] });
      await page.press("v", { code: "KeyV", ctrl: true, commands: ["paste"] });
      await page.sleep(600);
      const box = await page.ev(`(() => { const e = document.querySelector("${COMPOSER}"); return { pills: e.querySelectorAll("[contenteditable=false]").length, overflow: e.scrollHeight - e.clientHeight }; })()`);
      assert.equal(box.pills, 1, "the paste didn't make a quote pill");
      assert.equal(box.overflow, 0, `the composer overflows by ${box.overflow}px with a pill in it`);
    },
  ],
  [
    "a new empty line grows the composer at once, and deleting it shrinks it back",
    async (page) => {
      await page.click(COMPOSER);
      await page.press("a", { code: "KeyA", ctrl: true, commands: ["selectAll"] });
      await page.press("Backspace", { commands: ["deleteBackward"] });
      await page.type("first line");
      const heights = [];
      for (let i = 0; i < 2; i++) {
        await page.press("Enter", { shift: true, commands: ["insertLineBreak"] });
        await page.sleep(400);
        heights.push(await composerHeight(page));
      }
      for (let i = 0; i < 2; i++) {
        await page.press("Backspace", { commands: ["deleteBackward"] });
        await page.sleep(400);
        heights.push(await composerHeight(page));
      }
      assert.deepEqual(heights, [48, 72, 48, 24], "composer height after each new line, then each delete");
    },
  ],
  [
    "a citation on another page names that page and takes you there",
    async (page) => {
      await openReader(page, { bookId: LONG_BOOK, position: 12 });
      await page.waitFor(`!document.querySelector('[aria-label="Stop"]')`, { timeout: 20_000, message: "an earlier answer never finished" });
      await page.click(COMPOSER);
      await page.type("Where else? [cite page 40] [12 words]");
      await page.press("Enter");
      const pill = `js:[...document.querySelectorAll("button")].find((b) => b.closest("[dir=ltr]")?.textContent.includes("p. ٤٢ · line 2") || b.getAttribute("aria-label")?.includes("p. ٤٢ · line 2"))`;
      await page.waitFor(`!!(${pill.slice(3)})`, { timeout: 10_000, message: "no pill naming printed page ٤٢ (page 40)" });
      const words = await page.ev(`[...document.querySelectorAll('[data-part=matn][data-line="2"][data-w]')].map((w) => w.textContent).join(" ")`);
      await page.click(pill);
      await page.waitFor(`new URLSearchParams(location.hash.split("?")[1]).get("p") === "40"`, { timeout: 5000, message: "the pill didn't go to page 40" });
      assert.ok(words.length > 0, "the page had no line 2 to compare");
    },
  ],
  [
    "a phrase that repeats on its line points at every place, and braces pick one",
    async (page) => {
      await openReader(page, { bookId: LONG_BOOK, position: 12 });
      // A line of this page with a word on it twice, and the word just before its second use.
      const repeat = await page.ev(`(() => {
        for (const block of document.querySelectorAll('[data-line-block^="matn-"]')) {
          const words = [...block.querySelectorAll("[data-w]")].map((w) => w.textContent.trim());
          const second = words.findIndex((w, i) => i > 1 && words.indexOf(w) < i - 1);
          if (second !== -1) return { line: Number(block.dataset.lineBlock.slice(5)), word: words[second], first: words.indexOf(words[second]) + 1, second: second + 1, before: words[second - 1] };
        }
        return null;
      })()`);
      assert.ok(repeat, "no line on page 12 repeats a word");
      const tinted = () => page.ev(`[...document.querySelectorAll('[data-part=matn][data-line="${repeat.line}"][data-w]')].filter((w) => w.getAnimations().length).map((w) => Number(w.dataset.w))`);
      const ask = async (citation) => {
        await page.waitFor(`!document.querySelector('[aria-label="Stop"]')`, { timeout: 20_000, message: "an earlier answer never finished" });
        await page.click(COMPOSER);
        await page.type(`Which? [cite: ${citation}] [12 words]`);
        await page.press("Enter");
      };
      // The newest answer's pill whose label starts so.
      const pill = (label) => `js:[...document.querySelectorAll("button[aria-label]")].findLast((b) => b.getAttribute("aria-label").startsWith(${JSON.stringify(label)}))`;
      const answered = (label) => page.waitFor(`!!(${pill(label).slice(3)})`, { timeout: 10_000, message: `no pill labelled "${label}…"` });

      await ask(`line ${repeat.line}: ${repeat.word}`);
      await answered(`line ${repeat.line} · in 2 places:`);
      await page.click(pill(`line ${repeat.line} · in 2 places:`));
      await page.waitFor(`${JSON.stringify([repeat.first, repeat.second])}.every((n) => document.querySelector('[data-part=matn][data-line="${repeat.line}"][data-w="' + n + '"]')?.getAnimations().length)`, { timeout: 3000, message: "clicking didn't tint both places" });
      await page.sleep(3200);

      await ask(`line ${repeat.line}: ${repeat.before} {${repeat.word}}`);
      await answered(`line ${repeat.line}: `);
      await page.click(pill(`line ${repeat.line}: `));
      await page.waitFor(`document.querySelector('[data-part=matn][data-line="${repeat.line}"][data-w="${repeat.second}"]')?.getAnimations().length > 0`, { timeout: 3000, message: "clicking the braced citation didn't tint its word" });
      assert.deepEqual(await tinted(), [repeat.second], "the braced citation tinted more than the word in braces");
    },
  ],
  [
    "a question's line breaks show in its bubble",
    async (page) => {
      await page.waitFor(`!document.querySelector('[aria-label="Stop"]')`, { timeout: 20_000, message: "an earlier answer never finished" });
      await page.click(COMPOSER);
      await page.type("first line");
      await page.press("Enter", { shift: true, commands: ["insertLineBreak"] });
      await page.type("second line");
      await page.press("Enter");
      const bubble = `[...document.querySelectorAll("p.bg-accent-soft")].at(-1)`;
      await page.waitFor(`${bubble}?.innerText.includes("second line")`, { message: "the question didn't show" });
      assert.equal(await page.ev(`${bubble}.innerText.trim()`), "first line\nsecond line");
    },
  ],
];
