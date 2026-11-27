import assert from "node:assert/strict";
import { LONG_BOOK } from "../lib/fixture.mjs";
import { openReader } from "../lib/reader.mjs";
import { RESTART_BUTTON, setUpdateStatus, UPDATE_INDICATOR, UPDATE_VERSION, updateManaged, updateReady } from "../lib/updates.mjs";

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
      assert.equal(await page.ev(`!!${UPDATE_INDICATOR}`), false, "the reader shows an update icon");
    },
  ],
  [
    "with an update ready and device sync off, the reader shows an update icon with a dot instead of a pill, and its popover restarts",
    async (page) => {
      await openReader(page, { bookId: LONG_BOOK, position: 3 });
      await setUpdateStatus(page, updateReady());
      await page.waitFor(`!!${UPDATE_INDICATOR}`, { message: "the reader's top bar shows no update icon" });
      assert.equal(await page.ev(`!!document.querySelector("[data-update-notice]")`), false, "the reader still shows the Update ready pill");
      assert.equal(await page.ev(`!!${UPDATE_INDICATOR}.querySelector("[data-update-dot]")`), true, "the update icon has no dot");
      assert.equal(await page.ev(`${UPDATE_INDICATOR}.getAttribute("aria-label")`), "Update ready");
      assert.equal(await page.ev(`${UPDATE_INDICATOR}.hasAttribute("data-devices-indicator")`), false, "sync is off but the icon claims a Devices state");

      await page.click(`js:${UPDATE_INDICATOR}`);
      await page.waitFor(`!!document.querySelector("[data-update-section]")`, { message: "the update popover didn't open" });
      const text = await page.ev(`document.querySelector("[data-update-section]").textContent`);
      assert.ok(text.includes(`Midad ${UPDATE_VERSION} is ready`), `the update section says: ${text}`);
      assert.equal(await page.ev(`!!document.querySelector("[data-devices-popover]")`), false, "sync is off but the popover shows Devices");
      assert.equal(await page.ev(`${RESTART_BUTTON}?.disabled`), false, "Restart to update is missing or disabled");

      await setUpdateStatus(page, updateReady({ restartBlocked: true }));
      await page.waitFor(`${RESTART_BUTTON}?.disabled === true`, { message: "Restart stayed enabled while Claude is answering" });
      await setUpdateStatus(page, updateReady());
      await page.waitFor(`${RESTART_BUTTON}?.disabled === false`, { message: "Restart stayed disabled after the answer" });

      // The test app's updater is managed, so a Restart that reaches it is refused with this message.
      await page.click(`js:${RESTART_BUTTON}`);
      await page.waitFor(`[...document.querySelectorAll("[data-sonner-toast]")].some((t) => t.textContent.includes("No update is ready yet."))`, {
        message: "Restart to update didn't reach the updater",
      });
      await page.press("Escape");
    },
  ],
  [
    "the library sidebar keeps its Update ready notice, and the reader's icon goes once no update waits",
    async (page) => {
      await page.go("#/", `!!document.querySelector('[data-update-notice="sidebar"]')`);
      await openReader(page, { bookId: LONG_BOOK, position: 3 });
      await page.waitFor(`!!${UPDATE_INDICATOR}`, { message: "the update icon didn't come back in the reader" });
      await setUpdateStatus(page, updateManaged());
      await page.waitFor(`!${UPDATE_INDICATOR}`, { message: "the update icon stayed with no update waiting" });
      assert.equal(await page.ev(`!!document.querySelector("[data-devices-indicator]")`), false, "a Devices icon shows with sync off");
    },
  ],
];
