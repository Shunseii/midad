#!/usr/bin/env node
// Two app profiles syncing through the sync server under `wrangler dev` (local only, nothing is
// deployed): `pnpm build && pnpm build:cli`, then `pnpm test:sync`.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { rmSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { assertBuilt, createTemplate, launchApp, ROOT } from "./lib/app.mjs";
import { LONG_BOOK } from "./lib/fixture.mjs";
import { clickPageArea, openReader } from "./lib/reader.mjs";

const CLI = join(ROOT, "out/cli/midad.mjs");
const WRANGLER = join(ROOT, "sync-server/node_modules/.bin/wrangler");
const TOKENS = { a: "e2e-device-a-token", b: "e2e-device-b-token" };
const sha256 = (s) => createHash("sha256").update(s).digest("hex");

const freePort = () =>
  new Promise((done, fail) => {
    const server = createServer();
    server.once("error", fail);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => done(port));
    });
  });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const waitFor = async (check, message, timeout = 45_000, state = null) => {
  const until = Date.now() + timeout;
  let last;
  while (Date.now() < until) {
    last = await check();
    if (last) return last;
    await sleep(200);
  }
  throw new Error(`${message} (waited ${timeout / 1000}s)${state ? `\nlast seen: ${JSON.stringify(await state())}` : ""}`);
};

