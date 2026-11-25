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
  /** The device-sync server's WebSocket URL. */
  syncUrl: string;
  /** base64; encrypted with the OS keychain when `syncTokenEncrypted` is true. */
  syncToken: string | null;
  syncTokenEncrypted: boolean;
  /** Off after Disconnect, which forgets the token and keeps the URL. */
  syncEnabled: boolean;
}

const EMPTY: StoredSettings = {
  endpoint: "",
  key: null,
  encrypted: false,
  theme: "system",
  syncUrl: "",
  syncToken: null,
  syncTokenEncrypted: false,
  syncEnabled: false,
};

/** Electron's safeStorage, or a stand-in for it in tests. */
export type Cipher = Pick<typeof safeStorage, "isEncryptionAvailable" | "encryptString" | "decryptString">;

export interface StoredSync {
  url: string;
  token: string | null;
  enabled: boolean;
}

export const createSettings = ({ dir, cipher = safeStorage }: { dir: string; cipher?: Cipher }) => {
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

  const encodeSecret = (secret: string): { value: string; encrypted: boolean } =>
    cipher.isEncryptionAvailable()
      ? { value: cipher.encryptString(secret).toString("base64"), encrypted: true }
      : { value: Buffer.from(secret, "utf8").toString("base64"), encrypted: false };

  const decodeSecret = ({ value, encrypted }: { value: string | null; encrypted: boolean }): string | null => {
    if (!value) return null;
    const bytes = Buffer.from(value, "base64");
    return encrypted ? cipher.decryptString(bytes) : bytes.toString("utf8");
  };

  const encodeKey = (key: string): Pick<StoredSettings, "key" | "encrypted"> => {
    const { value, encrypted } = encodeSecret(key);
    return { key: value, encrypted };
  };

  const decodeKey = ({ key, encrypted }: StoredSettings): string | null => decodeSecret({ value: key, encrypted });

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

    /** The device-sync setup saved in Settings, token decrypted: for the main process only. */
    sync: (): StoredSync => {
      const s = read();
      let token: string | null = null;
      try {
        token = decodeSecret({ value: s.syncToken, encrypted: s.syncTokenEncrypted });
      } catch {
        // Encrypted under another keychain (a copied profile): as good as no token.
      }
      return { url: s.syncUrl, token, enabled: s.syncEnabled };
    },

    /** Saves the sync URL and turns sync on, with a new token when given (else the saved one stays). */
    saveSync: ({ url, token }: { url: string; token?: string }) => {
      const current = read();
      const encoded = token?.trim() ? encodeSecret(token.trim()) : null;
      write({
        ...current,
        syncUrl: url.trim(),
        syncEnabled: true,
        ...(encoded ? { syncToken: encoded.value, syncTokenEncrypted: encoded.encrypted } : {}),
      });
    },

    /** Turns sync off and forgets the token; the URL stays for connecting again. */
    forgetSync: () => write({ ...read(), syncEnabled: false, syncToken: null, syncTokenEncrypted: false }),

    /** The stored endpoint and key, or null when the corpus isn't configured yet. */
    credentials: (): { endpoint: string; key: string } | null => {
      const s = read();
      const key = decodeKey(s);
      return s.endpoint && key ? { endpoint: s.endpoint, key } : null;
    },
  };
};

export type Settings = ReturnType<typeof createSettings>;
