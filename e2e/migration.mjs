#!/usr/bin/env node
// Migrates a COPY of a library to the user store and checks every row survived, field by field.
// `pnpm build && pnpm build:cli`, then `node e2e/migration.mjs <folder holding a copied midad.db>`.
// The folder is copied again first; the given one is never opened for writing.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createMergeableStore } from "tinybase";
import { assertBuilt, launchApp, ROOT } from "./lib/app.mjs";

const source = resolve(process.argv[2] ?? "");
if (!process.argv[2] || source.startsWith(join(homedir(), ".config")) || source.startsWith(join(homedir(), ".local"))) {
  console.error("Give a folder holding a COPY of midad.db (not the real profile).");
  process.exit(2);
}
assertBuilt();

const root = mkdtempSync(join(tmpdir(), "midad-migration-"));
const template = join(root, "template");
cpSync(source, template, { recursive: true, filter: (p) => !p.includes("Local Storage") });
const dbPath = join(root, "library", "midad.db");

const legacyTables = ["books", "highlights", "notes", "harakat", "markers", "bookmarks", "progress", "conversations", "turns"];
const snapshot = (db) => Object.fromEntries(legacyTables.map((t) => [t, db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()]));
const digest = (rows) => createHash("sha256").update(JSON.stringify(rows)).digest("hex");

const before = (() => {
  const db = new DatabaseSync(join(template, "midad.db"));
  const rows = snapshot(db);
  db.close();
  return rows;
})();

// Migrate the way it happens for real: the app starts on the old library, then the CLI runs.
const t0 = Date.now();
const app = await launchApp({ root, template, name: "library", keep: true });
const appStartMs = Date.now() - t0;
await app.close();

const cli = (args) => {
  const t = process.hrtime.bigint();
  const out = execFileSync(process.execPath, ["--no-warnings", join(ROOT, "out/cli/midad.mjs"), ...args], { env: { ...process.env, MIDAD_DB: dbPath } }).toString();
  return { out, ms: Number(process.hrtime.bigint() - t) / 1e6 };
};
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const booksMs = median(Array.from({ length: 9 }, () => cli(["books"]).ms));
// A write: the CLI saves its own copy (removing it again leaves the content as migrated, plus tombstones).
const target = before.highlights[0] ?? null;
const position = target ? new DatabaseSync(dbPath, { readOnly: true }).prepare("SELECT position FROM pages WHERE book_id = ? AND file_id = ?").get(target.book_id, target.file_id)?.position : null;
const writes = position
  ? Array.from({ length: 5 }, () => {
      const add = cli(["highlight", "add", target.book_id, String(position), "--line", "1", "--words", "1", "--json"]);
      const remove = cli(["highlight", "remove", JSON.parse(add.out).id]);
      return add.ms + remove.ms;
    })
  : [];
const writeMs = writes.length ? median(writes) / 2 : null;

const db = new DatabaseSync(dbPath);
const after = snapshot(db);
const clients = db.prepare("SELECT client_id, length(content) AS bytes, content FROM sync_stores").all();
const sessions = new Map(db.prepare("SELECT * FROM conversation_sessions").all().map((r) => [r.conversation_id, r.session_id]));
db.close();

const UNDEFINED = "￼";
const decode = (text) => {
  const restore = (v) => (v === UNDEFINED ? undefined : Array.isArray(v) ? v.map(restore) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, restore(x)])) : v);
  return restore(JSON.parse(text));
};
const store = createMergeableStore("check");
const mergeStart = process.hrtime.bigint();
for (const c of clients) store.applyMergeableChanges(decode(c.content));
const mergeMs = Number(process.hrtime.bigint() - mergeStart) / 1e6;

const problems = [];
const expectRow = ({ table, id, want }) => {
  const got = store.getRow(table, id);
  for (const [cell, value] of Object.entries(want)) {
    if (got[cell] !== value) problems.push(`${table}/${id}.${cell}: expected ${JSON.stringify(value)}, got ${JSON.stringify(got[cell])}`);
  }
};
const counts = {};
const count = (table, n) => {
  counts[table] = { legacy: n, store: store.getRowCount(table === "books" ? "library" : table) };
};