/** The sync server under wrangler dev, in its own process group so stopping it kills exactly what was started here. */
const startServer = async ({ port, persistTo }) => {
  const users = JSON.stringify({ [sha256(TOKENS.a)]: "e2e-user", [sha256(TOKENS.b)]: "e2e-user" });
  const child = spawn(WRANGLER, ["dev", "--ip", "127.0.0.1", "--port", String(port), "--persist-to", persistTo, "--var", `SYNC_TOKENS:${users}`], {
    cwd: join(ROOT, "sync-server"),
    env: { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "1" },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  const collect = (d) => {
    log = (log + d).slice(-8000);
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);
  await waitFor(() => log.includes("Ready on") || child.exitCode !== null, "wrangler dev didn't start", 90_000);
  if (child.exitCode !== null) throw new Error(`wrangler dev exited:\n${log}`);
  return {
    stop: async () => {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {}
      await waitFor(() => child.exitCode !== null || child.signalCode !== null, "wrangler dev didn't stop", 20_000);
    },
  };
};

const cli = ({ userData, args }) =>
  JSON.parse(execFileSync(process.execPath, ["--no-warnings", CLI, ...args, "--json"], { env: { ...process.env, MIDAD_DB: join(userData, "midad.db") }, stdio: "pipe" }).toString());

const api = (page, channel, input) => page.ev(`window.midad[${JSON.stringify(channel)}](${JSON.stringify(input)})`);
const onPage = (page, position) => api(page, "annotations.list", { bookId: LONG_BOOK, position });
const span = (line, from, to = from) => ({ part: "matn", start: { line, word: from }, end: { line, word: to } });

try {
  assertBuilt();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

const started = Date.now();
const { root, template } = createTemplate();
const port = await freePort();
const url = `ws://127.0.0.1:${port}/sync`;
const persistTo = join(root, "wrangler-state");
let server = await startServer({ port, persistTo });
const open = (name) => launchApp({ root, template, name, keep: true, env: { MIDAD_SYNC_URL: url, MIDAD_SYNC_TOKEN: TOKENS[name] } });
let a = await open("a");
let b = await open("b");

/** Runs `during` while the server is down (both apps offline), then brings it back. */
const offline = async (during) => {
  await server.stop();
  await sleep(500);
  await during();
  server = await startServer({ port, persistTo });
};

const results = [];
const check = async (name, run) => {
  const t = Date.now();
  try {
    await run();
    results.push({ name, ok: true });
    console.log(`  ✓ ${name} (${Date.now() - t}ms)`);
  } catch (err) {
    results.push({ name, ok: false });
    console.log(`  ✗ ${name} (${Date.now() - t}ms)\n      ${String(err.message).split("\n").join("\n      ")}`);
  }
};

console.log("\nSync");

await check("each profile sees the other's highlights, notes and bookmarks, and the reader shows them", async () => {
  const h = await api(a.page, "highlights.add", { bookId: LONG_BOOK, position: 33, span: span(2, 1, 3), color: "green" });
  await waitFor(async () => (await onPage(b.page, 33)).highlights.some((x) => x.id === h.id), "B never got A's highlight");
  const n = await api(b.page, "notes.add", { bookId: LONG_BOOK, position: 33, span: span(3, 1, 2), body: "من الجهاز ب" });
  await waitFor(async () => (await onPage(a.page, 33)).notes.some((x) => x.id === n.id && x.body === "من الجهاز ب"), "A never got B's note");
  await a.page.go(`#/read/${LONG_BOOK}?p=34`, `!!document.querySelector('[data-page-area] [data-w]')`);
  const ribbonOn = () => a.page.ev(`!!document.querySelector("[data-bookmark-ribbon][data-state=on]")`);
  assert.equal(await ribbonOn(), false, "page 34 shouldn't be bookmarked yet");
  await api(b.page, "bookmarks.set", { bookId: LONG_BOOK, position: 34, name: "من ب" });
  await waitFor(ribbonOn, "A's reader never showed B's bookmark on the open page");
});

await check("edits made on both sides while offline all arrive once the server is back", async () => {
  let fromA;
  let fromB;
  await offline(async () => {
    fromA = await api(a.page, "highlights.add", { bookId: LONG_BOOK, position: 35, span: span(2, 1), color: "yellow" });
    fromB = await api(b.page, "highlights.add", { bookId: LONG_BOOK, position: 35, span: span(4, 2), color: "pink" });
    await api(b.page, "library.setProgress", { bookId: LONG_BOOK, position: 35 });
  });
  for (const [who, page] of [["A", a.page], ["B", b.page]]) {
    await waitFor(async () => {
      const ids = (await onPage(page, 35)).highlights.map((x) => x.id);
      return ids.includes(fromA.id) && ids.includes(fromB.id);
    }, `${who} doesn't have both offline highlights`);
  }
  await waitFor(async () => (await api(a.page, "library.get", LONG_BOOK))?.progress?.position === 35, "A never got B's offline reading place", 45_000, async () => [
    (await api(a.page, "library.get", LONG_BOOK))?.progress,
    (await api(b.page, "library.get", LONG_BOOK))?.progress,
  ]);
});

await check("a delete racing an edit is settled by whichever came later, on both sides", async () => {
  const kept = await api(a.page, "notes.add", { bookId: LONG_BOOK, position: 36, span: span(2, 1), body: "سيعدل بعد الحذف" });
  const gone = await api(a.page, "notes.add", { bookId: LONG_BOOK, position: 36, span: span(3, 1), body: "سيحذف بعد التعديل" });
  await waitFor(async () => (await onPage(b.page, 36)).notes.length === 2, "B never got both notes");
  await offline(async () => {
    await api(a.page, "notes.delete", { id: kept.id });
    await sleep(30);
    await api(b.page, "notes.update", { id: kept.id, body: "عدلت بعد الحذف" });
    await api(b.page, "notes.update", { id: gone.id, body: "عدلت قبل الحذف" });
    await sleep(30);
    await api(a.page, "notes.delete", { id: gone.id });
  });
  for (const [who, page] of [["A", a.page], ["B", b.page]]) {
    await waitFor(async () => {
      const notes = (await onPage(page, 36)).notes;
      return notes.length === 1 && notes[0].id === kept.id && notes[0].body === "عدلت بعد الحذف" && notes[0].quote;
    }, `${who} didn't settle on the later action for each note`, 45_000, async () => (await onPage(page, 36)).notes.map((n) => [n.id === kept.id ? "kept" : n.id === gone.id ? "gone" : n.id, n.body]));
  }
});

await check("harakat put on one letter by both devices offline: both show the newer", async () => {
  await offline(async () => {
    await api(a.page, "harakat.set", { bookId: LONG_BOOK, position: 38, part: "matn", line: 2, word: 1, letter: 1, marks: "َ" });
    await sleep(30);
    await api(b.page, "harakat.set", { bookId: LONG_BOOK, position: 38, part: "matn", line: 2, word: 1, letter: 1, marks: "ُ" });
  });
  for (const [who, page] of [["A", a.page], ["B", b.page]]) {
    await waitFor(async () => {
      const harakat = (await onPage(page, 38)).harakat;
      return harakat.length === 1 && harakat[0].marks === "ُ";
    }, `${who} doesn't show just the newer harakat`);
  }
});

await check("the CLI's writes reach the open app at once, and the other device through it", async () => {
  const h = cli({ userData: b.userData, args: ["highlight", "add", LONG_BOOK, "39", "--line", "2", "--words", "1-2", "--color", "blue"] });
  await waitFor(async () => (await onPage(b.page, 39)).highlights.some((x) => x.id === h.id && x.author === "agent"), "B never merged its CLI's highlight");
  await waitFor(async () => (await onPage(a.page, 39)).highlights.some((x) => x.id === h.id), "A never got B's CLI highlight");
});

await check("with the app closed, the CLI's writes are merged on the next start, in order against a newer edit elsewhere", async () => {
  await b.close();
  const h = cli({ userData: b.userData, args: ["highlight", "add", LONG_BOOK, "37", "--line", "2", "--words", "1-3"] });
  const agentNote = cli({ userData: b.userData, args: ["note", "add", LONG_BOOK, "37", "--page", "--body", "من الوكيل"] });
  await sleep(50);
  const readerNote = await api(a.page, "notes.add", { bookId: LONG_BOOK, position: 37, page: true, body: "من القارئ" });
  assert.equal(readerNote.id, agentNote.id, "the two page notes should share the page's id");
  b = await open("b");
  for (const [who, page] of [["A", a.page], ["B", b.page]]) {
    await waitFor(async () => {
      const found = await onPage(page, 37);
      return found.highlights.some((x) => x.id === h.id) && found.pageNote?.body === "من القارئ" && found.pageNote.author === "me";
    }, `${who} should have the CLI's highlight and the reader's newer page note`);
  }
});

await check("Ctrl+Z never puts back an old value over a newer edit from the other device", async () => {
  const bookmarkOn = (page, position) => api(page, "bookmarks.list", { bookId: LONG_BOOK }).then((list) => list.find((x) => x.position === position) ?? null);
  const ctrl = (key) => a.page.press(key, { code: `Key${key.toUpperCase()}`, ctrl: true });
  // Undo works as before on what only this device touched.
  await openReader(a.page, { bookId: LONG_BOOK, position: 41 });
  await clickPageArea(a.page);
  await ctrl("d");
  await waitFor(async () => (await bookmarkOn(a.page, 41)) !== null, "Ctrl+D didn't bookmark page 41");
  await ctrl("z");
  await waitFor(async () => (await bookmarkOn(a.page, 41)) === null, "Ctrl+Z didn't take back the bookmark");

  await openReader(a.page, { bookId: LONG_BOOK, position: 42 });
  await clickPageArea(a.page);
  await ctrl("d");
  await waitFor(async () => (await bookmarkOn(b.page, 42)) !== null, "B never got A's bookmark");
  await api(b.page, "bookmarks.set", { bookId: LONG_BOOK, position: 42, name: "أعاد ب تسميتها" });
  await waitFor(async () => (await bookmarkOn(a.page, 42))?.name === "أعاد ب تسميتها", "A never got B's rename");
  await ctrl("z");
  await sleep(1500);
  for (const [who, page] of [["A", a.page], ["B", b.page]]) {
    assert.equal((await bookmarkOn(page, 42))?.name, "أعاد ب تسميتها", `${who}: Ctrl+Z on A undid the bookmark over B's newer rename`);
  }
});

await a.close();
await b.close();
await server.stop();
rmSync(root, { recursive: true, force: true });

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed in ${((Date.now() - started) / 1000).toFixed(1)}s`);
process.exit(failed.length ? 1 : 0);
