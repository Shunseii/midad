import { contextBridge, ipcRenderer } from "electron";
import type { StreamEvent } from "../shared/ask";
import { ASK_EVENT, CHANNELS, IMPORT_PROGRESS, type MidadApi, type MidadEvents, LIBRARY_CHANGED } from "../shared/ipc";
import type { ImportProgress } from "../shared/library";

// Electron prefixes errors thrown in the main process; strip it so the UI can
// show the original message.
const REMOTE_PREFIX = /^Error invoking remote method '[^']+': (?:Error: )?/;

const invoke = async (channel: string, arg: unknown) => {
  try {
    return await ipcRenderer.invoke(channel, arg);
  } catch (err) {
    throw new Error(err instanceof Error ? err.message.replace(REMOTE_PREFIX, "") : String(err));
  }
};

const api = Object.fromEntries(CHANNELS.map((c) => [c, (arg: unknown) => invoke(c, arg)])) as unknown as MidadApi;

contextBridge.exposeInMainWorld("midad", api);

const events: MidadEvents = {
  onLibraryChanged: (callback) => {
    const listener = () => callback();
    ipcRenderer.on(LIBRARY_CHANGED, listener);
    return () => ipcRenderer.off(LIBRARY_CHANGED, listener);
  },
  onImportProgress: (callback) => {
    const listener = (_event: unknown, corpusBookId: string, progress: ImportProgress) => callback(corpusBookId, progress);
    ipcRenderer.on(IMPORT_PROGRESS, listener);
    return () => ipcRenderer.off(IMPORT_PROGRESS, listener);
  },
  onAskEvent: (callback) => {
    const listener = (_event: unknown, requestId: string, event: StreamEvent) => callback(requestId, event);
    ipcRenderer.on(ASK_EVENT, listener);
    return () => ipcRenderer.off(ASK_EVENT, listener);
  },
};

contextBridge.exposeInMainWorld("midadEvents", events);
