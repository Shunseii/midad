import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export const LONG_BOOK = "e2e-long-book";
export const SHORT_BOOK = "e2e-short-book";
export const LONG_PAGES = 300;
export const SHORT_PAGES = 20;
/** The long book's first heading. Pages before it belong to no contents entry. */
export const FIRST_HEADING_PAGE = 5;

// The subset of src/main/library.ts and src/main/bookmarks.ts the seed writes to. The app
// runs its own CREATE TABLE IF NOT EXISTS and migrations on top when it opens the file.
const SCHEMA = `
CREATE TABLE books (
  book_id TEXT PRIMARY KEY, title TEXT NOT NULL, author TEXT, edition TEXT,
  imported_at INTEGER NOT NULL, synced_at INTEGER NOT NULL
);
CREATE TABLE pages (
  book_id TEXT NOT NULL REFERENCES books(book_id) ON DELETE CASCADE,
  file_id TEXT NOT NULL, position INTEGER NOT NULL, number INTEGER, order_hint INTEGER,
  header TEXT, matn TEXT NOT NULL, hashiya TEXT NOT NULL, source TEXT NOT NULL,
  updated_at INTEGER NOT NULL, PRIMARY KEY (book_id, file_id)
);
CREATE INDEX pages_by_position ON pages (book_id, position);
CREATE TABLE progress (
  book_id TEXT PRIMARY KEY REFERENCES books(book_id) ON DELETE CASCADE,
  file_id TEXT NOT NULL, updated_at INTEGER NOT NULL, anchor TEXT
);
CREATE TABLE bookmarks (
  book_id TEXT NOT NULL, file_id TEXT NOT NULL, name TEXT, created_at INTEGER NOT NULL,
  PRIMARY KEY (book_id, file_id),
  FOREIGN KEY (book_id, file_id) REFERENCES pages (book_id, file_id) ON DELETE CASCADE
);
`;

const WORDS = "قال الشيخ رحمه الله تعالى في بيان هذا الباب إن العلم نور يهدي به الله من يشاء من عباده والكلام فيه على وجوه كثيرة نذكر منها ما يليق بالمقام".split(" ");

const line = (seed) => Array.from({ length: 14 }, (_, i) => WORDS[(seed * 7 + i * 3) % WORDS.length]).join(" ");

const LONG_TITLE = "في بيان أقسام الكلام وأحكامه وما يتعلق به من المسائل التي ذكرها أهل العلم في كتبهم المطولة";

/** Headings every ten pages from FIRST_HEADING_PAGE; every third has a title long enough to wrap. */
const headingOn = (position) => {
  if (position < FIRST_HEADING_PAGE || (position - FIRST_HEADING_PAGE) % 10 !== 0) return null;
  const n = (position - FIRST_HEADING_PAGE) / 10 + 1;
  return n % 3 === 0 ? `باب ${n} ${LONG_TITLE}` : `باب ${n} في العلم`;
};

const pageSource = ({ position, heading }) => {
  const matn = Array.from({ length: 16 }, (_, i) => line(position + i));
  if (heading) matn.splice(3, 0, `## ${heading}`);
  return [...matn, "", "---", "### الحاشية", `(١) ${line(position + 99)}`].join("\n");
};

const insertBook = ({ db, bookId, title, author, pages, withHeadings }) => {
  const now = Date.now();
  db.prepare("INSERT INTO books VALUES (?, ?, ?, NULL, ?, ?)").run(bookId, title, author, now, now);
  const insert = db.prepare("INSERT INTO pages VALUES (?, ?, ?, ?, ?, NULL, '[]', '[]', ?, ?)");
  for (let position = 1; position <= pages; position++) {
    const heading = withHeadings ? headingOn(position) : null;
    insert.run(bookId, `${bookId}-f${position}`, position, position + 2, position, pageSource({ position, heading }), now);
  }
};

const FAKE_CLAUDE = `#!/usr/bin/env node
// Stands in for Claude Code: streams stream-json text deltas slowly, then a result.
const words = Array.from({ length: 1000 }, (_, i) => (i % 40 === 39 ? "word.\\n\\n" : "word" + i + " "));
let i = 0;
const out = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
const tick = () => {
  if (i >= words.length) { out({ type: "result", subtype: "success", result: words.join(""), session_id: "fake-session" }); process.exit(0); }
  out({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: words.slice(i, i + 6).join("") } } });
  i += 6;
  setTimeout(tick, 100);
};
setTimeout(tick, 200);
`;

const cli = ({ dbPath, cliPath, args }) =>
  execFileSync(process.execPath, ["--no-warnings", cliPath, ...args], { env: { ...process.env, MIDAD_DB: dbPath }, stdio: "pipe" });

/** Writes a synthetic library and a fake `claude` into a fresh user-data folder. */
export const seedUserData = ({ dir, cliPath }) => {
  mkdirSync(dir, { recursive: true });
  const dbPath = join(dir, "midad.db");
  const db = new DatabaseSync(dbPath);
  db.exec(SCHEMA);
  insertBook({ db, bookId: LONG_BOOK, title: "كتاب الاختبار الطويل", author: "مؤلف تجريبي", pages: LONG_PAGES, withHeadings: true });
  insertBook({ db, bookId: SHORT_BOOK, title: "رسالة قصيرة", author: null, pages: SHORT_PAGES, withHeadings: false });
  const now = Date.now();
  // The long book is being read (page 10); the short one is finished.
  db.prepare("INSERT INTO progress VALUES (?, ?, ?, NULL)").run(LONG_BOOK, `${LONG_BOOK}-f10`, now);
  db.prepare("INSERT INTO progress VALUES (?, ?, ?, NULL)").run(SHORT_BOOK, `${SHORT_BOOK}-f${SHORT_PAGES}`, now - 1000);
  const bookmark = db.prepare("INSERT INTO bookmarks VALUES (?, ?, ?, ?)");
  bookmark.run(LONG_BOOK, `${LONG_BOOK}-f40`, "علامة", now);
  bookmark.run(LONG_BOOK, `${LONG_BOOK}-f200`, null, now);
  db.close();

  for (const [page, color] of [[60, "yellow"], [120, "green"], [250, "pink"]]) {
    cli({ dbPath, cliPath, args: ["highlight", "add", LONG_BOOK, String(page), "--line", "2", "--words", "1-3", "--color", color] });
  }
  for (const page of [90, 160]) {
    cli({ dbPath, cliPath, args: ["note", "add", LONG_BOOK, String(page), "--line", "5", "--words", "2-3", "--body", "ملاحظة تجريبية"] });
  }

  const bin = join(dir, "ask", "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "claude"), FAKE_CLAUDE);
  chmodSync(join(bin, "claude"), 0o755);
};
