#!/usr/bin/env node
// Two app profiles syncing through the sync server under `wrangler dev` (local only, nothing is
// deployed): `pnpm build && pnpm build:cli`, then `pnpm test:sync`.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { connect, createServer as createNetServer } from "node:net";
import { join } from "node:path";
import { createMergeableStore } from "tinybase";
import { createWsSynchronizer } from "tinybase/synchronizers/synchronizer-ws-client";
import { assertBuilt, createTemplate, launchApp, ROOT } from "./lib/app.mjs";
import { LONG_BOOK, SHORT_BOOK, SHORT_PAGES } from "./lib/fixture.mjs";
import { clickPageArea, openReader } from "./lib/reader.mjs";
import { freePort, startSyncServer } from "./lib/sync-server.mjs";

const CLI = join(ROOT, "out/cli/midad.mjs");
const TOKENS = { a: "e2e-device-a-token", b: "e2e-device-b-token" };
const startServer = ({ port, persistTo }) => startSyncServer({ port, persistTo, tokens: { [TOKENS.a]: "e2e-user", [TOKENS.b]: "e2e-user" } });

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

/** A bare TinyBase client on the server (not the app), for checks that need control of its clock. */
const rawClient = async ({ name, getNow, path = "/sync" }) => {
  const store = createMergeableStore(name, getNow, 100 * 365 * 24 * 60 * 60);
  const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, { headers: { authorization: `Bearer ${TOKENS.a}` } });
  const synchronizer = await createWsSynchronizer(store, ws, 15);
  await synchronizer.startSync();
  return { store, stop: () => synchronizer.destroy() };
};

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

