import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { connectPage } from "./cdp.mjs";
import { seedUserData } from "./fixture.mjs";

export const ROOT = resolve(import.meta.dirname, "../..");
const ELECTRON = join(ROOT, "node_modules/electron/dist/electron");
const CLI = join(ROOT, "out/cli/midad.mjs");
const REQUIRED = [join(ROOT, "out/main/index.js"), join(ROOT, "out/renderer/index.html"), CLI];

/** A desktop mouse, so :hover and hover-only UI behave as they do for a real user. */
const MOUSE_POINTER = "--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4";

export const assertBuilt = () => {
  const missing = REQUIRED.filter((f) => !existsSync(f));
  if (missing.length) {
    throw new Error(`The app isn't built (missing ${missing.map((f) => f.slice(ROOT.length + 1)).join(", ")}). Run \`pnpm build && pnpm build:cli\` first.`);
  }
};

const freePort = () =>
  new Promise((done, fail) => {
    const server = createServer();
    server.once("error", fail);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => done(port));
    });
  });

/** Seeds one library to copy for each launch, so every group starts from the same state. */
export const createTemplate = () => {
  const root = mkdtempSync(join(tmpdir(), "midad-e2e-"));
  const template = join(root, "template");
  seedUserData({ dir: template, cliPath: CLI });
  return { root, template };
};

/**
 * Starts the built app headless on a copy of the template library and connects to its window.
 * The app runs in its own process group, so stopping it kills exactly what was started here.
 */
export const launchApp = async ({ root, template, name, width = 1280, height = 820, keep = false, env = {} }) => {
  const userData = join(root, name);
  // A kept profile is reopened as it was left, for checks that close and restart the app.
  if (!keep || !existsSync(userData)) cpSync(template, userData, { recursive: true });
  const port = await freePort();
  const child = spawn(ELECTRON, ["--ozone-platform=headless", `--remote-debugging-port=${port}`, MOUSE_POINTER, "."], {
    cwd: ROOT,
    env: { ...process.env, ...env, MIDAD_USER_DATA: userData, NODE_ENV: "production", ELECTRON_RENDERER_URL: "" },
    detached: true,
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (d) => {
    stderr = (stderr + d).slice(-4000);
  });
  const stop = () => {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {}
  };
  try {
    const page = await connectPage({ port, isAlive: () => child.exitCode === null });
    await page.viewport(width, height);
    await page.waitFor(`document.querySelector("#root")?.children.length > 0`);
    return {
      page,
      userData,
      close: async () => {
        page.close();
        stop();
        if (!keep) rmSync(userData, { recursive: true, force: true });
        // Wait for the process to exit, so a kept profile isn't reopened while it is still writing.
        while (child.exitCode === null && child.signalCode === null) await new Promise((r) => setTimeout(r, 50));
      },
    };
  } catch (err) {
    stop();
    throw new Error(`${err.message}\n${stderr}`);
  }
};
