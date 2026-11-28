import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openUserStore } from "../main/user-store";
import { createClient } from "@libsql/client/http";
import { baharCandidates, createBahar, spawnRunner } from "./bahar";
import { runCli } from "./run";

/** Where the Midad app keeps its library (Electron's userData folder for an app named "midad"). */
const libraryPath = (): string => {
  if (process.env.MIDAD_DB) return process.env.MIDAD_DB;
  if (process.env.MIDAD_USER_DATA) return join(process.env.MIDAD_USER_DATA, "midad.db");
  const home = homedir();
  const base =
    process.platform === "darwin"
      ? join(home, "Library", "Application Support")
      : process.platform === "win32"
        ? (process.env.APPDATA ?? join(home, "AppData", "Roaming"))
        : (process.env.XDG_CONFIG_HOME ?? join(home, ".config"));
  return join(base, "midad", "midad.db");
};

const path = libraryPath();
if (!existsSync(path)) {
  process.stderr.write(`There is no Midad library at ${path}. Open Midad and import a book first, or set MIDAD_DB.\n`);
  process.exit(1);
}
const db = new DatabaseSync(path);
db.exec("PRAGMA busy_timeout = 5000;");
openUserStore({ db, clientId: "cli" });
const code = await runCli({
  argv: process.argv.slice(2),
  db,
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
  scansDir: join(dirname(path), "scans"),
  bahar: createBahar({
    run: spawnRunner({ env: process.env }),
    candidates: baharCandidates({ env: process.env, home: homedir() }),
    connect: ({ url, authToken }) => {
      const client = createClient({ url, authToken });
      return { execute: (query) => client.execute(query), close: () => client.close() };
    },
  }),
  ...(process.env.MIDAD_BOOK ? { currentBook: process.env.MIDAD_BOOK } : {}),
});
db.close();
process.exitCode = code;
