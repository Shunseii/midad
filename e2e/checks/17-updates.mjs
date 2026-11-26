import assert from "node:assert/strict";
import { LONG_BOOK } from "../lib/fixture.mjs";
import { openReader } from "../lib/reader.mjs";

export const name = "Updates";

const updatesText = `document.getElementById("updates").textContent`;

export const checks = [
  [
    "run from source, Settings says updates are managed outside the app, with no Check now and no notice",
    async (page) => {
      await page.go("#/settings", `!!document.getElementById("updates")`);
      await page.ev(`document.getElementById("updates").scrollIntoView({ block: "center" })`);
      const text = await page.ev(updatesText);
      assert.ok(text.includes("Managed outside the app"), `the Updates section says: ${text}`);
      assert.match(text, /Midad \d+\.\d+\.\d+/, "the current version isn't shown");
      const buttons = await page.ev(`[...document.querySelectorAll("#updates button")].map((b) => b.textContent.trim())`);
      assert.deepEqual(buttons, ["Release notes"], `Updates offers: ${buttons.join(", ")}`);
      assert.equal(await page.ev(`!!document.querySelector("[data-update-notice]")`), false, "an Update ready notice shows");
      await openReader(page, { bookId: LONG_BOOK, position: 3 });
      assert.equal(await page.ev(`!!document.querySelector("[data-update-notice]")`), false, "the reader shows an Update ready notice");
    },
  ],
];
