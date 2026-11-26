#!/usr/bin/env node
// A real auto-update on Linux: builds the AppImage twice (an old and a new version) with a test-only
// generic feed on 127.0.0.1, serves the new one's latest-linux.yml and AppImage, runs the old one from
// a writable temp folder with a temp profile, and checks that it finds, downloads and, after Restart,
// runs the new version. Also checks that Ask AI's midad command works with no node on PATH, and that a
// packaged build that isn't an AppImage leaves updates alone.
//
//   pnpm build && pnpm build:cli
//   pnpm test:update <library folder to copy> [screenshot folder]
//
// The library folder is copied, never written to. Production builds keep the GitHub feed: the feed
// here is set only on these builds' command line.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, copyFileSync, cpSync, createReadStream, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { connectPage } from "./lib/cdp.mjs";
import { freePort } from "./lib/sync-server.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const OLD = "0.9.0";
const NEW = "0.9.1";
const [library, shotsArg] = process.argv.slice(2);
if (!library || !existsSync(join(library, "midad.db"))) {
  console.error("Pass a folder with a midad.db to copy as the test profile.");
  process.exit(1);
}
const work = mkdtempSync(join(tmpdir(), "midad-update-"));
const shots = resolve(shotsArg ?? join(work, "shots"));
mkdirSync(shots, { recursive: true });
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const step = (text) => console.log(`\n· ${text}`);

const feedPort = await freePort();
const feedUrl = `http://127.0.0.1:${feedPort}/`;

// The production config with its GitHub feed swapped for the local one, in the temp folder only.
const config = readFileSync(join(ROOT, "electron-builder.yml"), "utf8");
assert.match(config, /^publish:\n(?: {2}.*\n)+/m, "electron-builder.yml has no publish block to swap");
const testConfig = config.replace(/^publish:\n(?: {2}.*\n)+/m, `publish:\n  provider: generic\n  url: ${feedUrl}\n`);

const build = ({ version, extraFile }) => {
  const out = join(work, `build-${version}`);
  const configFile = join(work, `electron-builder.${version}.yml`);
  writeFileSync(configFile, extraFile ? `${testConfig}extraResources:\n  - from: ${extraFile}\n    to: padding.bin\n` : testConfig);
  step(`building the ${version} AppImage`);
  execFileSync(
    join(ROOT, "node_modules/.bin/electron-builder"),
    ["--linux", "AppImage", "--publish", "never", "--config", configFile, `-c.extraMetadata.version=${version}`, `-c.directories.output=${out}`],
    { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: "false" } },
  );
  return out;
};
// Only changed blocks download, so the new version carries 48 MB of noise to make the download long enough to watch.
const padding = join(work, "padding.bin");
writeFileSync(padding, randomBytes(48 * 1024 * 1024));
const oldBuild = build({ version: OLD });
const newBuild = build({ version: NEW, extraFile: padding });
const appImageIn = (dir) => join(dir, readdirSync(dir).find((f) => f.endsWith(".AppImage")));
assert.match(readFileSync(join(oldBuild, "linux-unpacked/resources/app-update.yml"), "utf8"), new RegExp(`provider: generic[\\s\\S]*url: ${feedUrl}`), "the test build's feed isn't the local one");

/**
 * The feed: the new build's files, with byte ranges (electron-updater asks for several at once to
 * download only the changed blocks) and a throttle, so the download can be watched.
 */
