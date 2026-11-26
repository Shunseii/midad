import type { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";
import { HIGHLIGHT_COLORS, type HighlightColor, type LetterRef, type NoteTarget, type PageAnnotations, type Part, type Span, wordsOf } from "../shared/annotations";
import { MARK, type MarkName } from "../shared/harakat";
import { type BookRemoval, removalCounts, type StoredPage } from "../shared/library";
import { createAnnotations } from "../main/annotations";
import { createBookRemoval } from "../main/book-removal";
import { createPageFinder } from "../main/find-page";
import { createLibrary } from "../main/library";
import { createMemories } from "../main/memories";
import { isMemoryType, MEMORY_TYPES, type Memory, type MemoryType } from "../shared/memories";

export const MEMORY_USAGE = `Memory (what Ask AI remembers about the reader across chats; labelled as written by the agent)
  midad memory list [--type <type>] [--global | --book <book> | --all]
                                                Newest first: global memories and this book's, unless a flag narrows it
  midad memory search <query> [--global | --book <book>] [--limit <n>]
                                                Memories matching any of the words, best match first
  midad memory get <id>                         One memory in full
  midad memory add --type <type> --name <slug> --description <line> --body <text> [--book <book>]
  midad memory update <id> [--description <line>] [--body <text>] [--name <slug>] [--type <type>] [--book <book> | --global]
  midad memory delete <id>

A memory is global unless added with --book: then only chats about that book see it.
Global: who the reader is and how they want answers in general. --book: about that
book's text, its author's terms, or how to read it. "This book" is the book in the
chat's <reading-context>; --book takes its id as other commands do.
Memory types: reader (who they are: level, teacher, madhab), preference (how to
answer: language, transliteration, length), feedback (a correction, with Why: and
How to apply: lines), book (goals and context for one book; needs --book). One fact
per memory; the description is one line, written so a later search finds it.
Example:
  midad memory add --type preference --name transliterate-terms --description "Transliterate Arabic terms, in brackets after the Arabic" --body "Write الاسم (ism), not ism or الاسم alone."
`;

export const USAGE = `Usage: midad <command> [options]

Reading
  midad books                                   List the books in the library
  midad page <book> <page> [--words]            Print a page: numbered matn lines, then ḥāshiya (ḥ1, ḥ2…)
  midad lines <book> <page> --line <n[-m]>      Print some matn lines, words numbered (add --hashiya for footnotes)
  midad lines <book> <page> --line <n> --words <a[-b]>   Print just those words, to check a citation
  midad annotations <book> <page>               List highlights, notes and harakat with their ids

Writing (labelled as written by the agent)
  midad highlight add <book> <page> <span> [--color yellow|green|pink|blue]
  midad highlight remove <id>
  midad note add <book> <page> <span> --body <text>
  midad note add <book> <page> --line <n> --body <text>     A note on the whole line
  midad note add <book> <page> --page --body <text>         The page's note (one per page)
  midad note update <id> --body <text>
  midad note delete <id>
  midad harakat set <book> <page> --line <n> --word <n> --letter <n> --marks <names>
  midad harakat remove <book> <page> --line <n> --word <n> --letter <n>
  midad harakat clear <book> <page> <span>      Remove every added mark inside the span

${MEMORY_USAGE}
Library management (not for agents)
  midad book remove <book> [--yes]              Remove the book, its pages and everything about it,
                                                on every synced device. Without --yes, only lists
                                                what would go. Can't be undone; the corpus keeps it.

<book> is a book id, the start of one, or part of its title. <page> is the page's
position in the book (1 = first page), as shown in the reader's pager.
<span> is --line <n> --words <a[-b]>, or --from <line:word> --to <line:word>.
Add --hashiya to address the ḥāshiya: its footnotes are lines 1, 2… in order.
--words on page numbers each word, the numbers spans use. Letters count every
character that isn't a mark, so a leading [ or ( is letter 1; only Arabic
letters take harakat. Mark names: ${Object.keys(MARK).join(", ")}; join two with +.
Add --json to any command for JSON output.
`;

class UsageError extends Error {}

const OPTIONS = {
  json: { type: "boolean" },
  words: { type: "string" },
  line: { type: "string" },
  from: { type: "string" },
  to: { type: "string" },
  hashiya: { type: "boolean" },
  page: { type: "boolean" },
  color: { type: "string" },
  body: { type: "string" },
  word: { type: "string" },
  letter: { type: "string" },
  marks: { type: "string" },
  book: { type: "string" },
  all: { type: "boolean" },
  global: { type: "boolean" },
  type: { type: "string" },
  name: { type: "string" },
  description: { type: "string" },
  limit: { type: "string" },
  yes: { type: "boolean" },
  help: { type: "boolean", short: "h" },
} as const;

type Options = ReturnType<typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: true }>>["values"];

