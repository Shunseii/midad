import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { runCli } from "./run";

/** Where the Hamish app keeps its library (Electron's userData folder for an app named "hamish"). */
const libraryPath = (): string => {
  if (process.env.HAMISH_DB) return process.env.HAMISH_DB;
  if (process.env.HAMISH_USER_DATA) return join(process.env.HAMISH_USER_DATA, "hamish.db");
  const home = homedir();
  const base =
    process.platform === "darwin"
      ? join(home, "Library", "Application Support")
      : process.platform === "win32"
        ? (process.env.APPDATA ?? join(home, "AppData", "Roaming"))
        : (process.env.XDG_CONFIG_HOME ?? join(home, ".config"));
  return join(base, "hamish", "hamish.db");
};

const path = libraryPath();
if (!existsSync(path)) {
  process.stderr.write(`There is no Hamish library at ${path}. Open Hamish and import a book first, or set HAMISH_DB.\n`);
  process.exit(1);
}
const db = new DatabaseSync(path);
db.exec("PRAGMA busy_timeout = 5000;");
const code = await runCli({
  argv: process.argv.slice(2),
  db,
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
});
db.close();
process.exitCode = code;
