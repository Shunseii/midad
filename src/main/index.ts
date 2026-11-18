import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { app, BrowserWindow, ipcMain, shell } from "electron";
import type { HamishApi } from "../shared/ipc";
import { createAnnotations } from "./annotations";
import { createMarkers } from "./markers";
import { type CorpusSource, createCorpusClient } from "./corpus";
import { createLibrary } from "./library";
import { createSettings } from "./settings";

app.setName("hamish");
// A separate profile (settings + library) for development and testing.
if (process.env.HAMISH_USER_DATA) app.setPath("userData", process.env.HAMISH_USER_DATA);

const userData = app.getPath("userData");
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

const db = new DatabaseSync(join(userData, "hamish.db"));
const library = createLibrary({ db, corpus });
const annotations = createAnnotations({ db });
const markers = createMarkers({ db });

const handlers: HamishApi = {
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
  "annotations.list": (input) => annotations.listForPage(input),
  "highlights.add": (input) => annotations.addHighlight(input),
  "highlights.remove": (input) => annotations.removeHighlight(input),
  "notes.add": (input) => annotations.addNote(input),
  "notes.update": (input) => annotations.updateNote(input),
  "notes.delete": (input) => annotations.deleteNote(input),
  "harakat.set": (input) => annotations.setHarakat(input),
  "harakat.remove": (input) => annotations.removeHarakat(input),
  "marker.get": (input) => markers.get(input),
  "marker.set": (input) => markers.set(input),
  "marker.clear": (input) => markers.clear(input),
};

for (const [channel, handler] of Object.entries(handlers)) {
  ipcMain.handle(channel, (_event, arg) => (handler as (a: unknown) => unknown)(arg));
}

const createWindow = () => {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    title: "Hamish",
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

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
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