const int = (value: string | undefined, flag: string): number => {
  const n = Number(value);
  if (!value || !Number.isInteger(n)) throw new Error(`${flag} needs a whole number${value ? `, not "${value}"` : ""}.`);
  return n;
};

const range = (value: string, flag: string): [number, number] => {
  const [a, b = a] = value.split("-");
  return [int(a, flag), int(b, flag)];
};

const ref = (value: string | undefined, flag: string) => {
  const [line, word] = (value ?? "").split(":");
  return { line: int(line, `${flag} line`), word: int(word, `${flag} word`) };
};

const spanFrom = (opts: Options): Span => {
  const part: Part = opts.hashiya ? "hashiya" : "matn";
  if (opts.from || opts.to) return { part, start: ref(opts.from, "--from"), end: ref(opts.to ?? opts.from, "--to") };
  if (!opts.line || opts.words === undefined) throw new Error("Name the words with --line <n> --words <a[-b]>, or --from <line:word> --to <line:word>.");
  const line = int(opts.line, "--line");
  const [from, to] = range(opts.words, "--words");
  return { part, start: { line, word: from }, end: { line, word: to } };
};

const marksFrom = (names: string | undefined): string => {
  if (!names) throw new Error("Give the harakat with --marks, e.g. --marks fatha or --marks shadda+kasra.");
  return names
    .split("+")
    .map((name) => {
      const mark = MARK[name.trim() as MarkName];
      if (!mark) throw new Error(`"${name}" isn't a haraka name. Use: ${Object.keys(MARK).join(", ")}.`);
      return mark;
    })
    .join("");
};

const color = (value: string | undefined): HighlightColor => {
  const c = (value ?? "yellow") as HighlightColor;
  if (!HIGHLIGHT_COLORS.includes(c)) throw new Error(`--color is one of ${HIGHLIGHT_COLORS.join(", ")}.`);
  return c;
};

const memoryType = (value: string | undefined): MemoryType => {
  if (!isMemoryType(value)) throw new Error(`--type is one of ${MEMORY_TYPES.join(", ")}.`);
  return value;
};

const writtenBy = (m: Memory) => `${m.author === "reader" ? "the reader" : "Ask AI"}${m.editedAt === null ? "" : ", edited"}`;

const memoryLine = (m: Memory) =>
  `${m.id}  ${m.type}  ${m.name}  ${m.description}  [${m.bookId ? `book: ${m.bookTitle ?? m.bookId}` : "global"}]${m.author === "reader" || m.editedAt !== null ? ` (${writtenBy(m)})` : ""}`;

const formatMemories = ({ found, empty }: { found: Memory[]; empty: string }) => (found.length === 0 ? `${empty}\n` : `${found.map(memoryLine).join("\n")}\n`);

