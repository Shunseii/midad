import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { safeStorage } from "electron";
import type { PublicSettings, Theme } from "../shared/ipc";

interface StoredSettings {
  endpoint: string;
  /** base64; encrypted with the OS keychain when `encrypted` is true. */
  key: string | null;
  encrypted: boolean;
  /** Kept here so the window opens in the right colour before the page loads. */
  theme: Theme;
}

const EMPTY: StoredSettings = { endpoint: "", key: null, encrypted: false, theme: "system" };

export const createSettings = ({ dir }: { dir: string }) => {
  const file = join(dir, "settings.json");

  const read = (): StoredSettings => {
    try {
      return { ...EMPTY, ...(JSON.parse(readFileSync(file, "utf8")) as Partial<StoredSettings>) };
    } catch {
      return EMPTY;
    }
  };

  const write = (settings: StoredSettings) => {
    writeFileSync(`${file}.tmp`, JSON.stringify(settings, null, 2));
    renameSync(`${file}.tmp`, file);
  };

  const encodeKey = (key: string): Pick<StoredSettings, "key" | "encrypted"> =>
    safeStorage.isEncryptionAvailable()
      ? { key: safeStorage.encryptString(key).toString("base64"), encrypted: true }
      : { key: Buffer.from(key, "utf8").toString("base64"), encrypted: false };

  const decodeKey = ({ key, encrypted }: StoredSettings): string | null => {
    if (!key) return null;
    const bytes = Buffer.from(key, "base64");
    return encrypted ? safeStorage.decryptString(bytes) : bytes.toString("utf8");
  };

  const toPublic = (s: StoredSettings): PublicSettings => ({ endpoint: s.endpoint, hasKey: s.key !== null });

  return {
    get: (): PublicSettings => toPublic(read()),

    save: ({ endpoint, key }: { endpoint: string; key?: string }): PublicSettings => {
      const current = read();
      const next: StoredSettings = {
        ...current,
        endpoint: endpoint.trim().replace(/\/+$/, ""),
        ...(key?.trim() ? encodeKey(key.trim()) : {}),
      };
      write(next);
      return toPublic(next);
    },

    theme: (): Theme => read().theme,

    saveTheme: (theme: Theme) => write({ ...read(), theme }),

    /** The stored endpoint and key, or null when the corpus isn't configured yet. */
    credentials: (): { endpoint: string; key: string } | null => {
      const s = read();
      const key = decodeKey(s);
      return s.endpoint && key ? { endpoint: s.endpoint, key } : null;
    },
  };
};

export type Settings = ReturnType<typeof createSettings>;