await check("Ask AI's memories reach the other device, with edits, moves between books and deletes", async () => {
  const memoriesOn = (page) => api(page, "memories.list", undefined);
  const saved = cli({ userData: b.userData, args: ["memory", "add", "--type", "preference", "--name", "sync-check", "--description", "Transliterate terms on every device", "--body", "x"] });
  const forBook = cli({ userData: b.userData, args: ["memory", "add", "--book", LONG_BOOK, "--type", "book", "--name", "sync-goal", "--description", "Reading for the exam", "--body", "y"] });
  await waitFor(async () => {
    const ids = (await memoriesOn(a.page)).map((m) => m.id);
    return ids.includes(saved.id) && ids.includes(forBook.id);
  }, "A never got B's CLI memories");
  await api(a.page, "memories.update", { id: saved.id, description: "Transliterate terms, in brackets", body: "x", bookId: LONG_BOOK });
  await api(a.page, "memories.remove", { id: forBook.id });
  await waitFor(async () => {
    const found = await memoriesOn(b.page);
    const moved = found.find((m) => m.id === saved.id);
    return !found.some((m) => m.id === forBook.id) && moved?.bookId === LONG_BOOK && moved.description === "Transliterate terms, in brackets" && moved.author === "agent" && moved.editedAt !== null;
  }, "B didn't get A's edit, move and delete", 45_000, async () => memoriesOn(b.page));
  const searched = cli({ userData: b.userData, args: ["memory", "search", "brackets", "--book", LONG_BOOK] });
  assert.deepEqual(searched.map((m) => m.id), [saved.id], "B's CLI search didn't follow the synced edit");
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

await check("an open note editor shows the other device's edit until something is typed, then keeps the typing", async () => {
  const note = await api(a.page, "notes.add", { bookId: LONG_BOOK, position: 44, page: true, body: "كما كتبت" });
  await waitFor(async () => (await onPage(b.page, 44)).pageNote?.body === "كما كتبت", "B never got the page note");
  await openReader(a.page, { bookId: LONG_BOOK, position: 44 });
  await a.page.click('[aria-label^="Show highlights and notes"]');
  const tab = `js:[...document.querySelectorAll("[role=tab]")].find((t) => t.textContent.trim() === "Notes")`;
  await a.page.waitStill(tab);
  await a.page.click(tab);
  await a.page.waitFor(`!!document.querySelector('[data-page-note] [aria-label="Edit note"]')`, { message: "no page note to edit in the panel" });
  await a.page.click('[data-page-note] [aria-label="Edit note"]');
  const box = `document.querySelector('textarea[aria-label="Note"]')`;
  await a.page.waitFor(`!!${box}`, { message: "the note editor didn't open" });
  await api(b.page, "notes.update", { id: note.id, body: "عدلها ب" });
  await waitFor(() => a.page.ev(`${box}?.value === "عدلها ب"`), "A's open editor never showed B's edit", 15_000, () => a.page.ev(`${box}?.value`));
  await a.page.type(" وأضفت");
  await api(b.page, "notes.update", { id: note.id, body: "عدلها ب مرة أخرى" });
  await waitFor(async () => (await onPage(a.page, 44)).pageNote?.body === "عدلها ب مرة أخرى", "A never got B's second edit");
  await sleep(500);
  assert.equal(await a.page.ev(`${box}?.value`), "عدلها ب وأضفت", "A's unsaved typing was replaced");
});

await check("a new device with an empty library sees the books waiting from the others, and imports one from the corpus", async () => {
  // Stands in for the corpus Worker, for the short book only: its metadata and its batched export.
  const corpus = createHttpServer((req, res) => {
    const url = new URL(req.url, "http://corpus");
    const reply = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const book = { id: SHORT_BOOK, title: "رسالة قصيرة", created_at: 0, files_total: SHORT_PAGES, counts: { done: SHORT_PAGES } };
    if (url.pathname === "/api/works") return reply(200, { success: true, works: [] });
    if (url.pathname === "/api/books") return reply(200, { success: true, books: [book] });
    if (url.pathname === `/api/books/${SHORT_BOOK}`) return reply(200, { success: true, book });
    if (url.pathname === `/api/books/${SHORT_BOOK}/export`) {
      const files = Array.from({ length: SHORT_PAGES }, (_, i) => ({ file_id: `${SHORT_BOOK}-f${i + 1}`, page_number: i + 1, role: null, order_hint: i + 1, state: "done", text: `صفحة ${i + 1}` }));
      return reply(200, { success: true, book_id: SHORT_BOOK, files, files_total: SHORT_PAGES, next_cursor: null });
    }
    reply(404, { success: false, error: "not found" });
  });
  await new Promise((done) => corpus.listen(0, "127.0.0.1", done));
  const emptyTemplate = join(root, "empty-template");
  mkdirSync(emptyTemplate, { recursive: true });
  const c = await launchApp({ root, template: emptyTemplate, name: "c", keep: true, env: { MIDAD_SYNC_URL: url, MIDAD_SYNC_TOKEN: TOKENS.a } });
  try {
    const waitingRow = (bookId) => `document.querySelector('[data-waiting-book="${bookId}"]')`;
    await c.page.go("#/", `!!document.querySelector("h1")`);
    await waitFor(() => c.page.ev(`!!${waitingRow(LONG_BOOK)} && !!${waitingRow(SHORT_BOOK)}`), "C's library never listed the two books from the other devices");
    assert.equal(await c.page.ev(`document.body.textContent.includes("Your library is empty")`), false, "C still says its library is empty");
    const rowText = await c.page.ev(`${waitingRow(SHORT_BOOK)}.textContent`);
    assert.ok(rowText.includes("رسالة قصيرة") && rowText.includes("Needs the corpus"), `the row should name the book and say it needs the corpus: ${rowText}`);

    assert.equal(await c.page.ev(`document.body.textContent.includes("Set up the corpus connection to import books")`), false, "the panel already says to set up the corpus");
    await c.page.go(`#/read/${LONG_BOOK}?p=60`, `document.body.textContent.includes("on another device")`);
    assert.deepEqual(await api(c.page, "annotations.list", { bookId: LONG_BOOK, position: 60 }), { highlights: [], notes: [], pageNote: null, harakat: [] });

    // Saved behind the Settings screen's back, so reload for the window to read it.
    await api(c.page, "settings.save", { endpoint: `http://127.0.0.1:${corpus.address().port}`, key: "e2e-key" });
    await c.page.go("#/", `!!document.querySelector("h1")`);
    await c.page.ev("location.reload()");
    await waitFor(() => c.page.ev(`!!${waitingRow(SHORT_BOOK)}`).catch(() => false), "the waiting books didn't come back after reloading");
    const importButton = `[...${waitingRow(SHORT_BOOK)}.querySelectorAll("button")].find((b) => b.textContent.trim() === "Import")`;
    await c.page.waitFor(`!!(${importButton})`, { timeout: 10_000, message: "no Import button once the corpus is set up" });
    await c.page.ev(`(${importButton}).click()`);
    await waitFor(async () => (await api(c.page, "library.list")).some((bk) => bk.bookId === SHORT_BOOK && bk.pageCount === SHORT_PAGES), "the short book never landed in C's library");
    await waitFor(() => c.page.ev(`!${waitingRow(SHORT_BOOK)} && !!${waitingRow(LONG_BOOK)}`), "the imported book's row didn't leave the panel, or the other one went too");
  } finally {
    await c.close();
    corpus.close();
  }
});

await a.close();
await b.close();

/** A TCP proxy to the server that sends the server's replies at `bytesPerSecond`, like a slow link. */
const slowLink = async ({ bytesPerSecond }) => {
  const proxy = createNetServer((client) => {
    const upstream = connect(port, "127.0.0.1");
    client.pipe(upstream);
    upstream.on("data", (chunk) => {
      upstream.pause();
      let at = 0;
      const step = Math.max(1, Math.floor(bytesPerSecond / 20));
      const next = () => {
        if (client.destroyed) return;
        client.write(chunk.subarray(at, at + step));
        at += step;
        if (at < chunk.length) setTimeout(next, 50);
        else upstream.resume();
      };
      next();
    });
    const close = () => {
      client.destroy();
      upstream.destroy();
    };
    client.on("error", close);
    upstream.on("error", close);
    client.on("close", close);
    upstream.on("close", close);
  });
  await new Promise((done) => proxy.listen(0, "127.0.0.1", done));
  return { port: proxy.address().port, close: () => proxy.close() };
};

await check("a new device on a slow link gets a large library in full, without its first sync timing out", async () => {
  const seed = await rawClient({ name: "big-library" });
  const titles = 1500;
  seed.store.transaction(() => {
    // Random text, so the WebSocket's compression can't shrink it: about 400 KB, like a real library's first sync.
    for (let i = 0; i < titles; i++) seed.store.setRow("library", `slow-link-${i}`, { addedAt: i, title: randomBytes(150).toString("base64"), author: randomBytes(30).toString("base64") });
  });
  await sleep(2000);
  await seed.stop();
  const link = await slowLink({ bytesPerSecond: 25_000 });
  const emptyTemplate = join(root, "empty-template-slow");
  mkdirSync(emptyTemplate, { recursive: true });
  const d = await launchApp({ root, template: emptyTemplate, name: "d", keep: true, env: { MIDAD_SYNC_URL: `ws://127.0.0.1:${link.port}/sync`, MIDAD_SYNC_TOKEN: TOKENS.a } });
  try {
    const arrived = () => api(d.page, "library.elsewhere").then((list) => list.filter((bk) => bk.bookId.startsWith("slow-link-")).length);
    await waitFor(async () => (await arrived()) === titles, "the slow device never got the whole library", 120_000, arrived);
  } finally {
    await d.close();
    link.close();
  }
});

// Last, with the apps closed: a fast clock's stamps move every other clock forward with them, which
// would reorder the checks above, and with no app online only the server's stored copy can carry the edit.
await check("a device whose clock runs an hour fast still gets its edits to the others through the server's copy", async () => {
  const fast = await rawClient({ name: "fast-clock", getNow: () => Date.now() + 60 * 60 * 1000 });
  fast.store.setRow("skew-check", "row", { from: "the fast clock" });
  await sleep(1500);
  await fast.stop();
  const later = await rawClient({ name: "normal-clock" });
  try {
    await waitFor(() => later.store.getCell("skew-check", "row", "from") === "the fast clock", "the server dropped the fast clock's edit", 10_000);
  } finally {
    await later.stop();
  }
});

await server.stop();
rmSync(root, { recursive: true, force: true });

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed in ${((Date.now() - started) / 1000).toFixed(1)}s`);
process.exit(failed.length ? 1 : 0);