const formatMemory = (m: Memory) =>
  [
    `id: ${m.id}`,
    `name: ${m.name}`,
    `type: ${m.type}`,
    `scope: ${m.bookId ? `book ${m.bookId} (${m.bookTitle ?? "?"})` : "global"}`,
    `written by: ${writtenBy(m)}, updated ${new Date(m.updatedAt).toISOString().slice(0, 10)}`,
    `description: ${m.description}`,
    "",
    m.body,
    "",
  ].join("\n");

const numberWords = (text: string) => wordsOf(text).map((w, i) => `${i + 1}:${w}`).join(" ");

/** Each interlinear gloss on a line, under it: its words, then the gloss. Word numbers stay those of the line. */
const glossLines = ({ stored, part, line, text }: { stored: StoredPage; part: Part; line: number; text: string }): string[] =>
  stored.page.glosses
    .filter((g) => g.part === part && g.line === line)
    .map((g) => {
      const base = wordsOf(text).slice(g.from - 1, g.to).join(" ");
      const where = g.from === g.to ? `word ${g.from}` : `words ${g.from}-${g.to}`;
      return `\tgloss on ${where}: ${base} (gloss: ${g.text.replace(/\n/g, " / ")})`;
    });

const formatPage = ({ stored, words, lines, hashiya }: { stored: StoredPage; words: boolean; lines?: [number, number]; hashiya?: boolean }) => {
  const show = (text: string) => (words ? numberWords(text) : text);
  const inRange = (n: number) => !lines || (n >= lines[0] && n <= lines[1]);
  const out: string[] = [];
  if (!lines) out.push(`Page ${stored.position}${stored.number === null ? "" : ` (printed ${stored.number})`}${stored.page.header ? ` · ${stored.page.header}` : ""}`, "");
  if (!hashiya) {
    for (const b of stored.page.matn) {
      if (!inRange(b.line)) continue;
      out.push(`${b.line}\t${b.kind === "heading" ? "# " : ""}${show(b.text)}`, ...glossLines({ stored, part: "matn", line: b.line, text: b.text }));
    }
  }
  if (!lines || hashiya) {
    if (!lines && stored.page.hashiya.length > 0) out.push("", "الحاشية");
    stored.page.hashiya.forEach((f, i) => {
      if (!inRange(i + 1)) return;
      out.push(`ḥ${i + 1}\t${f.marker ? `(${f.marker}) ` : ""}${show(f.text)}`, ...glossLines({ stored, part: "hashiya", line: i + 1, text: f.text }));
    });
  }
  return `${out.join("\n")}\n`;
};

const formatAnnotations = (a: PageAnnotations) => {
  const where = (s: Span) => `${s.part === "hashiya" ? "ḥ" : ""}${s.start.line}:${s.start.word}–${s.end.line}:${s.end.word}`;
  const by = (author: string) => (author === "agent" ? " [agent]" : "");
  const out = [
    ...a.highlights.map((h) => `highlight ${h.id} ${h.color} ${where(h.span)}${by(h.author)}${h.stale ? " (text changed)" : ""}\t${h.quote}`),
    ...(a.pageNote ? [`note ${a.pageNote.id} page${by(a.pageNote.author)}\t\t${a.pageNote.body}`] : []),
    ...a.notes.map((n) => `note ${n.id} ${n.kind === "line" ? `line ${n.span.part === "hashiya" ? "ḥ" : ""}${n.span.start.line}` : where(n.span)}${by(n.author)}${n.stale ? " (text changed)" : ""}\t${n.quote}\t${n.body}`),
    ...a.harakat.map((h) => `harakat ${h.part === "hashiya" ? "ḥ" : ""}${h.line}:${h.word} letter ${h.letter}${by(h.author)}\t${h.base}${h.marks}`),
  ];
  return out.length === 0 ? "No annotations on this page.\n" : `${out.join("\n")}\n`;
};