const requests = [];
let feed = null;
const startFeed = () =>
  new Promise((done) => {
    feed = createServer((req, res) => {
      const name = decodeURIComponent(new URL(req.url, feedUrl).pathname.slice(1));
      requests.push(`${req.method} ${name}${req.headers.range ? ` ${req.headers.range.slice(0, 40)}` : ""}`);
      const file = join(newBuild, name);
      if (!name || name.includes("/") || !existsSync(file)) return res.writeHead(404).end();
      const size = statSync(file).size;
      if (name.endsWith(".yml")) return setTimeout(() => res.writeHead(200, { "content-type": "text/yaml" }).end(readFileSync(file)), 1500);
      const ranges = (req.headers.range ?? "").replace(/^bytes=/, "").split(",").filter(Boolean).map((r) => r.split("-").map(Number));
      const throttled = async (start, end) => {
        for (let at = start; at <= end; at += 512 * 1024) {
          const chunk = await new Promise((got) => {
            const parts = [];
            createReadStream(file, { start: at, end: Math.min(end, at + 512 * 1024 - 1) })
              .on("data", (d) => parts.push(d))
              .on("end", () => got(Buffer.concat(parts)));
          });
          if (!res.write(chunk)) await new Promise((drained) => res.once("drain", drained));
          await sleep(40);
        }
      };
      void (async () => {
        if (ranges.length === 0) {
          res.writeHead(200, { "content-length": size, "accept-ranges": "bytes" });
          await throttled(0, size - 1);
        } else if (ranges.length === 1) {
          const [start, end = size - 1] = ranges[0];
          res.writeHead(206, { "content-length": end - start + 1, "content-range": `bytes ${start}-${end}/${size}` });
          await throttled(start, end);
        } else {
          const boundary = "midadfeedboundary";
          res.writeHead(206, { "content-type": `multipart/byteranges; boundary=${boundary}` });
          for (const [start, end] of ranges) {
            res.write(`--${boundary}\r\nContent-Type: application/octet-stream\r\nContent-Range: bytes ${start}-${end}/${size}\r\n\r\n`);
            await throttled(start, end);
            res.write("\r\n");
          }
          res.write(`--${boundary}--\r\n`);
        }
        res.end();
      })();
    }).listen(feedPort, "127.0.0.1", done);
  });

// The reader's folders, all under the temp folder: the AppImage (writable, so it can replace itself), the profile, the updater's cache.
const appDir = join(work, "Applications");
mkdirSync(appDir);
const appImage = join(appDir, "Midad.AppImage");
copyFileSync(appImageIn(oldBuild), appImage);
chmodSync(appImage, 0o755);
const profile = join(work, "profile");
cpSync(library, profile, { recursive: true });
// Claude Code's stand-in: runs `midad books` through Ask AI's shim, then streams an answer slowly enough to try Restart during it.
mkdirSync(join(profile, "ask", "bin"), { recursive: true });
writeFileSync(
  join(profile, "ask", "bin", "claude"),
  `#!/bin/sh
trap 'exit 143' TERM
node_seen=$(command -v node || echo none)
books=$(midad books 2>&1 | head -n 2 | tr '\\t\\n"\\\\' '    ')
printf '{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"NODE: %s BOOKS: %s\\\\n\\\\n"}}}\\n' "$node_seen" "$books"
i=0
while [ $i -lt 24 ]; do
  printf '{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"word%s "}}}\\n' $i
  i=$((i+1))
  sleep 0.25
done
printf '{"type":"result","subtype":"success","result":"NODE: %s BOOKS: %s","session_id":"fake-session"}\\n' "$node_seen" "$books"
`,
);
chmodSync(join(profile, "ask", "bin", "claude"), 0o755);

// No node anywhere on PATH: Ask AI must run midad on Midad's own runtime.
const PATH = "/usr/bin:/bin";
assert.throws(() => execFileSync("sh", ["-c", "command -v node"], { env: { PATH } }), "node is on the test PATH");
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !["APPIMAGE", "APPDIR", "ELECTRON_RUN_AS_NODE", "ELECTRON_RENDERER_URL", "DISPLAY", "WAYLAND_DISPLAY"].includes(k)));
Object.assign(env, { PATH, MIDAD_USER_DATA: profile, XDG_CACHE_HOME: join(work, "cache"), NODE_ENV: "production" });

