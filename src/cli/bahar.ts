import { spawn } from "node:child_process";
import { join } from "node:path";
import { z } from "zod";
import { DEFAULT_LIMIT, MAX_LIMIT, type BaharEntry, searchArgs, searchSql, toEntry } from "./bahar-search";

/**
 * The reader's Bahar dictionary (their Arabic vocabulary and flashcard app), for Ask AI: a
 * read-only search, straight against their database with the credentials `bahar db-info` hands
 * out, and adding a word through `bahar add`. The access token stays inside this module: it is
 * never printed, and every error message is scrubbed of it.
 */

export const BAHAR_WORD_TYPES = ["ism", "fi'l", "harf", "expression"] as const;
export type BaharWordType = (typeof BAHAR_WORD_TYPES)[number];
export const isBaharWordType = (value: string | undefined): value is BaharWordType => BAHAR_WORD_TYPES.includes(value as BaharWordType);

export interface BaharExample {
  sentence: string;
  context?: string;
  translation?: string;
}

/** One item of the JSON array `bahar add` reads on stdin. */
export interface BaharWord {
  word: string;
  translation: string;
  type: BaharWordType;
  root?: string[];
  tags: string[];
  definition?: string;
  examples?: BaharExample[];
}

export interface BaharRun {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Runs one CLI command. Rejects with an error whose `code` is "ENOENT" when the command isn't there, or "ETIMEDOUT" when it hangs. */
export type BaharRunner = (input: { command: string; args: string[]; stdin?: string }) => Promise<BaharRun>;

export interface BaharDb {
  execute: (query: { sql: string; args: (string | number)[] }) => Promise<{ rows: Record<string, unknown>[] }>;
  close: () => void;
}

export type BaharConnector = (input: { url: string; authToken: string }) => BaharDb;

export class BaharError extends Error {}

const TIMEOUT_MS = 30_000;

/** Runs the command directly (never through a shell), with the input on stdin. */
export const spawnRunner =
  ({ env, timeoutMs = TIMEOUT_MS }: { env: NodeJS.ProcessEnv; timeoutMs?: number }): BaharRunner =>
  ({ command, args, stdin }) =>
    new Promise((resolve, reject) => {
      const child = spawn(command, args, { env: { ...env, NO_COLOR: "1" }, stdio: ["pipe", "pipe", "pipe"], shell: false });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(Object.assign(new Error("The bahar CLI didn't answer in time."), { code: "ETIMEDOUT" }));
      }, timeoutMs);
      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });
      child.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ code, stdout, stderr });
      });
      child.stdin.on("error", () => {});
      child.stdin.end(stdin ?? "");
    });

/** Where to look for the CLI: MIDAD_BAHAR_BIN alone when set, else PATH and the usual install folders. */
export const baharCandidates = ({ env, home }: { env: NodeJS.ProcessEnv; home: string }): string[] =>
  env.MIDAD_BAHAR_BIN ? [env.MIDAD_BAHAR_BIN] : ["bahar", join(home, ".local", "bin", "bahar"), join(home, ".bun", "bin", "bahar")];

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
const JWT = /eyJ[\w-]*\.[\w-]+\.[\w-]*/g;
const TOKEN_FIELD = /("?(?:access_?token|auth_?token|authorization)"?\s*[:=]\s*)("[^"]*"|\S+)/gi;
const BEARER = /(bearer\s+)\S+/gi;

/** Text with the token, and anything shaped like one, taken out. */
export const scrub = ({ text, secrets }: { text: string; secrets: string[] }): string => {
  let out = text;
  for (const secret of secrets) if (secret) out = out.split(secret).join("[redacted]");
  return out.replace(JWT, "[redacted]").replace(TOKEN_FIELD, "$1[redacted]").replace(BEARER, "$1[redacted]");
};

const NOT_INSTALLED = "The bahar CLI isn't installed on this computer, so the reader's Bahar dictionary can't be reached.";
const NOT_SIGNED_IN = "Not signed in to Bahar. The reader needs to run `bahar login` in a terminal themselves, then ask again.";
const NETWORK = "Couldn't reach Bahar: check the internet connection and try again.";

const NOT_SIGNED_IN_OUTPUT = /not logged in|bahar login|unauthori[sz]ed|session expired|\b40[13]\b|SERVER_ERROR.*\b40[13]\b/i;
const NETWORK_OUTPUT =
  /unable to connect|fetch failed|failed to fetch|econnrefused|econnreset|enotfound|eai_again|etimedout|timed out|network|socket|connectionrefused|\b(?:429|50[0234])\b/i;

const oneLine = (text: string) => text.replace(ANSI, "").replace(/\s+/g, " ").trim().slice(0, 300);

/** A clear one-line reason from what a failing step printed, scrubbed of credentials. */
export const classifyFailure = ({ output, action, secrets = [] }: { output: string; action: string; secrets?: string[] }): string => {
  const detail = oneLine(scrub({ text: output, secrets }));
  if (NOT_SIGNED_IN_OUTPUT.test(detail)) return NOT_SIGNED_IN;
  if (NETWORK_OUTPUT.test(detail)) return NETWORK;
  return detail ? `Bahar couldn't ${action}: ${detail}` : `Bahar couldn't ${action}.`;
};

