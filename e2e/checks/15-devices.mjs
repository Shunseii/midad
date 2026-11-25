import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LONG_BOOK } from "../lib/fixture.mjs";
import { openReader } from "../lib/reader.mjs";
import { freePort, startSyncServer } from "../lib/sync-server.mjs";

export const name = "Devices";

const TOKEN = "e2e-devices-token";
const WRONG_TOKEN = "e2e-devices-wrong-token";

let server = null;
let port = 0;
let persistTo = "";

const startServer = async () => {
  if (!persistTo) persistTo = mkdtempSync(join(tmpdir(), "midad-e2e-devices-"));
  if (!port) port = await freePort();
  server = await startSyncServer({ port, persistTo, tokens: { [TOKEN]: "e2e-devices-user" } });
};

const stopServer = async () => {
  await server?.stop();
  server = null;
};

const indicator = (view) => `document.querySelector('[data-devices-indicator${view ? `="${view}"` : ""}]')`;
const field = (label) => `(() => { const l = [...document.querySelectorAll("label")].find((l) => l.textContent === ${JSON.stringify(label)}); return l && document.getElementById(l.htmlFor); })()`;
const button = (text) => `js:[...document.querySelectorAll("#devices button")].find((b) => b.textContent.trim() === ${JSON.stringify(text)})`;
const devicesText = `document.getElementById("devices").textContent`;

const openDevicesSettings = async (page) => {
  await page.go("#/settings", `!!document.getElementById("devices")`);
  await page.ev(`document.getElementById("devices").scrollIntoView({ block: "center" })`);
  await page.sleep(200);
};

/** Clicks into a field and types, replacing what's there. */
const fill = async (page, { label, text }) => {
  await page.click(`js:${field(label)}`);
  await page.ev(`${field(label)}.select()`);
  await page.type(text);
};

export const checks = [
  [
    "with device sync off, no Devices indicator shows in the library or the reader, and Settings says Off",
    async (page) => {
      await page.go("#/", `!!document.querySelector("[data-book]")`);
      assert.equal(await page.ev(`!!${indicator()}`), false, "the library shows a Devices indicator");
      await openReader(page, { bookId: LONG_BOOK, position: 3 });
      assert.equal(await page.ev(`!!${indicator()}`), false, "the reader shows a Devices indicator");
      await openDevicesSettings(page);
      assert.ok((await page.ev(devicesText)).includes("Off"), "the Devices section doesn't say Off");
      assert.equal(await page.ev(`(${button("Connect").slice(3)}).disabled`), true, "Connect is enabled with empty fields");
    },
  ],
  [
    "set up in Settings against a local sync server, it shows up to date, without the token coming back",
    async (page) => {
      await startServer();
      await openDevicesSettings(page);
      await fill(page, { label: "Server address", text: `http://127.0.0.1:${port}/sync` });
      await fill(page, { label: "Token", text: TOKEN });
      await page.click(button("Connect"));
      await page.waitFor(`!!${indicator("synced")}`, { timeout: 30_000, message: "the sidebar never showed Up to date" });
      await page.waitFor(`${devicesText}.includes("Up to date")`, { message: "the Devices badge doesn't say Up to date" });
      assert.equal(await page.ev(`${field("Token")}.value`), "", "the token field still holds the token");
      assert.equal(await page.ev(`${field("Token")}.placeholder`), "Saved. Enter a new token to replace it.");
      const replies = JSON.stringify([await page.ev(`window.midad["sync.settings"]()`), await page.ev(`window.midad["sync.status"]()`)]);
      assert.ok(!replies.includes(TOKEN), "the renderer was handed the token");

      await page.click(`js:${indicator("synced")}`);
      await page.waitFor(`!!document.querySelector('[data-devices-popover="synced"]')`, { message: "the Devices popover didn't open" });
      const popover = await page.ev(`document.querySelector('[data-devices-popover]').textContent`);
      assert.ok(popover.includes("Up to date") && popover.includes("Last up to date"), `popover: ${popover}`);
      await page.press("Escape");
    },
  ],
  [
    "with the server stopped, the library and the reader show offline",
    async (page) => {
      await stopServer();
      await page.waitFor(`!!${indicator("offline")}`, { timeout: 20_000, message: "the sidebar never showed Offline" });
      assert.ok((await page.ev(devicesText)).includes("Offline · retrying"));
      await openReader(page, { bookId: LONG_BOOK, position: 3 });
      await page.waitFor(`!!${indicator("offline")}?.querySelector("[data-devices-dot]")`, { message: "the reader's top bar shows no offline indicator with a dot" });
    },
  ],
  [
    "a token the server refuses shows sign-in refused, and Disconnect turns it off",
    async (page) => {
      await startServer();
      try {
        await openDevicesSettings(page);
        await fill(page, { label: "Token", text: WRONG_TOKEN });
        await page.click(button("Connect"));
        await page.waitFor(`!!${indicator("refused")}`, { timeout: 30_000, message: "the sidebar never showed Sign-in refused" });
        const text = await page.ev(devicesText);
        assert.ok(text.includes("Sign-in refused") && text.includes("The server refused this token. Paste a new one."), text);
        await page.click(button("Disconnect"));
        await page.waitFor(`!${indicator()}`, { message: "the indicator stayed after Disconnect" });
        await page.waitFor(`${devicesText}.includes("Off")`, { message: "Settings doesn't say Off after Disconnect" });
        assert.equal(await page.ev(`${field("Token")}.placeholder`), "Paste the token from your server", "Disconnect kept the token");
        assert.equal(await page.ev(`${field("Server address")}.value`), `http://127.0.0.1:${port}/sync`, "Disconnect forgot the address");
      } finally {
        await stopServer();
        rmSync(persistTo, { recursive: true, force: true });
      }
    },
  ],
];