/** Processes started for this test, found by the profile in their environment: the app, its helpers, and whatever it relaunched. */
const APPIMAGE_MOUNT = "fuse.Midad.AppImage";
const mounts = () =>
  readFileSync("/proc/mounts", "utf8")
    .split("\n")
    .map((line) => line.split(" "))
    .filter((fields) => fields[2] === APPIMAGE_MOUNT)
    .map((fields) => fields[1]);
const mountsBefore = new Set(mounts());
/** AppImage mounts this test made: the app runs from inside them. */
const ourMounts = () => mounts().filter((m) => !mountsBefore.has(m));
const read = (path) => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
};
/**
 * Processes started for this test: the app, its helpers, and whatever it relaunched. Sandboxed
 * Chromium helpers hide their environment, so they're also found by the profile on their command
 * line or by running from one of this test's mounts.
 */
const ours = () => {
  const mine = ourMounts();
  return readdirSync("/proc")
    .filter((d) => /^\d+$/.test(d))
    .filter((pid) => {
      if (read(`/proc/${pid}/environ`).split("\0").includes(`MIDAD_USER_DATA=${profile}`)) return true;
      const cmdline = read(`/proc/${pid}/cmdline`);
      return cmdline.includes(`=${profile}`) || mine.some((m) => cmdline.startsWith(`${m}/`));
    })
    .map(Number);
};
const signal = (pids, sig) => {
  for (const pid of pids) {
    try {
      process.kill(pid, sig);
    } catch {}
  }
};
/** Stops them gently first, so each AppImage runtime unmounts itself; then forcibly, and unmounts what's left. */
const killOurs = async () => {
  signal(ours(), "SIGTERM");
  for (const until = Date.now() + 5000; ours().length && Date.now() < until; ) await sleep(100);
  signal(ours(), "SIGKILL");
  while (ours().length) await sleep(100);
  for (const m of ourMounts()) {
    try {
      execFileSync("fusermount", ["-uz", m]);
      rmdirSync(m);
    } catch {}
  }
};