for (const h of before.highlights)
  expectRow({ table: "highlights", id: h.id, want: { bookId: h.book_id, fileId: h.file_id, span: h.span, quote: h.quote, color: h.color, author: h.author, createdAt: h.created_at } });
for (const n of before.notes) {
  const id = n.kind === "page" ? `${n.book_id}:${n.file_id}` : n.id;
  expectRow({ table: "notes", id, want: { bookId: n.book_id, fileId: n.file_id, kind: n.kind, span: n.span, quote: n.quote, body: n.body, author: n.author, createdAt: n.created_at, updatedAt: n.updated_at } });
}
for (const h of before.harakat)
  expectRow({
    table: "harakat",
    id: h.id,
    want: { bookId: h.book_id, fileId: h.file_id, part: h.part, line: h.line, word: h.word, letter: h.letter, marks: h.marks, base: h.base, author: h.author, createdAt: h.created_at },
  });
for (const m of before.markers) expectRow({ table: "markers", id: m.book_id, want: { fileId: m.file_id, part: m.part, line: m.line, word: m.word, setAt: m.set_at } });
for (const b of before.bookmarks) expectRow({ table: "bookmarks", id: `${b.book_id}:${b.file_id}`, want: { bookId: b.book_id, fileId: b.file_id, name: b.name, createdAt: b.created_at } });
for (const p of before.progress) expectRow({ table: "progress", id: p.book_id, want: { fileId: p.file_id, updatedAt: p.updated_at, anchor: p.anchor } });
for (const b of before.books) expectRow({ table: "library", id: b.book_id, want: { addedAt: b.imported_at } });
for (const c of before.conversations) {
  expectRow({ table: "conversations", id: c.id, want: { bookId: c.book_id, title: c.title, position: c.position, createdAt: c.created_at, updatedAt: c.updated_at } });
  if ((sessions.get(c.id) ?? null) !== c.session_id) problems.push(`conversation_sessions/${c.id}: expected ${c.session_id}, got ${sessions.get(c.id)}`);
}
for (const t of before.turns)
  expectRow({
    table: "turns",
    id: t.id,
    want: {
      conversationId: t.conversation_id,
      question: t.question,
      quotes: t.quotes,
      position: t.position,
      selection: t.selection,
      answer: t.answer,
      status: t.status === "streaming" ? "interrupted" : t.status,
      error: t.error,
      createdAt: t.created_at,
    },
  });
for (const table of legacyTables) count(table, before[table].length);

// Turn order within each conversation must match SQLite's (created_at, rowid).
for (const c of before.conversations) {
  const legacyOrder = before.turns.filter((t) => t.conversation_id === c.id).map((t) => t.id);
  const storeOrder = Object.entries(store.getTable("turns"))
    .filter(([, t]) => t.conversationId === c.id)
    .sort(([, a], [, b]) => a.createdAt - b.createdAt || a.seq - b.seq)
    .map(([id]) => id);
  if (JSON.stringify(legacyOrder) !== JSON.stringify(storeOrder)) problems.push(`turn order differs in conversation ${c.id}`);
}

for (const table of legacyTables) if (digest(before[table]) !== digest(after[table])) problems.push(`legacy table ${table} changed`);

console.log(JSON.stringify({ counts, clients: clients.map((c) => ({ client: c.client_id, bytes: c.bytes })), appStartMs, cliBooksMedianMs: booksMs, cliWriteMedianMs: writeMs, mergeAllClientsMs: mergeMs }, null, 2));
rmSync(root, { recursive: true, force: true });
if (problems.length) {
  console.log(`\n${problems.length} problems:\n${problems.slice(0, 50).join("\n")}`);
  process.exit(1);
}
for (const [table, { legacy, store: n }] of Object.entries(counts)) assert.ok(n >= legacy, `${table}: ${n} rows in the store for ${legacy} legacy rows`);
console.log("\nEvery row survived with identical content.");
