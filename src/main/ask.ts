import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { createInterface } from "node:readline";
import { claudeArgs, type StreamEvent, streamEvent, SYSTEM_PROMPT } from "../shared/ask";

/**
 * Runs Ask AI questions through the local Claude Code CLI. Claude runs in its
 * own empty folder with a `hamish` command on its PATH that opens this library.
 */
export const createAsk = ({
  cliPath,
  dbPath,
  workDir,
  onEvent,
}: {
  cliPath: string;
  dbPath: string;
  workDir: string;
  onEvent: (requestId: string, event: StreamEvent) => void;
}) => {
  const binDir = join(workDir, "bin");
  mkdirSync(binDir, { recursive: true });
  const link = join(binDir, "hamish");
  rmSync(link, { force: true });
  symlinkSync(cliPath, link);

  const running = new Map<string, ChildProcess>();

  return {
    ask({ requestId, prompt, sessionId }: { requestId: string; prompt: string; sessionId: string | null }): Promise<{ sessionId: string; text: string }> {
      if (!existsSync(cliPath)) {
        return Promise.reject(new Error(`The hamish CLI isn't built yet (${cliPath}). Run \`pnpm build:cli\`.`));
      }
      return new Promise((resolve, reject) => {
        const child = spawn("claude", claudeArgs({ prompt, systemPrompt: SYSTEM_PROMPT, sessionId }), {
          cwd: workDir,
          env: {
            ...process.env,
            PATH: [binDir, join(homedir(), ".local", "bin"), process.env.PATH].filter(Boolean).join(delimiter),
            HAMISH_DB: dbPath,
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