let debugPort = 0;
let app = null;
let page = null;
const launch = async (executable) => {
  debugPort = await freePort();
  const child = spawn(executable, ["--no-sandbox", "--ozone-platform=headless", `--remote-debugging-port=${debugPort}`], { env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stdout.on("data", (d) => {
    stderr = (stderr + d).slice(-6000);
  });
  child.stderr.on("data", (d) => {
    stderr = (stderr + d).slice(-6000);
  });
  const page = await connectPage({ port: debugPort, isAlive: () => ours().length > 0 || child.exitCode === null }).catch((err) => {
    throw new Error(`${err.message}\n${stderr}`);
  });
  await page.viewport(1440, 900);
  await page.waitFor(`document.querySelector("#root")?.children.length > 0`, { timeout: 15000 });
  return { page, child, stderr: () => stderr };
};

const shot = async (page, name) => {
  await sleep(350);
  const { data } = await page.call("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(shots, `${name}.png`), Buffer.from(data, "base64"));
  console.log(`  ✓ ${name}.png`);
};
const phase = (page) => page.ev(`document.querySelector("[data-update-phase]")?.dataset.updatePhase ?? null`);
const updatesText = (page) => page.ev(`document.getElementById("updates")?.textContent ?? ""`);
const openUpdates = async (page) => {
  await page.go("#/settings", `!!document.getElementById("updates")`);
  await page.waitFor(`!!document.getElementById("devices") && !!document.querySelector("[data-update-phase]")`);
  await sleep(300);
  await page.ev(`document.querySelector("main").scrollTop = document.querySelector("main").scrollHeight`);
  await sleep(200);
};
const button = (scope, text) => `js:[...document.querySelectorAll(${JSON.stringify(`${scope} button`)})].find((b) => b.textContent.trim() === ${JSON.stringify(text)})`;

try {
  step(`running ${OLD} from ${appImage}, with the feed down`);
  app = await launch(appImage);
  page = app.page;
  await openUpdates(page);
  await page.waitFor(`document.querySelector("[data-update-phase]")?.dataset.updatePhase === "error"`, { timeout: 20000, message: "no Couldn't check with the feed down" });
  assert.ok((await updatesText(page)).includes(`Midad ${OLD}`), "the old version isn't shown");
  assert.ok((await updatesText(page)).includes("Couldn't check: no connection"), `Updates says: ${await updatesText(page)}`);
  await shot(page, "1-couldnt-check");

  step("feed up: Try again finds, downloads and readies the new version");
  await startFeed();
  await openUpdates(page);
  await page.waitStill(button("#updates", "Try again"));
  await page.click(button("#updates", "Try again"));
  await page.waitFor(`document.querySelector("[data-update-phase]")?.dataset.updatePhase === "checking"`, { timeout: 3000 }).catch(async (err) => {
    throw new Error(`Try again didn't start a check (${err.message}); Updates says: ${await updatesText(page)}`);
  });
  await shot(page, "2-checking");
  await page.waitFor(`(() => { const p = document.querySelector("[data-update-phase]")?.dataset.updatePhase; return p === "downloading" && /Downloading ([1-9]\\d?)%/.test(document.getElementById("updates").textContent); })()`, {
    timeout: 30000,
    message: "never showed download progress",
  }).catch(async (err) => {
    throw new Error(`${err.message}; Updates says: ${await updatesText(page)}`);
  });
  await shot(page, "3-downloading");
  await page.waitFor(`document.querySelector("[data-update-phase]")?.dataset.updatePhase === "ready"`, { timeout: 120000, message: "the download never finished" });
  assert.ok((await updatesText(page)).includes("Ready — Restart to update"));
  assert.ok((await updatesText(page)).includes(`Midad ${NEW} installs when you restart`));
  await shot(page, "4-ready-settings");
  await page.go("#/", `!!document.querySelector('[data-update-notice="sidebar"]')`);
  await shot(page, "5-ready-library-notice");

  step("Restart waits while an Ask AI answer streams");
  const bookId = await page.ev(`window.midad["library.list"]().then((books) => books[0]?.bookId)`);
  assert.ok(bookId, "the copied library has no books");
  await page.go(`#/read/${bookId}?p=1`, `!!document.querySelector('[data-update-notice="toolbar"]')`);
  await shot(page, "6-ready-reader-notice");
  await page.click('[aria-label^="Ask AI"]');
  await page.waitFor(`!!document.querySelector("[role=textbox][aria-multiline]")`, { message: "Ask AI didn't open" });
  await page.waitStill("[role=textbox][aria-multiline]");
  await sleep(300);
  await page.click("[role=textbox][aria-multiline]");
  await page.type("Which books are there?");
  await page.waitFor(`document.querySelector("[role=textbox][aria-multiline]").innerText.includes("Which books")`, { message: "the question wasn't typed" });
  await page.press("Enter");
  await page.waitFor(`!!document.querySelector('[aria-label="Stop"]')`, { timeout: 8000, message: "the answer didn't start streaming" });
  await page.waitFor(`document.querySelector('[data-update-notice="toolbar"] button:not([aria-label])')?.disabled === true`, { timeout: 3000, message: "Restart stayed enabled while streaming" });
  await shot(page, "7-restart-held-while-answering");
  await page.waitFor(`!document.querySelector('[aria-label="Stop"]')`, { timeout: 20000, message: "the answer never finished" });
  const answer = await page.ev(`document.body.innerText`);
  assert.match(answer, /NODE: none/, "the fake claude saw a node on PATH");
  assert.match(answer, /BOOKS: \S/, "midad books printed nothing through the shim");
  assert.doesNotMatch(answer, /BOOKS: [^\n]*(not found|ELECTRON|Error)/i, "midad books failed through the shim");
  console.log(`  ✓ midad books ran through the shim with no node: ${answer.match(/BOOKS: [^\n]*/)[0].slice(0, 120)}`);
  await page.waitFor(`document.querySelector('[data-update-notice="toolbar"] button:not([aria-label])')?.disabled === false`, { timeout: 3000, message: "Restart stayed disabled after the answer" });

  step("Restart installs and relaunches");
  // The AppImage runtime serving the old mount can outlive the app (the relaunched one starts inside that mount), so only the app itself must quit.
  const cmdline = (pid) => {
    try {
      return readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0");
    } catch {
      return [];
    }
  };
  const oldApp = ours().filter((pid) => cmdline(pid)[0] !== appImage);
  await page.click(`js:document.querySelector('[data-update-notice="toolbar"] button:not([aria-label])')`);
  page.close();
  const deadline = Date.now() + 60000;
  while (ours().some((pid) => oldApp.includes(pid))) {
    if (Date.now() > deadline) {
      const left = ours().filter((pid) => oldApp.includes(pid));
      throw new Error(`the old version didn't quit after Restart; still running:\n${execFileSync("ps", ["-o", "pid,ppid,stat,args", "-p", left.join(",")], { encoding: "utf8" })}`);
    }
    await sleep(200);
  }
  console.log("  ✓ the old version quit");
  assert.ok(app.stderr().includes(`Executing: ${appImage}`), "the updater didn't relaunch the AppImage");
  console.log("  ✓ the updater relaunched the AppImage (headless here, so it can't open a window)");
  const sha = (file) => createHash("sha512").update(readFileSync(file)).digest("base64");
  assert.equal(sha(appImage), sha(appImageIn(newBuild)), `${appImage} isn't the new build`);
  console.log(`  ✓ ${appImage} is now the ${NEW} AppImage, in place`);
  await killOurs();
  app = await launch(appImage);
  page = app.page;
  await openUpdates(page);
  await page.waitFor(`document.querySelector("[data-update-phase]")?.dataset.updatePhase === "upToDate"`, { timeout: 20000, message: "the new version didn't say Up to date" });
  assert.ok((await updatesText(page)).includes(`Midad ${NEW}`), `after Restart, Updates says: ${await updatesText(page)}`);
  await shot(page, "8-updated-up-to-date");

  step("the shim on its own, with no node on PATH, while the AppImage is mounted");
  const shimOut = execFileSync(join(profile, "ask", "bin", "midad"), ["books"], { env: { PATH, MIDAD_DB: join(profile, "midad.db"), HOME: work }, encoding: "utf8" });
  assert.ok(shimOut.trim().length > 0, "midad books printed nothing");
  console.log(`  ✓ midad books: ${shimOut.trim().split("\n")[0]}`);
  console.log(`  ✓ shim: ${readFileSync(join(profile, "ask", "bin", "midad"), "utf8").split("\n")[1]}`);
  page.close();
  await killOurs();

  step("a packaged build that isn't an AppImage leaves updates alone");
  const before = requests.length;
  app = await launch(join(oldBuild, "linux-unpacked", "midad"));
  page = app.page;
  await openUpdates(page);
  await page.waitFor(`document.querySelector("[data-update-phase]")?.dataset.updatePhase === "managed"`, { timeout: 10000, message: "the unpacked build isn't managed" });
  assert.ok((await updatesText(page)).includes("Managed outside the app"));
  await sleep(2000);
  assert.equal(requests.length, before, "the unpacked build asked the feed for updates");
  await shot(page, "9-managed");
  page.close();
  await killOurs();

  console.log(`\nFeed requests:\n  ${requests.join("\n  ")}`);
  console.log(`\nPassed. Screenshots in ${shots}`);
} catch (err) {
  console.error(`\n✗ ${err.message}`);
  console.error(`App log:\n${app?.stderr().slice(-3000)}`);
  try {
    console.error(`Page text:\n${(await page?.ev("document.body.innerText"))?.slice(-1500)}`);
    if (page) await shot(page, "failure");
  } catch {}
  console.error(`Feed requests:\n  ${requests.join("\n  ")}`);
  process.exitCode = 1;
} finally {
  await killOurs();
  feed?.close();
  rmSync(work, { recursive: true, force: true });
}