const errorCode = (err: unknown) => (err instanceof Error && "code" in err ? err.code : undefined);
const messageOf = (err: unknown) => (err instanceof Error ? `${err.message} ${err.cause instanceof Error ? err.cause.message : ""}` : String(err));

/** The CLI's JSON answer. An update notice can come before it on stdout, so it starts at the first line that opens an object. */
const parseJson = <T>({ stdout, schema }: { stdout: string; schema: z.ZodType<T> }): T | null => {
  for (let at = stdout.search(/^\{/m); at >= 0; ) {
    try {
      const parsed = schema.safeParse(JSON.parse(stdout.slice(at)));
      return parsed.success ? parsed.data : null;
    } catch {
      const next = stdout.slice(at + 1).search(/^\{/m);
      at = next < 0 ? -1 : at + 1 + next;
    }
  }
  return null;
};

const DbInfoSchema = z.object({ hostname: z.string().min(1), access_token: z.string().min(1) });

const AddedSchema = z.object({
  added: z.number(),
  results: z.array(z.object({ id: z.string(), word: z.string() }).loose()),
});

export const parseAdded = (stdout: string) => parseJson({ stdout, schema: AddedSchema });

const REQUIRED_COLUMNS = ["id", "word", "translation"];

const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Object.assign(new Error("timed out"), { code: "ETIMEDOUT" })), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });

export const createBahar = ({ run, candidates, connect, timeoutMs = TIMEOUT_MS }: { run: BaharRunner; candidates: string[]; connect: BaharConnector; timeoutMs?: number }) => {
  /** Runs `bahar <args>` with the first candidate that exists. */
  const bahar = async ({ args, stdin }: { args: string[]; stdin?: string }): Promise<BaharRun> => {
    for (const command of candidates) {
      try {
        return await run({ command, args, ...(stdin === undefined ? {} : { stdin }) });
      } catch (err) {
        if (errorCode(err) === "ENOENT") continue;
        if (errorCode(err) === "ETIMEDOUT") throw new BaharError(NETWORK);
        throw new BaharError(classifyFailure({ output: messageOf(err), action: `run ${args[0] ?? ""}` }));
      }
    }
    throw new BaharError(NOT_INSTALLED);
  };

  const search = async ({ query, limit = DEFAULT_LIMIT }: { query: string; limit?: number }): Promise<BaharEntry[]> => {
    const args = searchArgs({ query, limit: Math.min(Math.max(1, limit), MAX_LIMIT) });
    if (!args) throw new BaharError("Say what to search for: midad bahar search <word or meaning>.");
    const info = await bahar({ args: ["db-info"] });
    const creds = parseJson({ stdout: info.stdout, schema: DbInfoSchema });
    const secrets = creds ? [creds.access_token] : [];
    if (info.code !== 0) throw new BaharError(classifyFailure({ output: `${info.stderr}\n${info.stdout}`, action: "share its connection details", secrets }));
    if (!creds) throw new BaharError("Bahar's connection details couldn't be read. Updating the bahar CLI (bahar update) may help.");
    let db: BaharDb | null = null;
    try {
      db = connect({ url: `libsql://${creds.hostname}`, authToken: creds.access_token });
      const client = db;
      const columns = await withTimeout(client.execute({ sql: "SELECT name FROM pragma_table_info('dictionary_entries')", args: [] }), timeoutMs);
      const names = new Set(columns.rows.map((r) => String(r.name)));
      if (!REQUIRED_COLUMNS.every((c) => names.has(c))) throw new BaharError("The reader's Bahar dictionary isn't in a shape Midad can search (dictionary_entries is missing or changed).");
      const found = await withTimeout(client.execute({ sql: searchSql(names), args }), timeoutMs);
      return found.rows.map(toEntry);
    } catch (err) {
      if (err instanceof BaharError) throw new BaharError(scrub({ text: err.message, secrets }));
      if (errorCode(err) === "ETIMEDOUT") throw new BaharError(NETWORK);
      throw new BaharError(classifyFailure({ output: messageOf(err), action: "search the dictionary", secrets }));
    } finally {
      try {
        db?.close();
      } catch {
        // Nothing to do: the search has its answer or its error already.
      }
    }
  };

  const add = async (word: BaharWord): Promise<{ id: string; word: string }> => {
    const result = await bahar({ args: ["add"], stdin: JSON.stringify([word]) });
    if (result.code !== 0) throw new BaharError(classifyFailure({ output: `${result.stderr}\n${result.stdout}`, action: "add the word" }));
    const added = parseAdded(result.stdout)?.results[0];
    if (!added) throw new BaharError("Bahar didn't confirm the word was added. Search for it before adding it again.");
    return { id: added.id, word: added.word };
  };

  return { search, add };
};

export type Bahar = ReturnType<typeof createBahar>;
