import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { createInterface } from "node:readline";
import { type AskModel, claudeArgs, cleanTitle, type StreamEvent, streamEvent, SYSTEM_PROMPT, titleArgs } from "../shared/ask";

/**
 * Runs Ask AI questions through the local Claude Code CLI. Claude runs in its
 * own empty folder with a `midad` command on its PATH that opens this library.
 * When the corpus is set up, it also gets the corpus MCP server, which reads the
 * credentials from the environment Claude passes on to it.
 */
export const createAsk = ({
  cliPath,
  corpusServerPath,
  corpusCredentials,
  dbPath,
  scansDir,
  workDir,
  onEvent,
}: {
  cliPath: string;
  corpusServerPath: string;
  corpusCredentials: () => { endpoint: string; key: string } | null;
  dbPath: string;
  /** Midad's scan cache, so the corpus tools show scans already downloaded without fetching them again. */
  scansDir: string;
  workDir: string;
  onEvent: (requestId: string, event: StreamEvent) => void;
}) => {
  const binDir = join(workDir, "bin");
  mkdirSync(binDir, { recursive: true });
  if (process.platform === "win32") {
    // Windows can't run a script by its shebang, and symlinks need admin rights there.
    writeFileSync(join(binDir, "midad.cmd"), `@node --no-warnings "${cliPath}" %*\r\n`);
  } else {
    const link = join(binDir, "midad");
    rmSync(link, { force: true });
    symlinkSync(cliPath, link);
  }

  const running = new Map<string, ChildProcess>();
  // Claude Code exits with code 143 when stopped, rather than by the signal, so a stop is remembered here.
  const stopped = new Set<string>();

  return {
    ask({ requestId, prompt, sessionId, model }: { requestId: string; prompt: string; sessionId: string | null; model: AskModel }): Promise<{ sessionId: string; text: string }> {
      if (!existsSync(cliPath)) {
        return Promise.reject(new Error(`The midad CLI isn't built yet (${cliPath}). Run \`pnpm build:cli\`.`));
      }
      const credentials = existsSync(corpusServerPath) ? corpusCredentials() : null;
      return new Promise((resolve, reject) => {
        const child = spawn("claude", claudeArgs({ prompt, systemPrompt: SYSTEM_PROMPT, sessionId, model, corpusServer: credentials ? corpusServerPath : null }), {
          cwd: workDir,
          env: {
            ...process.env,
            PATH: [binDir, join(homedir(), ".local", "bin"), process.env.PATH].filter(Boolean).join(delimiter),
            MIDAD_DB: dbPath,
            ...(credentials ? { MIDAD_CORPUS_URL: credentials.endpoint, MIDAD_CORPUS_KEY: credentials.key, MIDAD_SCANS: scansDir } : {}),
          },
          stdio: ["ignore", "pipe", "pipe"],
        });
        running.set(requestId, child);
        let stderr = "";
        let settled = false;
        const finish = (fn: () => void) => {
          if (settled) return;
          settled = true;
          running.delete(requestId);
          fn();
          stopped.delete(requestId);
        };

        child.stderr.on("data", (chunk: Buffer) => {
          stderr += chunk.toString();
        });
        createInterface({ input: child.stdout }).on("line", (line) => {
          const event = streamEvent(line);
          if (!event) return;
          onEvent(requestId, event);
          if (event.kind === "done") finish(() => resolve({ sessionId: event.sessionId, text: event.text }));
          if (event.kind === "error") finish(() => reject(new Error(event.message)));
        });
        child.on("error", (err: NodeJS.ErrnoException) =>
          finish(() =>
            reject(new Error(err.code === "ENOENT" ? "Couldn't start Claude Code. Is the `claude` command installed and on your PATH?" : err.message)),
          ),
        );
        child.on("close", (code, signal) =>
          finish(() =>
            reject(new Error(signal || stopped.delete(requestId) ? "Stopped." : `Claude Code exited (${code ?? "?"})${stderr.trim() ? `: ${stderr.trim().split("\n").slice(-3).join(" ")}` : "."}`)),
          ),
        );
      });
    },

    /** A short name for a conversation, from the quick model. */
    nameConversation({ prompt }: { prompt: string }): Promise<string> {
      return new Promise((resolve, reject) => {
        const child = spawn("claude", titleArgs(prompt), {
          cwd: workDir,
          env: { ...process.env, PATH: [binDir, join(homedir(), ".local", "bin"), process.env.PATH].filter(Boolean).join(delimiter) },
          stdio: ["ignore", "pipe", "pipe"],
        });
        let out = "";
        let stderr = "";
        child.stdout.on("data", (chunk: Buffer) => {
          out += chunk.toString();
        });
        child.stderr.on("data", (chunk: Buffer) => {
          stderr += chunk.toString();
        });
        child.on("error", (err: NodeJS.ErrnoException) =>
          reject(new Error(err.code === "ENOENT" ? "Couldn't start Claude Code. Is the `claude` command installed and on your PATH?" : err.message)),
        );
        child.on("close", (code) => {
          try {
            const result = JSON.parse(out) as { result?: string; is_error?: boolean };
            const title = cleanTitle(result.result ?? "");
            if (result.is_error || !title) throw new Error(result.result || "Claude didn't suggest a name.");
            resolve(title);
          } catch (err) {
            reject(err instanceof SyntaxError ? new Error(`Claude Code exited (${code ?? "?"})${stderr.trim() ? `: ${stderr.trim().split("\n").at(-1)}` : "."}`) : err);
          }
        });
      });
    },

    cancel({ requestId }: { requestId: string }) {
      const child = running.get(requestId);
      if (!child) return;
      stopped.add(requestId);
      child.kill("SIGTERM");
    },
  };
};
