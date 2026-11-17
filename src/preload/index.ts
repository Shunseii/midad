import { contextBridge, ipcRenderer } from "electron";
import { CHANNELS, type HamishApi } from "../shared/ipc";

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

const api = Object.fromEntries(CHANNELS.map((c) => [c, (arg: unknown) => invoke(c, arg)])) as unknown as HamishApi;

contextBridge.exposeInMainWorld("hamish", api);
