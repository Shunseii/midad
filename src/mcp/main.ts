import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createCorpusClient } from "../main/corpus";
import { createPageFinder } from "../main/find-page";
import { createLibrary } from "../main/library";
import { createCorpusTools, ToolError } from "./corpus-tools";

/**
 * MCP stdio server with the corpus tools, started by Claude Code for Ask AI turns only.
 * The Midad app passes the library path and corpus credentials in the environment.
 */

const dbPath = process.env.MIDAD_DB;
const endpoint = process.env.MIDAD_CORPUS_URL;
const key = process.env.MIDAD_CORPUS_KEY;

const client = () => {
  if (!endpoint || !key) throw new ToolError("The corpus isn't set up in Midad's settings, so the text can't be changed from here.");
  return createCorpusClient({ endpoint, key });
};

if (!dbPath || !existsSync(dbPath)) {
  process.stderr.write(`There is no Midad library at ${dbPath ?? "(MIDAD_DB isn't set)"}.\n`);
  process.exit(1);
}
const db = new DatabaseSync(dbPath);
db.exec("PRAGMA busy_timeout = 5000;");
const library = createLibrary({
  db,
  corpus: { getBook: (id) => client().getBook(id), exportBook: (id) => client().exportBook(id) },
});

const tools = createCorpusTools({
  findPage: createPageFinder({ library }).findPage,
  bookTitle: async (bookId) => (await library.getBook(bookId))?.title ?? bookId,
  corpus: {
    getText: (input) => client().getText(input),
    editText: (input) => client().editText(input),
    textHistory: (input) => client().textHistory(input),
  },
  syncPage: async ({ bookId, fileId, edits }) => {
    await library.syncBook({ bookId, mode: "overwrite", fileIds: [fileId], ...(edits ? { edits: { [fileId]: edits } } : {}) });
  },
});

const run = async (work: () => Promise<string>) => {
  try {
    return { content: [{ type: "text" as const, text: await work() }] };
  } catch (err) {
    return { isError: true, content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }] };
  }
};

const pageArgs = {
  book: z.string().min(1).describe("Book id, the start of one, or part of its title, as for `midad page`."),
  page: z.number().int().min(1).describe("Page position in the book (1 = first page), as for `midad page`."),
};
const rev = z.union([z.string().min(1), z.number().int()]).transform(String);

const server = new McpServer({ name: "corpus", version: "1.0.0" });

server.registerTool(
  "corpus_text",
  {
    description:
      "The page's transcription as stored in the corpus (Markdown): the text corpus_edit matches against. Interlinear glosses are <ruby>words<rt>gloss</rt></ruby>. With rev, the text just before that change.",
    inputSchema: { ...pageArgs, rev: rev.optional().describe("A rev from corpus_history.") },
    annotations: { readOnlyHint: true },
  },
  (args) => run(() => tools.text(args)),
);

server.registerTool(
  "corpus_edit",
  {
    description:
      "Fix transcription errors on one page with exact find-and-replace edits, applied in order, all or nothing. Each old must occur exactly once in corpus_text's text. The reader sees the change at once, and it can be undone with corpus_restore.",
    inputSchema: {
      ...pageArgs,
      edits: z.array(z.object({ old: z.string().describe("Exact text to replace, with enough around it to be unique."), new: z.string() })).min(1),
      note: z.string().describe("Why, in a few words, e.g. \"gloss belongs on الماء\"."),
    },
    annotations: { destructiveHint: false },
  },
  (args) => run(() => tools.edit(args)),
);

server.registerTool(
  "corpus_history",
  {
    description: "Every change to the page's transcription (hand edits and re-OCRs), newest first, with the rev that names the text before each.",
    inputSchema: pageArgs,
    annotations: { readOnlyHint: true },
  },
  (args) => run(() => tools.history(args)),
);

server.registerTool(
  "corpus_restore",
  {
    description: "Put the page's transcription back to how it was just before the change rev (from corpus_history). The restore is itself recorded, so it can be undone too.",
    inputSchema: { ...pageArgs, rev },
  },
  (args) => run(() => tools.restore(args)),
);

await server.connect(new StdioServerTransport());
