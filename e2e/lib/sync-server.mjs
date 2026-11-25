import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:net";
import { join } from "node:path";
import { ROOT } from "./app.mjs";

const WRANGLER = join(ROOT, "sync-server/node_modules/.bin/wrangler");

export const sha256 = (s) => createHash("sha256").update(s).digest("hex");

export const freePort = () =>
  new Promise((done, fail) => {
    const server = createServer();
    server.once("error", fail);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => done(port));
    });
  });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const until = async (check, message, timeout) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (check()) return;
    await sleep(200);
  }
  throw new Error(`${message} (waited ${timeout / 1000}s)`);
};

/**
 * The sync server under `wrangler dev` (local only, nothing is deployed), accepting `tokens`
 * (token → user id). In its own process group, so stopping it kills exactly what was started here.
 */
export const startSyncServer = async ({ port, persistTo, tokens }) => {
  const users = JSON.stringify(Object.fromEntries(Object.entries(tokens).map(([token, user]) => [sha256(token), user])));
  const child = spawn(WRANGLER, ["dev", "--ip", "127.0.0.1", "--port", String(port), "--persist-to", persistTo, "--var", `SYNC_TOKENS:${users}`], {
    cwd: join(ROOT, "sync-server"),
    env: { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "1" },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  const collect = (d) => {
    log = (log + d).slice(-8000);
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);
  const kill = () => {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {}
  };
  process.once("exit", kill);
  await until(() => log.includes("Ready on") || child.exitCode !== null, "wrangler dev didn't start", 90_000);
  if (child.exitCode !== null) throw new Error(`wrangler dev exited:\n${log}`);
  return {
    stop: async () => {
      kill();
      process.off("exit", kill);
      await until(() => child.exitCode !== null || child.signalCode !== null, "wrangler dev didn't stop", 20_000);
    },
  };
};
