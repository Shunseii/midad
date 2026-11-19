import type { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";
import { HIGHLIGHT_COLORS, type HighlightColor, type LetterRef, type PageAnnotations, type Part, type Span, wordsOf } from "../shared/annotations";
import { MARK, type MarkName } from "../shared/harakat";
import type { LibraryBook, StoredPage } from "../shared/library";
import { createAnnotations } from "../main/annotations";
import { createLibrary } from "../main/library";

export const USAGE = `Usage: hamish <command> [options]

Reading
  hamish books                                   List the books in the library
  hamish page <book> <page> [--words]            Print a page: numbered matn lines, then ḥāshiya (ḥ1, ḥ2…)
  hamish lines <book> <page> --line <n[-m]>      Print some matn lines (add --hashiya for footnotes)
  hamish annotations <book> <page>               List highlights, notes and harakat with their ids

Writing (labelled as written by the agent)
  hamish highlight add <book> <page> <span> [--color yellow|green|pink|blue]
  hamish highlight remove <id>
  hamish note add <book> <page> <span> --body <text>
  hamish note update <id> --body <text>
  hamish note delete <id>
  hamish harakat set <book> <page> --line <n> --word <n> --letter <n> --marks <names>
  hamish harakat remove <book> <page> --line <n> --word <n> --letter <n>
  hamish harakat clear <book> <page> <span>      Remove every added mark inside the span

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
  color: { type: "string" },
  body: { type: "string" },
  word: { type: "string" },
  letter: { type: "string" },
  marks: { type: "string" },
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

const numberWords = (text: string) => wordsOf(text).map((w, i) => `${i + 1}:${w}`).join(" ");

const formatPage = ({ stored, words, lines, hashiya }: { stored: StoredPage; words: boolean; lines?: [number, number]; hashiya?: boolean }) => {
  const show = (text: string) => (words ? numberWords(text) : text);
  const inRange = (n: number) => !lines || (n >= lines[0] && n <= lines[1]);
  const out: string[] = [];
  if (!lines) out.push(`Page ${stored.position}${stored.number === null ? "" : ` (printed ${stored.number})`}${stored.page.header ? ` · ${stored.page.header}` : ""}`, "");
  if (!hashiya) for (const b of stored.page.matn) if (inRange(b.line)) out.push(`${b.line}\t${b.kind === "heading" ? "# " : ""}${show(b.text)}`);
  if (!lines || hashiya) {
    if (!lines && stored.page.hashiya.length > 0) out.push("", "الحاشية");
    stored.page.hashiya.forEach((f, i) => {
      if (inRange(i + 1)) out.push(`ḥ${i + 1}\t${f.marker ? `(${f.marker}) ` : ""}${show(f.text)}`);
    });
  }
  return `${out.join("\n")}\n`;
};

const formatAnnotations = (a: PageAnnotations) => {
  const where = (s: Span) => `${s.part === "hashiya" ? "ḥ" : ""}${s.start.line}:${s.start.word}–${s.end.line}:${s.end.word}`;
  const by = (author: string) => (author === "agent" ? " [agent]" : "");
  const out = [
    ...a.highlights.map((h) => `highlight ${h.id} ${h.color} ${where(h.span)}${by(h.author)}${h.stale ? " (text changed)" : ""}\t${h.quote}`),
    ...a.notes.map((n) => `note ${n.id} ${where(n.span)}${by(n.author)}${n.stale ? " (text changed)" : ""}\t${n.quote}\t${n.body}`),
    ...a.harakat.map((h) => `harakat ${h.part === "hashiya" ? "ḥ" : ""}${h.line}:${h.word} letter ${h.letter}${by(h.author)}\t${h.base}${h.marks}`),
  ];
  return out.length === 0 ? "No annotations on this page.\n" : `${out.join("\n")}\n`;
};

export const runCli = async ({
  argv,
  db,
  stdout,
  stderr,
}: {
  argv: string[];
  db: DatabaseSync;
  stdout: (s: string) => void;
  stderr: (s: string) => void;
}): Promise<number> => {
  const library = createLibrary({
    db,
    corpus: {
      getBook: () => Promise.reject(new Error("The CLI doesn't talk to the corpus.")),
      exportBook: () => Promise.reject(new Error("The CLI doesn't talk to the corpus.")),
    },
  });
  const annotations = createAnnotations({ db });

  const findBook = async (query: string | undefined): Promise<LibraryBook> => {
    if (!query) throw new UsageError("Name a book.");
    const books = await library.listBooks();
    const exact = books.find((b) => b.bookId === query);
    if (exact) return exact;
    const matches = books.filter((b) => b.bookId.startsWith(query) || b.title.includes(query) || b.edition?.includes(query));
    if (matches.length === 1 && matches[0]) return matches[0];
    if (matches.length === 0) throw new Error(`No book matches "${query}". Run \`hamish books\` to see them.`);
    throw new Error(`"${query}" matches ${matches.length} books: ${matches.map((b) => `${b.title} (${b.bookId})`).join(", ")}.`);
  };

  const findPage = async ({ book, position }: { book: string | undefined; position: string | undefined }) => {
    const found = await findBook(book);
    const n = int(position, "<page>");
    const stored = await library.getPage({ bookId: found.bookId, position: n });
    if (!stored) throw new Error(`${found.title} has no page ${n}; it has ${found.pageCount}.`);
    return stored;
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
      stdout(USAGE);
      return command || opts.help ? 0 : 2;
    }
    const [a, b, c] = rest;
    const letterRef = (): LetterRef => ({
      part: opts.hashiya ? "hashiya" : "matn",
      line: int(opts.line, "--line"),
      word: int(opts.word, "--word"),
      letter: int(opts.letter, "--letter"),
    });

    switch (`${command} ${["highlight", "note", "harakat"].includes(command) ? (a ?? "") : ""}`.trim()) {
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
        print({
          json: opts.hashiya
            ? stored.page.hashiya.map((f, i) => ({ line: i + 1, ...f })).filter((f) => f.line >= lines[0] && f.line <= lines[1])
            : stored.page.matn.filter((l) => l.line >= lines[0] && l.line <= lines[1]),
          text: formatPage({ stored, words: false, lines, hashiya: opts.hashiya }),
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
        const n = await annotations.addNote({ bookId: stored.bookId, position: stored.position, span: spanFrom(opts), body: opts.body ?? "", author: "agent" });
        done(`Added a note on "${n.quote}" (${n.id}).`, n);
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
