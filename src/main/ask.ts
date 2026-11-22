import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { createInterface } from "node:readline";
import { claudeArgs, type StreamEvent, streamEvent, SYSTEM_PROMPT } from "../shared/ask";

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
  workDir,
  onEvent,
}: {
  cliPath: string;
  corpusServerPath: string;
  corpusCredentials: () => { endpoint: string; key: string } | null;
  dbPath: string;
  workDir: string;
  onEvent: (requestId: string, event: StreamEvent) => void;
}) => {
  const binDir = join(workDir, "bin");
  mkdirSync(binDir, { recursive: true });
  const link = join(binDir, "midad");
  rmSync(link, { force: true });
  symlinkSync(cliPath, link);

  const running = new Map<string, ChildProcess>();

  return {
    ask({ requestId, prompt, sessionId }: { requestId: string; prompt: string; sessionId: string | null }): Promise<{ sessionId: string; text: string }> {
      if (!existsSync(cliPath)) {
        return Promise.reject(new Error(`The midad CLI isn't built yet (${cliPath}). Run \`pnpm build:cli\`.`));
      }
      const credentials = existsSync(corpusServerPath) ? corpusCredentials() : null;
      return new Promise((resolve, reject) => {
        const child = spawn("claude", claudeArgs({ prompt, systemPrompt: SYSTEM_PROMPT, sessionId, corpusServer: credentials ? corpusServerPath : null }), {
          cwd: workDir,
          env: {
            ...process.env,
            PATH: [binDir, join(homedir(), ".local", "bin"), process.env.PATH].filter(Boolean).join(delimiter),
            MIDAD_DB: dbPath,
            ...(credentials ? { MIDAD_CORPUS_URL: credentials.endpoint, MIDAD_CORPUS_KEY: credentials.key } : {}),
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
            reject(new Error(signal ? "Stopped." : `Claude Code exited (${code ?? "?"})${stderr.trim() ? `: ${stderr.trim().split("\n").slice(-3).join(" ")}` : "."}`)),
          ),
        );
      });
    },

    cancel({ requestId }: { requestId: string }) {
      running.get(requestId)?.kill("SIGTERM");
    },
  };
};
