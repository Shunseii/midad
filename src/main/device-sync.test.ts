import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SyncStatus } from "../shared/sync";
import { createDeviceSync, normalizeSyncUrl, resolveSyncConfig, type SyncConfig } from "./device-sync";
import { type Cipher, createSettings } from "./settings";
import type { SyncClient } from "./sync-client";

const TOKEN = "device-token-0123456789";

/** Reverses the bytes and marks them, so a stored token is visibly not the plain text. */
const cipher: Cipher = {
  isEncryptionAvailable: () => true,
  encryptString: (text) => Buffer.from(`enc:${[...text].reverse().join("")}`),
  decryptString: (bytes) => [...bytes.toString().slice(4)].reverse().join(""),
};

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "midad-device-sync-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const stored = (over: Partial<{ url: string; token: string | null; enabled: boolean }> = {}) => ({ url: "", token: null, enabled: false, ...over });

describe("resolveSyncConfig", () => {
  it("is off with nothing set", () => {
    expect(resolveSyncConfig({ env: {}, stored: stored() })).toBeNull();
  });

  it("uses what Settings saved", () => {
    expect(resolveSyncConfig({ env: {}, stored: stored({ url: "wss://s", token: "t", enabled: true }) })).toEqual({ url: "wss://s", token: "t" });
  });

  it("is off after Disconnect, even with a URL kept", () => {
    expect(resolveSyncConfig({ env: {}, stored: stored({ url: "wss://s", token: null, enabled: false }) })).toBeNull();
  });

  it("lets both environment variables override Settings", () => {
    const env = { MIDAD_SYNC_URL: "ws://env", MIDAD_SYNC_TOKEN: "env-token" };
    expect(resolveSyncConfig({ env, stored: stored({ url: "wss://s", token: "t", enabled: true }) })).toEqual({ url: "ws://env", token: "env-token" });
    expect(resolveSyncConfig({ env, stored: stored() })).toEqual({ url: "ws://env", token: "env-token" });
  });

  it("ignores just one environment variable", () => {
    expect(resolveSyncConfig({ env: { MIDAD_SYNC_URL: "ws://env" }, stored: stored({ url: "wss://s", token: "t", enabled: true }) })).toEqual({ url: "wss://s", token: "t" });
    expect(resolveSyncConfig({ env: { MIDAD_SYNC_TOKEN: "x" }, stored: stored() })).toBeNull();
  });
});

describe("normalizeSyncUrl", () => {
  it("turns a Worker's https address into wss", () => {
    expect(normalizeSyncUrl(" https://midad-sync.example.workers.dev/ ")).toBe("wss://midad-sync.example.workers.dev");
    expect(normalizeSyncUrl("http://127.0.0.1:8787/sync")).toBe("ws://127.0.0.1:8787/sync");
    expect(normalizeSyncUrl("wss://x.dev/sync")).toBe("wss://x.dev/sync");
  });

  it("refuses what isn't a server address", () => {
    expect(normalizeSyncUrl("midad-sync")).toBeNull();
    expect(normalizeSyncUrl("ftp://x.dev")).toBeNull();
  });
});

const fakeStart = () => {
  const started: (SyncConfig & { stopped: boolean })[] = [];
  const start = ({ url, token, onStatus }: SyncConfig & { onStatus: (status: SyncStatus) => void }): SyncClient => {
    const entry = { url, token, stopped: false };
    started.push(entry);
    onStatus({ state: "connecting", lastSyncedAt: null, retryAt: null, clockAheadUntil: null });
    return {
      status: () => ({ state: "connecting", lastSyncedAt: null, retryAt: null, clockAheadUntil: null }),
      dismissClockWarning: () => {},
      stop: async () => {
        entry.stopped = true;
      },
    };
  };
  return { started, start };
};

describe("createDeviceSync", () => {
  const setup = (env: Record<string, string> = {}) => {
    const settings = createSettings({ dir, cipher });
    const { started, start } = fakeStart();
    const statuses: SyncStatus[] = [];
    const sync = createDeviceSync({ settings, env, start, onStatus: (s) => statuses.push(s) });
    return { settings, started, statuses, sync };
  };

  it("connects when set up in Settings, without a restart, and goes off on Disconnect", async () => {
    const { started, statuses, sync } = setup();
    await sync.apply();
    expect(started).toHaveLength(0);
    expect(sync.status().state).toBe("off");

    await sync.connect({ url: "https://sync.example.dev", token: TOKEN });
    expect(started).toEqual([{ url: "wss://sync.example.dev", token: TOKEN, stopped: false }]);
    expect(sync.status().state).toBe("connecting");

    await sync.disconnect();
    expect(started[0]?.stopped).toBe(true);
    expect(statuses.at(-1)?.state).toBe("off");
    expect(sync.settings()).toEqual({ url: "wss://sync.example.dev", hasToken: false, enabled: false, fromEnvironment: false });
  });

  it("reconnects with the saved token when only the address changes", async () => {
    const { started, sync } = setup();
    await sync.connect({ url: "wss://one.dev", token: TOKEN });
    await sync.connect({ url: "wss://two.dev" });
    expect(started.map(({ url, token, stopped }) => [url, token, stopped])).toEqual([
      ["wss://one.dev", TOKEN, true],
      ["wss://two.dev", TOKEN, false],
    ]);
  });

  it("asks for a token before the first connect", async () => {
    const { started, sync } = setup();
    await expect(sync.connect({ url: "wss://one.dev" })).rejects.toThrow("Enter the sync token.");
    expect(started).toHaveLength(0);
  });

  it("starts from the environment on launch, and won't let Settings change it", async () => {
    const { started, sync } = setup({ MIDAD_SYNC_URL: "ws://127.0.0.1:1/sync", MIDAD_SYNC_TOKEN: "env-token" });
    await sync.apply();
    expect(started).toEqual([{ url: "ws://127.0.0.1:1/sync", token: "env-token", stopped: false }]);
    expect(sync.settings()).toEqual({ url: "ws://127.0.0.1:1/sync", hasToken: true, enabled: true, fromEnvironment: true });
    await expect(sync.connect({ url: "wss://other.dev", token: "x" })).rejects.toThrow("MIDAD_SYNC_URL");
    await expect(sync.disconnect()).rejects.toThrow("MIDAD_SYNC_URL");
  });

  it("starts on launch from what Settings saved before", async () => {
    const first = setup();
    await first.sync.connect({ url: "wss://saved.dev", token: TOKEN });
    const { started, sync } = setup();
    await sync.apply();
    expect(started).toEqual([{ url: "wss://saved.dev", token: TOKEN, stopped: false }]);
  });

  it("never hands the token to the renderer, and stores it only encrypted", async () => {
    const { settings, statuses, sync } = setup();
    const replies = [await sync.connect({ url: "wss://saved.dev", token: TOKEN }), sync.settings(), sync.status(), settings.get(), ...statuses];
    for (const reply of replies) expect(JSON.stringify(reply)).not.toContain(TOKEN);
    expect(sync.settings().hasToken).toBe(true);
    expect(readFileSync(join(dir, "settings.json"), "utf8")).not.toContain(TOKEN);
    expect(settings.sync().token).toBe(TOKEN);
  });

  it("keeps the corpus settings when sync is saved", async () => {
    const { settings, sync } = setup();
    settings.save({ endpoint: "https://corpus.dev", key: "corpus-key" });
    await sync.connect({ url: "wss://saved.dev", token: TOKEN });
    await sync.disconnect();
    expect(settings.credentials()).toEqual({ endpoint: "https://corpus.dev", key: "corpus-key" });
  });
});
