import assert from "node:assert/strict";
import { LONG_BOOK } from "../lib/fixture.mjs";
import { openReader } from "../lib/reader.mjs";

export const name = "Harakat editor";

const FATHA = "َ";
const KASRA = "ِ";
const SHADDA = "ّ";

// Page 60 has a highlight over line 2's first three words.
const HIGHLIGHTED_WORD = `[data-part=matn][data-line="2"][data-w="2"]`;
const targetText = `(document.querySelector('${HIGHLIGHTED_WORD} .isolate')?.textContent ?? null)`;

/** The word as painted, so a mark left on screen after it left the DOM shows. */
const wordPixels = async (page) => {
  const r = await page.rectOf(HIGHLIGHTED_WORD);
  const { data } = await page.call("Page.captureScreenshot", { format: "png", clip: { x: r.x, y: r.y, width: r.width, height: r.height, scale: 1 } });
  return data;
};

const targetFirstLetter = async (page) => {
  await openReader(page, { bookId: LONG_BOOK, position: 60 });
  for (let i = 0; i < 3 && (await page.ev(`${targetText} !== null || !!document.querySelector("[data-slot=popover-content], [role=toolbar]")`)); i++) {
    await page.press("Escape");
    await page.sleep(200);
  }
  const r = await page.rectOf(HIGHLIGHTED_WORD);
  await page.clickAt(r.x + r.width - 3, r.cy);
  await page.waitFor(`${targetText} !== null`, { message: "no letter was targeted" });
  await page.sleep(400);
};

const removesFromScreen = async (page, { marks, key }) => {
  await targetFirstLetter(page);
  const before = await wordPixels(page);
  const letter = await page.ev(targetText);
  for (const mark of marks) {
    await page.press(mark);
    await page.sleep(150);
  }
  await page.waitFor(`${targetText} === ${JSON.stringify(letter + marks.join(""))}`, { message: "the typed marks didn't show" });
  await page.sleep(300);
  assert.ok((await wordPixels(page)) !== before, "the typed marks aren't painted");
  await page.press(key);
  await page.waitFor(`${targetText} === ${JSON.stringify(letter)}`, { message: `${key} didn't remove the marks` });
  await page.sleep(300);
  assert.ok((await wordPixels(page)) === before, `the marks are still painted after ${key}, with the letter still targeted`);
};

export const checks = [
  [
    "Backspace takes a mark off the screen at once on a highlighted word",
    (page) => removesFromScreen(page, { marks: [FATHA], key: "Backspace" }),
  ],
  [
    "Delete takes a shadda and vowel off the screen at once",
    (page) => removesFromScreen(page, { marks: [SHADDA, KASRA], key: "Delete" }),
  ],
];
