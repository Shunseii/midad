import assert from "node:assert/strict";
import { LONG_BOOK } from "../lib/fixture.mjs";
import { clickPageArea, currentPage, openReader } from "../lib/reader.mjs";

export const name = "J and K scroll";

const SCROLLER = `document.querySelector("[data-region=page]")`;
const scrollTop = (page) => page.ev(`Math.round(${SCROLLER}.scrollTop)`);
const scrollTo = async (page, top) => {
  await page.ev(`${SCROLLER}.scrollTo({ top: ${top}, behavior: "instant" })`);
  await page.sleep(200);
};
const COMPOSER = "[role=textbox][aria-multiline]";

const settle = async (page) => {
  let last = await scrollTop(page);
  for (let i = 0; i < 40; i++) {
    await page.sleep(50);
    const now = await scrollTop(page);
    if (now === last) return now;
    last = now;
  }
  return last;
};

const holdKey = async (page, { key, code, repeats }) => {
  for (let i = 0; i < repeats; i++) {
    await page.call("Input.dispatchKeyEvent", { type: "keyDown", key, code, text: key, unmodifiedText: key, autoRepeat: i > 0 });
    await page.sleep(33);
  }
  await page.call("Input.dispatchKeyEvent", { type: "keyUp", key, code });
};

export const checks = [
  [
    "j scrolls a few lines down and k back up, without turning the page",
    async (page) => {
      await openReader(page, { bookId: LONG_BOOK, position: 50 });
      await scrollTo(page, 0);
      await clickPageArea(page);
      await scrollTo(page, 0);
      await page.press("j", { code: "KeyJ" });
      const down = await settle(page);
      assert.ok(down >= 40 && down <= 300, `one j scrolled ${down}px, not a few lines`);
      await page.press("j", { code: "KeyJ" });
      const twice = await settle(page);
      assert.ok(Math.abs(twice - 2 * down) <= 3, `two js scrolled ${twice}px, not twice ${down}px`);
      await page.press("k", { code: "KeyK" });
      assert.ok(Math.abs((await settle(page)) - down) <= 3, "k didn't scroll back a step");
      await page.press("k", { code: "KeyK" });
      assert.equal(await settle(page), 0, "k didn't scroll back to the top");
      await page.press("k", { code: "KeyK" });
      await page.sleep(300);
      assert.equal(await currentPage(page), 50, "k at the top turned the page");
    },
  ],
  [
    "holding j scrolls steadily and stops soon after the key is let go",
    async (page) => {
      await scrollTo(page, 0);
      await page.press("j", { code: "KeyJ" });
      const step = await settle(page);
      await scrollTo(page, 0);
      const samples = [];
      for (let i = 0; i < 12; i++) {
        await page.call("Input.dispatchKeyEvent", { type: "keyDown", key: "j", code: "KeyJ", text: "j", unmodifiedText: "j", autoRepeat: i > 0 });
        await page.sleep(33);
        samples.push(await scrollTop(page));
      }
      await page.call("Input.dispatchKeyEvent", { type: "keyUp", key: "j", code: "KeyJ" });
      const released = await scrollTop(page);
      const final = await settle(page);
      assert.ok(samples.every((top, i) => i === 0 || top >= samples[i - 1]), `the page moved back while held: ${samples}`);
      assert.ok(samples.at(-1) > samples[2], `held j stalled: ${samples}`);
      assert.ok(final - released <= 2 * step + 3, `the page ran on ${final - released}px after letting go (step ${step}px)`);
      await holdKey(page, { key: "k", code: "KeyK", repeats: 60 });
      assert.equal(await settle(page), 0, "holding k didn't reach the top");
      assert.equal(await currentPage(page), 50, "holding k turned the page");
    },
  ],
  [
    "j in the Ask AI composer types j and doesn't scroll",
    async (page) => {
      await scrollTo(page, 0);
      await page.click('[aria-label^="Ask AI"]');
      await page.waitFor(`!!document.querySelector("${COMPOSER}")`, { message: "Ask AI didn't open" });
      await page.waitStill(COMPOSER);
      await page.click(COMPOSER);
      await page.press("j", { code: "KeyJ" });
      await page.press("k", { code: "KeyK" });
      await page.sleep(300);
      assert.equal(await page.ev(`document.querySelector("${COMPOSER}").innerText.trim()`), "jk", "the composer didn't get the letters");
      assert.equal(await scrollTop(page), 0, "j in the composer scrolled the page");
      await page.press("Backspace", { commands: ["deleteBackward"] });
      await page.press("Backspace", { commands: ["deleteBackward"] });
      await page.press("Escape");
      await page.click('[aria-label^="Ask AI"]');
      await page.sleep(400);
    },
  ],
  [
    "j with a letter targeted doesn't scroll",
    async (page) => {
      await openReader(page, { bookId: LONG_BOOK, position: 60 });
      const word = `[data-part=matn][data-line="2"][data-w="2"]`;
      const targeted = `!!document.querySelector('${word} .isolate')`;
      for (let i = 0; i < 3 && (await page.ev(`${targeted} || !!document.querySelector("[data-slot=popover-content], [role=toolbar]")`)); i++) {
        await page.press("Escape");
        await page.sleep(200);
      }
      await scrollTo(page, 0);
      const r = await page.rectOf(word);
      await page.clickAt(r.x + r.width - 3, r.cy);
      await page.waitFor(targeted, { message: "no letter was targeted" });
      await page.sleep(300);
      const before = await scrollTop(page);
      await page.press("j", { code: "KeyJ" });
      await page.sleep(400);
      assert.equal(await scrollTop(page), before, "j scrolled with a letter targeted");
      assert.ok(await page.ev(targeted), "j dropped the targeted letter");
      await page.press("Escape");
      await page.sleep(200);
    },
  ],
];
