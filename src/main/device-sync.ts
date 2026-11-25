import type { SyncSettings, SyncStatus } from "../shared/sync";
import type { Settings } from "./settings";
import type { SyncClient } from "./sync-client";

/**
 * Device sync, set up in Settings or, for tests and development, from MIDAD_SYNC_URL and
 * MIDAD_SYNC_TOKEN, which override Settings when both are set. Connects and disconnects live.
 * The token stays in the main process: the renderer only learns whether one is saved.
 */

export interface SyncConfig {
  url: string;
  token: string;
}

type SyncEnv = { MIDAD_SYNC_URL?: string | undefined; MIDAD_SYNC_TOKEN?: string | undefined };

const fromEnv = (env: SyncEnv): SyncConfig | null =>
  env.MIDAD_SYNC_URL && env.MIDAD_SYNC_TOKEN ? { url: env.MIDAD_SYNC_URL, token: env.MIDAD_SYNC_TOKEN } : null;

/** What sync should connect with, or null when it should be off. */
export const resolveSyncConfig = ({ env, stored }: { env: SyncEnv; stored: ReturnType<Settings["sync"]> }): SyncConfig | null => {
  const overridden = fromEnv(env);
  if (overridden) return overridden;
  return stored.enabled && stored.url && stored.token ? { url: stored.url, token: stored.token } : null;
};

const OFF: SyncStatus = { state: "off", lastSyncedAt: null, retryAt: null, clockAheadUntil: null };

/** The server's WebSocket URL; an http(s) address, as a Worker's URL is usually copied, becomes ws(s). Null when it isn't a URL. */
export const normalizeSyncUrl = (input: string): string | null => {
  try {
    const url = new URL(input.trim().replace(/^http/i, "ws"));
    return ["ws:", "wss:"].includes(url.protocol) ? url.toString().replace(/\/$/, "") : null;
  } catch {
    return null;
  }
};

export const createDeviceSync = ({
  settings,
  env,
  start,
  onStatus,
}: {
  settings: Pick<Settings, "sync" | "saveSync" | "forgetSync">;
  env: SyncEnv;
  start: (input: SyncConfig & { onStatus: (status: SyncStatus) => void }) => SyncClient;
  onStatus: (status: SyncStatus) => void;
}) => {
  let client: SyncClient | null = null;
  let running: SyncConfig | null = null;
  let status = OFF;

  const publish = (next: SyncStatus) => {
    status = next;
    onStatus(next);
  };

  /** Starts, restarts or stops sync to match the settings; `restart` connects again even when nothing changed. */
  const apply = async ({ restart = false }: { restart?: boolean } = {}) => {
    const config = resolveSyncConfig({ env, stored: settings.sync() });
    if (!restart && config && running && config.url === running.url && config.token === running.token) return;
    const previous = client;
    client = null;
    running = null;
    await previous?.stop();
    if (!config) return publish(OFF);
    running = config;
    // A stopped client reports nothing more, so only the current one is heard.
    client = start({ ...config, onStatus: publish });
  };

  const publicSettings = (): SyncSettings => {
    const stored = settings.sync();
    const overridden = fromEnv(env);
    return { url: overridden?.url ?? stored.url, hasToken: (overridden?.token ?? stored.token) !== null, enabled: overridden !== null || stored.enabled, fromEnvironment: overridden !== null };
  };

  return {
    apply,
    settings: publicSettings,
    status: () => status,
    connect: async ({ url, token }: { url: string; token?: string }): Promise<SyncSettings> => {
      if (fromEnv(env)) throw new Error("Sync is set by MIDAD_SYNC_URL and MIDAD_SYNC_TOKEN, which override Settings.");
      const normalized = normalizeSyncUrl(url);
      if (!normalized) throw new Error("Enter the server's address, starting with https:// or wss://.");
      if (!token?.trim() && !settings.sync().token) throw new Error("Enter the sync token.");
      settings.saveSync({ url: normalized, ...(token?.trim() ? { token } : {}) });
      await apply({ restart: true });
      return publicSettings();
    },
    disconnect: async (): Promise<SyncSettings> => {
      if (fromEnv(env)) throw new Error("Sync is set by MIDAD_SYNC_URL and MIDAD_SYNC_TOKEN, which override Settings.");
      settings.forgetSync();
      await apply();
      return publicSettings();
    },
    dismissClockWarning: () => client?.dismissClockWarning(),
    stop: async () => {
      await client?.stop();
      client = null;
    },
  };
};
