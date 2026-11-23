import assert from "node:assert/strict";
import { LONG_BOOK } from "../lib/fixture.mjs";
import { focusRing, openReader } from "../lib/reader.mjs";

export const name = "Ask AI model";

const COMPOSER = "[role=textbox][aria-multiline]";
const TRIGGER = '[aria-label^="Model:"]';
const MENU = "[role=menu]";
const option = (label) => `js:[...document.querySelectorAll("[role=menuitemradio]")].find((o) => o.textContent.includes(${JSON.stringify(label)}))`;

const triggerText = (page) => page.ev(`document.querySelector('${TRIGGER}')?.textContent.trim() ?? null`);
const menuOpen = (page) => page.ev(`!!document.querySelector("${MENU}")`);
const triggerFocused = (page) => page.ev(`document.activeElement === document.querySelector('${TRIGGER}')`);

const triggerShown = `(() => { const el = document.querySelector('${TRIGGER}'); return !!el && el.getBoundingClientRect().width > 0 && el.checkVisibility() && !el.closest("[inert]"); })()`;

/** Enter as a keyboard sends it, so a focused button is pressed. */
const pressEnter = async (page) => {
  await page.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", text: "\r", unmodifiedText: "\r", windowsVirtualKeyCode: 13 });
  await page.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await page.sleep(60);
};

const openAsk = async (page) => {
  await page.click('[aria-label^="Ask AI"]');
  await page.waitFor(`!!document.querySelector("${COMPOSER}") && ${triggerShown}`, { message: "Ask AI didn't open with a model picker" });
  await page.waitStill(COMPOSER);
};

export const checks = [
  [
    "the header shows Opus 5.5 until the reader picks another",
    async (page) => {
      await openReader(page, { bookId: LONG_BOOK, position: 10 });
      await openAsk(page);
      assert.equal(await triggerText(page), "Opus 5.5");
    },
  ],
  [
    "the keyboard opens the menu, moves through it, picks with Enter and closes with Esc, back on the trigger",
    async (page) => {
      await page.ev(`document.querySelector('${TRIGGER}').focus()`);
      await pressEnter(page);
      await page.waitFor(`!!document.querySelector("${MENU}")`, { message: "Enter didn't open the menu" });
      await page.sleep(200);
      const checked = await page.ev(`[...document.querySelectorAll("[role=menuitemradio]")].map((o) => o.getAttribute("aria-checked"))`);
      assert.deepEqual(checked, ["true", "false"], "Opus isn't the checked option");
      await page.press("Escape");
      await page.waitFor(`!document.querySelector("${MENU}")`, { message: "Esc didn't close the menu" });
      await page.sleep(150);
      assert.ok(await triggerFocused(page), "focus didn't go back to the trigger after Esc");

      await page.press("ArrowDown");
      await page.waitFor(`!!document.querySelector("${MENU}")`, { message: "↓ didn't open the menu" });
      await page.sleep(200);
      const highlighted = () => page.ev(`document.querySelector("[role=menuitemradio][data-highlighted]")?.textContent ?? ""`);
      for (let i = 0; i < 3 && !(await highlighted()).includes("Sonnet"); i++) await page.press("ArrowDown");
      assert.ok((await highlighted()).includes("Sonnet"), "↓ never reached Sonnet 5.5");
      await pressEnter(page);
      await page.waitFor(`!document.querySelector("${MENU}")`, { message: "Enter didn't pick and close" });
      await page.sleep(150);
      assert.equal(await triggerText(page), "Sonnet 5.5");
      assert.ok(await triggerFocused(page), "focus didn't go back to the trigger after picking");
    },
  ],
  [
    "a mouse pick changes the model and leaves no focus ring on the trigger",
    async (page) => {
      await page.ev(`document.activeElement?.blur()`);
      await page.click(TRIGGER);
      await page.waitFor(`!!document.querySelector("${MENU}")`, { message: "clicking the trigger didn't open the menu" });
      await page.sleep(250);
      await page.click(option("Opus 5.5"));
      await page.waitFor(`!document.querySelector("${MENU}")`, { message: "picking didn't close the menu" });
      await page.sleep(200);
      assert.equal(await triggerText(page), "Opus 5.5");
      assert.equal(await focusRing(page), null, "a focus ring shows after a mouse pick");

      await page.click(TRIGGER);
      await page.waitFor(`!!document.querySelector("${MENU}")`);
      await page.sleep(250);
      assert.ok(await page.ev(`document.querySelector("${MENU}").textContent.includes("Applies from your next question")`), "no footer hint");
      await page.click(option("Sonnet 5.5"));
      await page.waitFor(`!document.querySelector("${MENU}")`);
      await page.sleep(200);
      assert.equal(await triggerText(page), "Sonnet 5.5");
      assert.equal(await focusRing(page), null, "a focus ring shows after a mouse pick");
      assert.equal(await menuOpen(page), false);
    },
  ],
  [
    "the next question goes to the chosen model",
    async (page) => {
      await page.click(COMPOSER);
      await page.type("Which model answers? [12 words]");
      await page.press("Enter");
      await page.waitFor(`!!document.querySelector('[aria-label="Stop"]')`, { message: "the question didn't start an answer" });
      await page.waitFor(`!document.querySelector('[aria-label="Stop"]')`, { timeout: 10_000, message: "the answer never finished" });
      assert.ok(await page.ev(`document.body.textContent.includes("MODEL-claude-sonnet-5-5")`), "Claude wasn't asked for Sonnet 5.5");
    },
  ],
  [
    "the choice survives closing and reopening the panel, and a reload",
    async (page) => {
      await page.click('[aria-label="Hide Ask AI"]');
      await page.waitFor(`!${triggerShown}`, { message: "Ask AI didn't close" });
      await page.sleep(300);
      await openAsk(page);
      assert.equal(await triggerText(page), "Sonnet 5.5", "after reopening the panel");
      await page.ev(`location.reload()`);
      await page.waitFor(`document.querySelector("#root")?.children.length > 0`, { timeout: 8000 });
      await openReader(page, { bookId: LONG_BOOK, position: 10 });
      if (!(await page.ev(triggerShown))) await openAsk(page);
      assert.equal(await triggerText(page), "Sonnet 5.5", "after a reload");
    },
  ],
];
