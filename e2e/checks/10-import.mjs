import assert from "node:assert/strict";
import { createServer } from "node:http";
import { buttonByText } from "../lib/reader.mjs";

export const name = "Import";

const GOOD = { id: "e2e-import", title: "كتاب الاستيراد", pages: 230 };
// Its second batch fails, as a bad cursor would.
const BROKEN = { id: "e2e-broken", title: "كتاب معطوب", pages: 120 };
const BOOKS = [GOOD, BROKEN];
/** Each batch takes this long, so the bar can be watched moving. */
const BATCH_DELAY = 300;

const requests = [];

const exportFile = (book, n) => ({ file_id: `${book.id}-f${n}`, page_number: n, role: null, order_hint: n, state: "done", text: `صفحة ${n} من الكتاب` });

const reply = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

/** Stands in for the corpus Worker: the book list, one book, and the batched export. */
const corpus = createServer((req, res) => {
  const url = new URL(req.url, "http://corpus");
  requests.push(url.pathname + url.search);
  if (url.pathname === "/api/works") return reply(res, 200, { success: true, works: [] });
  if (url.pathname === "/api/books")
    return reply(res, 200, { success: true, books: BOOKS.map((b) => ({ id: b.id, title: b.title, created_at: 0, files_total: b.pages, counts: { done: b.pages } })) });
  const match = /^\/api\/books\/([^/]+)(\/export)?$/.exec(url.pathname);
  const book = BOOKS.find((b) => b.id === match?.[1]);
  if (!book) return reply(res, 404, { success: false, error: "not found" });
  if (!match[2]) return reply(res, 200, { success: true, book: { id: book.id, title: book.title, created_at: 0, files_total: book.pages, counts: { done: book.pages } } });
  const limit = Number(url.searchParams.get("limit"));
  const after = url.searchParams.has("cursor") ? Number(url.searchParams.get("cursor").replace("after ", "")) : 0;
  setTimeout(() => {
    if (book === BROKEN && after > 0) return reply(res, 400, { success: false, error: "Malformed cursor" });
    const last = Math.min(after + limit, book.pages);
    const files = Array.from({ length: last - after }, (_, i) => exportFile(book, after + i + 1));
    reply(res, 200, { success: true, book_id: book.id, files, files_total: book.pages, next_cursor: last < book.pages ? `after ${last}` : null });
  }, BATCH_DELAY);
});

const row = (title) => `[...document.querySelectorAll("[role=dialog] li")].find((li) => li.textContent.includes(${JSON.stringify(title)}))`;
const rowState = (page, title) =>
  page.ev(`(() => { const li = ${row(title)}; const bar = li?.querySelector("[role=progressbar]"); return li && { meta: li.querySelector(".text-xs").textContent.trim(), bar: bar ? Number(bar.getAttribute("aria-valuenow")) : null, badge: li.textContent.includes("In library") }; })()`);

const openImport = async (page) => {
  await page.click(buttonByText("Import"));
  await page.waitFor(`!!(${row(GOOD.title)})`, { message: "the corpus books didn't load in the import dialog" });
};

export const checks = [
  [
    "importing shows each batch arriving as an accurate count and bar, then lands in the library",
    async (page) => {
      await new Promise((done) => corpus.listen(0, "127.0.0.1", done));
      const endpoint = `http://127.0.0.1:${corpus.address().port}`;
      await page.ev(`window.midad["settings.save"]({ endpoint: ${JSON.stringify(endpoint)}, key: "e2e-key" })`);
      await page.go("#/", `!!document.querySelector("[data-book]")`);
      await openImport(page);
      requests.length = 0;
      await page.click(`js:${row(GOOD.title)}.querySelector("button")`);
      const seen = [];
      for (let t = 0; t < 80; t++) {
        const state = await rowState(page, GOOD.title);
        // The dialog closes once the book is in.
        if (!state) break;
        if (JSON.stringify(state) !== JSON.stringify(seen.at(-1))) seen.push(state);
        await page.sleep(50);
      }
      const counts = seen.map((s) => /^Importing ([\d,]+) of ([\d,]+) pages$/.exec(s.meta)).filter(Boolean).map((m) => [Number(m[1]), Number(m[2])]);
      // The last batch hands straight over to saving, often before a frame shows 230 of 230.
      if (counts.at(-1)?.[0] === 230) counts.pop();
      assert.deepEqual(counts, [[50, 230], [100, 230], [150, 230], [200, 230]], `counts shown: ${JSON.stringify(seen.map((s) => s.meta))}`);
      const bars = seen.filter((s) => s.meta.startsWith("Importing ") && s.bar !== null && /\d/.test(s.meta)).map((s) => s.bar);
      if (bars.at(-1) === 100) bars.pop();
      assert.deepEqual(bars, [22, 43, 65, 87], "the bar matches the count");
      assert.ok(await page.ev(`document.body.textContent.includes("Imported 230 pages")`), "no Imported 230 pages message");
      const exports = requests.filter((r) => r.includes("/export"));
      assert.deepEqual(exports, [0, 50, 100, 150, 200].map((n) => `/api/books/${GOOD.id}/export?limit=50${n ? `&cursor=after%20${n}` : ""}`), "export requests");
      const imported = await page.ev(`window.midad["library.get"](${JSON.stringify(GOOD.id)}).then((b) => b?.pages.length ?? 0)`);
      assert.equal(imported, GOOD.pages, "pages in the library");
    },
  ],
  [
    "a batch that fails shows the error, imports nothing and lets you try again",
    async (page) => {
      await openImport(page);
      await page.click(`js:${row(BROKEN.title)}.querySelector("button")`);
      await page.waitFor(`!!document.querySelector("[role=dialog] .text-danger")`, { timeout: 5000, message: "no error shown" });
      const error = await page.ev(`document.querySelector("[role=dialog] .text-danger").textContent`);
      assert.match(error, /Malformed cursor/);
      const state = await rowState(page, BROKEN.title);
      assert.equal(state.bar, null, "the bar stayed after the failure");
      assert.ok(await page.ev(`!${row(BROKEN.title)}.querySelector("button").disabled`), "Import isn't available again");
      assert.equal(await page.ev(`window.midad["library.get"](${JSON.stringify(BROKEN.id)})`), null, "a failed import left a book behind");
      corpus.close();
    },
  ],
];