export const runCli = async ({
  argv,
  db,
  stdout,
  stderr,
  currentBook,
  scansDir,
}: {
  argv: string[];
  db: DatabaseSync;
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  /** The book Ask AI is open on (MIDAD_BOOK), which memory commands are scoped to unless --book names another. */
  currentBook?: string;
  /** Where the app caches page scans, cleared for a removed book. */
  scansDir?: string;
}): Promise<number> => {
  const library = createLibrary({
    db,
    corpus: {
      getBook: () => Promise.reject(new Error("The CLI doesn't talk to the corpus.")),
      exportBook: () => Promise.reject(new Error("The CLI doesn't talk to the corpus.")),
    },
  });
  const annotations = createAnnotations({ db });

  const memories = createMemories({ db });
  const removal = createBookRemoval({ db, ...(scansDir ? { scansDir } : {}) });

  const finder = createPageFinder({ library });

  const findPage = async ({ book, position }: { book: string | undefined; position: string | undefined }) => {
    if (!book) throw new UsageError("Name a book.");
    return finder.findPage({ book, position: int(position, "<page>") });
  };

  let parsed: { values: Options; positionals: string[] };
  try {
    // `page --words` takes no value, while a span's --words does.
    const args = argv.map((arg, i) => (arg === "--words" && (argv[i + 1] === undefined || argv[i + 1]?.startsWith("--")) ? "--words=" : arg));
    parsed = parseArgs({ args, options: OPTIONS, allowPositionals: true });
  } catch (err) {
    stderr(`${(err as Error).message}\n\n${USAGE}`);
    return 2;
  }
  const { values: opts, positionals } = parsed;
  const [command, ...rest] = positionals;
  const print = ({ json, text }: { json: unknown; text: string }) => stdout(opts.json ? `${JSON.stringify(json, null, 2)}\n` : text);
  const done = (what: string, json: unknown = { ok: true }) => print({ json, text: `${what}\n` });

  try {
    if (!command || opts.help) {
      stdout(command === "memory" ? MEMORY_USAGE : USAGE);
      return command || opts.help ? 0 : 2;
    }
    const [a, b, c] = rest;
    const letterRef = (): LetterRef => ({
      part: opts.hashiya ? "hashiya" : "matn",
      line: int(opts.line, "--line"),
      word: int(opts.word, "--word"),
      letter: int(opts.letter, "--letter"),
    });

    const bookNamed = async (query: string) => (await finder.findBook(query)).bookId;
    /** What list and search look at: --global or --book narrow it; otherwise the chat's book and the global memories, or everything outside a chat. */
    const memoryFilter = async () => {
      if (opts.global && opts.book) throw new UsageError("Pass --global or --book, not both.");
      if (opts.all) return undefined;
      if (opts.global) return { global: true };
      if (opts.book) return { bookId: await bookNamed(opts.book) };
      return currentBook ? { global: true, bookId: await bookNamed(currentBook) } : undefined;
    };

    switch (`${command} ${["highlight", "note", "harakat", "memory", "book"].includes(command) ? (a ?? "") : ""}`.trim()) {
      case "books": {
        const books = await library.listBooks();
        print({
          json: books,
          text: books.length === 0 ? "The library is empty.\n" : `${books.map((bk) => `${bk.bookId}\t${bk.title}${bk.edition ? ` · ${bk.edition}` : ""}\t${bk.pageCount} pages`).join("\n")}\n`,
        });
        return 0;
      }
      case "page": {
        const stored = await findPage({ book: a, position: b });
        print({ json: { position: stored.position, number: stored.number, ...stored.page }, text: formatPage({ stored, words: opts.words !== undefined }) });
        return 0;
      }
      case "lines": {
        const stored = await findPage({ book: a, position: b });
        if (!opts.line) throw new Error("Say which lines with --line <n> or --line <n-m>.");
        const lines = range(opts.line, "--line");
        if (opts.words) {
          // `--line 4 --words 9-10` prints exactly the words a citation covers, to check it before citing.
          if (lines[0] !== lines[1]) throw new Error("Check a span on one line: --line <n> --words <a[-b]>.");
          const [from, to] = range(opts.words, "--words");
          const text = opts.hashiya ? stored.page.hashiya[lines[0] - 1]?.text : stored.page.matn.find((l) => l.line === lines[0])?.text;
          if (text === undefined) throw new Error(`This page has no ${opts.hashiya ? "ḥāshiya " : ""}line ${lines[0]}.`);
          const all = wordsOf(text);
          if (to > all.length) throw new Error(`${opts.hashiya ? "Ḥāshiya l" : "L"}ine ${lines[0]} has ${all.length} words.`);
          const covered = all.slice(from - 1, to);
          print({ json: { line: lines[0], from, to, words: covered }, text: `${opts.hashiya ? "ḥ" : ""}${lines[0]}:${from}${to === from ? "" : `-${to}`}\t${covered.map((w, i) => `${from + i}:${w}`).join(" ")}\n` });
          return 0;
        }
        print({
          json: opts.hashiya
            ? stored.page.hashiya.map((f, i) => ({ line: i + 1, ...f })).filter((f) => f.line >= lines[0] && f.line <= lines[1])
            : stored.page.matn.filter((l) => l.line >= lines[0] && l.line <= lines[1]),
          text: formatPage({ stored, words: true, lines, hashiya: opts.hashiya }),
        });
        return 0;
      }
      case "annotations": {
        const stored = await findPage({ book: a, position: b });
        const found = await annotations.listForPage({ bookId: stored.bookId, position: stored.position });
        print({ json: found, text: formatAnnotations(found) });
        return 0;
      }
      case "highlight add": {
        const stored = await findPage({ book: b, position: c });
        const h = await annotations.addHighlight({ bookId: stored.bookId, position: stored.position, span: spanFrom(opts), color: color(opts.color), author: "agent" });
        done(`Highlighted "${h.quote}" (${h.id}).`, h);
        return 0;
      }
      case "highlight remove":
        await annotations.removeHighlight({ id: b ?? "" });
        done("Removed the highlight.");
        return 0;
      case "note add": {
        const stored = await findPage({ book: b, position: c });
        const target: NoteTarget = opts.page
          ? { page: true }
          : opts.line && opts.words === undefined && !opts.from
            ? { line: { part: opts.hashiya ? "hashiya" : "matn", line: int(opts.line, "--line") } }
            : { span: spanFrom(opts) };
        const n = await annotations.addNote({ bookId: stored.bookId, position: stored.position, ...target, body: opts.body ?? "", author: "agent" });
        done("quote" in n ? `Added a note on "${n.quote}" (${n.id}).` : `Added a page note (${n.id}).`, n);
        return 0;
      }
      case "note update":
        await annotations.updateNote({ id: b ?? "", body: opts.body ?? "" });
        done("Updated the note.");
        return 0;
      case "note delete":
        await annotations.deleteNote({ id: b ?? "" });
        done("Deleted the note.");
        return 0;
      case "harakat set": {
        const stored = await findPage({ book: b, position: c });
        await annotations.setHarakat({ bookId: stored.bookId, position: stored.position, ...letterRef(), marks: marksFrom(opts.marks), author: "agent" });
        done("Set the harakat.");
        return 0;
      }
      case "harakat remove": {
        const stored = await findPage({ book: b, position: c });
        await annotations.removeHarakat({ bookId: stored.bookId, position: stored.position, ...letterRef() });
        done("Removed the harakat.");
        return 0;
      }
      case "harakat clear": {
        const stored = await findPage({ book: b, position: c });
        const removed = await annotations.clearHarakat({ bookId: stored.bookId, position: stored.position, span: spanFrom(opts) });
        done(removed.length === 0 ? "There were no added harakat in that span." : `Removed harakat from ${removed.length} letter${removed.length === 1 ? "" : "s"}.`, { removed });
        return 0;
      }
      case "memory list": {
        const filter = await memoryFilter();
        const found = await memories.list({ ...(filter ? { filter } : {}), ...(opts.type ? { type: memoryType(opts.type) } : {}) });
        print({ json: found, text: formatMemories({ found, empty: "No memories saved yet." }) });
        return 0;
      }
      case "memory search": {
        const query = rest.slice(1).join(" ");
        if (!query.trim()) throw new UsageError("Say what to search for: midad memory search <words>.");
        const filter = await memoryFilter();
        const found = await memories.search({ query, ...(filter ? { filter } : {}), ...(opts.limit ? { limit: int(opts.limit, "--limit") } : {}) });
        print({ json: found, text: formatMemories({ found, empty: "No memories match." }) });
        return 0;
      }
      case "memory get": {
        const found = await memories.get({ id: b ?? "" });
        if (!found) throw new Error(`There is no memory ${b ?? ""}. Run \`midad memory list\` to see them.`);
        print({ json: found, text: formatMemory(found) });
        return 0;
      }
      case "memory add": {
        const missing = (["type", "name", "description", "body"] as const).filter((flag) => !opts[flag]?.trim());
        if (missing.length || rest.length > 1) {
          throw new Error(
            `${missing.length ? `Missing ${missing.map((f) => `--${f}`).join(", ")}. ` : "Pass every value with its flag. "}Use: midad memory add --type <${MEMORY_TYPES.join("|")}> --name <slug> --description <one line> --body <text>`,
          );
        }
        const m = await memories.add({
          type: memoryType(opts.type),
          name: opts.name ?? "",
          description: opts.description ?? "",
          body: opts.body ?? "",
          bookId: opts.book ? await bookNamed(opts.book) : null,
          author: "agent",
        });
        done(`Saved memory ${m.id} (${m.name}, ${m.bookId ? `for ${m.bookTitle ?? m.bookId}` : "global"}).`, m);
        return 0;
      }
      case "memory update": {
        if (opts.global && opts.book) throw new UsageError("Pass --global or --book, not both.");
        const m = await memories.update({
          id: b ?? "",
          ...(opts.type ? { type: memoryType(opts.type) } : {}),
          ...(opts.book ? { bookId: await bookNamed(opts.book) } : opts.global ? { bookId: null } : {}),
          ...(opts.name !== undefined ? { name: opts.name } : {}),
          ...(opts.description !== undefined ? { description: opts.description } : {}),
          ...(opts.body !== undefined ? { body: opts.body } : {}),
        });
        done(`Updated memory ${m.id} (${m.name}).`, m);
        return 0;
      }
      case "book remove": {
        if (currentBook) throw new Error("Ask AI can't remove books. The reader removes them from the Library.");
        if (!b) throw new UsageError("Name the book to remove: midad book remove <book> --yes.");
        const book = await finder.findBook(b);
        const name = `${book.title} (${book.bookId})`;
        const what = (summary: BookRemoval) => removalCounts(summary) || "no pages";
        if (!opts.yes) {
          const summary = await removal.preview({ bookId: book.bookId });
          if (!summary) throw new Error(`Book ${book.bookId} is not in the library.`);
          print({
            json: { removed: false, ...summary },
            text: `Would remove ${name}: ${what(summary)}.\nRun again with --yes to remove it here and on your other synced devices. Can't be undone; the corpus copy stays.\n`,
          });
          return 1;
        }
        const removed = await removal.remove({ bookId: book.bookId });
        done(`Removed ${name}: ${what(removed)}.`, { removed: true, ...removed });
        return 0;
      }
      case "memory delete":
        await memories.remove({ id: b ?? "" });
        done("Deleted the memory.");
        return 0;
      default:
        throw new UsageError(`Unknown command "${[command, a].filter(Boolean).join(" ")}".`);
    }
  } catch (err) {
    if (err instanceof UsageError) {
      stderr(`${err.message}\n\n${USAGE}`);
      return 2;
    }
    stderr(`${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
};
