import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cliShim } from "../shared/ask";

const electronPath = createRequire(import.meta.url)("electron") as string;

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "midad-shim-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("cliShim", () => {
  it("writes a Windows .cmd that runs the CLI on Midad's executable as Node", () => {
    const shim = cliShim({ platform: "win32", runtime: { execPath: "C:\\Program Files\\Midad\\Midad.exe" }, cliPath: "C:\\Program Files\\Midad\\out\\cli\\midad.mjs" });
    expect(shim.name).toBe("midad.cmd");
    expect(shim.content.split("\r\n")).toEqual([
      "@echo off",
      "setlocal",
      "set ELECTRON_RUN_AS_NODE=1",
      '"C:\\Program Files\\Midad\\Midad.exe" --no-warnings "C:\\Program Files\\Midad\\out\\cli\\midad.mjs" %*',
      "",
    ]);
  });

  it.runIf(process.platform !== "win32")("runs the CLI on Electron with node:sqlite, with no node on PATH and quotes in the path", () => {
    const appDir = join(dir, "it's an app");
    mkdirSync(appDir);
    const cliPath = join(appDir, "cli.mjs");
    writeFileSync(
      cliPath,
      `import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(":memory:");
console.log(JSON.stringify({ electron: process.versions.electron, sqlite: db.prepare("select 1 as one").get().one, args: process.argv.slice(2) }));`,
    );
    const shim = cliShim({ platform: process.platform, runtime: { execPath: electronPath }, cliPath });
    const shimPath = join(dir, shim.name);
    writeFileSync(shimPath, shim.content, { mode: 0o755 });

    const out = execFileSync(shimPath, ["books", "two words"], { env: { PATH: "/usr/bin:/bin", HOME: dir }, encoding: "utf8" });
    expect(JSON.parse(out)).toEqual({ electron: expect.stringMatching(/^\d+\./), sqlite: 1, args: ["books", "two words"] });
  });
});
