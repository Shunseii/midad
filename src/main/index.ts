import { existsSync, mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { app, BrowserWindow, ipcMain, nativeTheme, protocol, shell } from "electron";
import { isLostSession, readingContext, sessionRecap } from "../shared/ask";
import { ASK_EVENT, type MidadApi, LIBRARY_CHANGED, type Theme } from "../shared/ipc";
import { createAsk } from "./ask";
import { createScans } from "./scans";
import { createAnnotations } from "./annotations";
import { createBookmarks } from "./bookmarks";
import { createMarkers } from "./markers";
import { createConversations } from "./conversations";
import { type CorpusSource, createCorpusClient } from "./corpus";
import { createLibrary } from "./library";
import { createSettings } from "./settings";

app.setName("midad");
// A separate profile (settings + library) for development and testing.
if (process.env.MIDAD_USER_DATA) app.setPath("userData", process.env.MIDAD_USER_DATA);

const userData = app.getPath("userData");

/**
 * The app was called Hamish. Electron creates the new profile folder before this
 * runs, so carry over the app's own data (library, settings, scans) item by item.
 */
const moveLegacyData = () => {
  const legacyDir = join(app.getPath("appData"), "hamish");
  if (!existsSync(legacyDir) || existsSync(join(userData, "midad.db"))) return;
  mkdirSync(userData, { recursive: true });
  const moves: [string, string][] = [
    ["hamish.db", "midad.db"],
    ["hamish.db-wal", "midad.db-wal"],
    ["hamish.db-shm", "midad.db-shm"],
    ["settings.json", "settings.json"],
    ["scans", "scans"],
  ];
  for (const [from, to] of moves) {
    if (existsSync(join(legacyDir, from)) && !existsSync(join(userData, to))) renameSync(join(legacyDir, from), join(userData, to));
  }
};
if (!process.env.MIDAD_USER_DATA) moveLegacyData();
const settings = createSettings({ dir: userData });

const corpusClient = () => {
  const credentials = settings.credentials();
  if (!credentials) throw new Error("The corpus isn't set up yet. Add its API URL and key in Settings.");
  return createCorpusClient(credentials);
};

// Resolved per call so a settings change takes effect without a restart.
const corpus: CorpusSource = {
  getBook: (id) => corpusClient().getBook(id),
  exportBook: (id) => corpusClient().exportBook(id),
};

const dbPath = join(userData, "midad.db");
const db = new DatabaseSync(dbPath);
// The midad CLI (and Ask AI through it) writes to the same file.
db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
const library = createLibrary({ db, corpus });
const annotations = createAnnotations({ db });
const markers = createMarkers({ db });
const bookmarks = createBookmarks({ db });
const conversations = createConversations({ db });
const scans = createScans({ dir: join(userData, "scans"), fetchScan: (input) => corpusClient().fetchScan(input) });

/** Each running answer so far, so an error or stop still saves what Claude wrote. */
const streamed = new Map<string, string>();

// Page scans load as <img src="midad-scan://scan/<bookId>/<fileId>">.
protocol.registerSchemesAsPrivileged([{ scheme: "midad-scan", privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
const ask = createAsk({
  cliPath: join(app.getAppPath(), "out", "cli", "midad.mjs"),
  dbPath,
  workDir: join(userData, "ask"),
  onEvent: (requestId, event) => {
    if (event.kind === "delta") streamed.set(requestId, (streamed.get(requestId) ?? "") + event.text);
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send(ASK_EVENT, requestId, event);
  },
});

const handlers: MidadApi = {
  "settings.get": async () => settings.get(),
  "settings.save": async (input) => settings.save(input),
  "settings.test": async ({ endpoint, key }) => {
    const stored = settings.credentials();
    const resolvedKey = key?.trim() || stored?.key;
    if (!endpoint.trim() || !resolvedKey) return { ok: false, message: "Enter the API URL and key." };
    try {
      await createCorpusClient({ endpoint, key: resolvedKey }).ping();
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  },
  "corpus.listBooks": async () => corpusClient().listBooks(),
  "library.list": () => library.listBooks(),
  "library.get": (bookId) => library.getBook(bookId),
  "library.page": (input) => library.getPage(input),
  "library.import": (input) => library.importBook(input),
  "library.previewSync": (input) => library.previewSync(input),
  "library.sync": (input) => library.syncBook(input),
  "library.setProgress": (input) => library.setProgress(input),
  "library.firstLine": (input) => library.getFirstLine(input),
  "glosses.correct": (input) => library.correctGloss(input),
  "glosses.reset": (input) => library.resetGloss(input),
  "annotations.list": (input) => annotations.listForPage(input),
  "annotations.bookMarks": (input) => annotations.bookMarks(input),
  "highlights.add": (input) => annotations.addHighlight(input),
  "highlights.remove": (input) => annotations.removeHighlight(input),
  "notes.add": (input) => annotations.addNote(input),
  "notes.update": (input) => annotations.updateNote(input),
  "notes.delete": (input) => annotations.deleteNote(input),
  "harakat.set": (input) => annotations.setHarakat(input),
  "harakat.remove": (input) => annotations.removeHarakat(input),
  "harakat.clear": (input) => annotations.clearHarakat(input),
  "marker.get": (input) => markers.get(input),
  "marker.set": (input) => markers.set(input),
  "marker.clear": (input) => markers.clear(input),
  "bookmarks.list": (input) => bookmarks.list(input),
  "bookmarks.set": (input) => bookmarks.set(input),
  "bookmarks.remove": (input) => bookmarks.remove(input),
  "ai.ask": async ({ requestId, bookId, position, question, selection, quotes, sessionId }) => {
    const book = await library.getBook(bookId);
    const page = await library.getPage({ bookId, position });
    if (!book || !page) throw new Error("That page isn't in the library.");
    const context = readingContext({ bookId, title: book.title, position, number: page.number, selection, quotes });
    const prompt = `${context}\n\n${question}`;
    try {
      const result = await ask.ask({ requestId, prompt, sessionId }).then(
        (answer) => ({ ...answer, restarted: false }),
        async (err: unknown) => {
          // A session Claude no longer has (cleared or from another machine): carry on in a new one, told what was said so far.
          if (!sessionId || !(err instanceof Error) || !isLostSession(err.message)) throw err;
          streamed.delete(requestId);
          const recap = sessionRecap(await conversations.earlierTurns({ turnId: requestId }));
          const answer = await ask.ask({ requestId, prompt: recap ? `${recap}\n\n${prompt}` : prompt, sessionId: null });
          return { ...answer, restarted: true };
        },
      );
      await conversations.finishTurn({ id: requestId, answer: result.text, sessionId: result.sessionId });
      return result;
    } catch (err) {
      await conversations.finishTurn({ id: requestId, answer: streamed.get(requestId) ?? "", error: err instanceof Error ? err.message : String(err) });
      throw err;
    } finally {
      streamed.delete(requestId);
    }
  },
  "ai.cancel": async (input) => ask.cancel(input),
  "conversations.list": (input) => conversations.list(input),
  "conversations.latest": (input) => conversations.latest(input),
  "conversations.get": (input) => conversations.get(input),
  "conversations.addTurn": (input) => conversations.addTurn(input),
  "conversations.remove": (input) => conversations.remove(input),
  "conversations.save": (input) => conversations.save(input),
  "conversations.rename": (input) => conversations.rename(input),
  "app.setTheme": async ({ theme }) => {
    settings.saveTheme(theme);
    applyTheme(theme);
  },
};

// data_version changes only when another connection (the midad CLI) commits.
const dataVersion = () => (db.prepare("PRAGMA data_version").get() as { data_version: number }).data_version;
let seenVersion = dataVersion();
setInterval(() => {
  let version: number;
  try {
    version = dataVersion();
  } catch {
    return;
  }
  if (version === seenVersion) return;
  seenVersion = version;
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(LIBRARY_CHANGED);
}, 1000);

for (const [channel, handler] of Object.entries(handlers)) {
  ipcMain.handle(channel, (_event, arg) => (handler as (a: unknown) => unknown)(arg));
}

/** The page background from src/styles/tokens.css, so the window never flashes white before the page paints. */
const windowBackground = () => (nativeTheme.shouldUseDarkColors ? "#13120F" : "#F6F3EC");

const applyTheme = (theme: Theme) => {
  nativeTheme.themeSource = theme;
  for (const win of BrowserWindow.getAllWindows()) win.setBackgroundColor(windowBackground());
};

const createWindow = () => {
  nativeTheme.themeSource = settings.theme();
  const win = new BrowserWindow({
    show: false,
    backgroundColor: windowBackground(),
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    title: "Midad",
    icon: join(app.getAppPath(), "resources", "icon.png"),
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  win.once("ready-to-show", () => win.show());

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http")) void shell.openExternal(url);
    return { action: "deny" };
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void win.loadFile(join(import.meta.dirname, "../renderer/index.html"));
  }
};

void app.whenReady().then(() => {
  protocol.handle("midad-scan", async (request) => {
    const [bookId = "", fileId = ""] = new URL(request.url).pathname.split("/").filter(Boolean).map(decodeURIComponent);
    try {
      const scan = await scans.get({ bookId, fileId });
      return new Response(Buffer.from(scan.bytes), { headers: { "content-type": scan.contentType, "cache-control": "max-age=31536000" } });
    } catch (err) {
      return new Response(err instanceof Error ? err.message : String(err), { status: 502 });
    }
  });
  nativeTheme.on("updated", () => {
    for (const win of BrowserWindow.getAllWindows()) win.setBackgroundColor(windowBackground());
  });
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
