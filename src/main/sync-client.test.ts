import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { DatabaseSync } from "node:sqlite";
import { createMergeableStore } from "tinybase";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_CLOCK_SKEW_SECONDS, type SyncStatus } from "../shared/sync";
import { type Connection, type OpenConnection, startSync } from "./sync-client";
import { openUserStore, type UserStore } from "./user-store";

const NOW = Date.UTC(2026, 10, 25, 12);
const MINUTE = 60_000;

/** A stand-in for the server: each attempt to connect takes the next outcome. */
const fakeServer = (outcomes: ("ok" | "fail")[]) => {
  let merging = false;
  const attempts: { onClose: () => void; destroyed: boolean }[] = [];
  const tries = { count: 0 };
  const open: OpenConnection = async ({ onClose }) => {
    tries.count++;
    const outcome = outcomes.shift() ?? "fail";
    if (outcome === "fail") throw new Error("connection refused");
    const attempt = { onClose, destroyed: false };
    attempts.push(attempt);
    const connection: Connection = {
      startSync: async () => {},
      destroy: async () => {
        attempt.destroyed = true;
      },
      getStatus: () => (merging ? 1 : 0),
    };
    return connection;
  };
  /** Applies changes the way the synchronizer does: while it reports Loading. */
  const receive = ({ user, changes }: { user: UserStore; changes: Parameters<UserStore["store"]["applyMergeableChanges"]>[0] }) => {
    merging = true;
    user.store.applyMergeableChanges(changes);
    merging = false;
  };
  return { open, attempts, tries, receive };
};

let clock = NOW;
let user: UserStore;
let stops: (() => Promise<void>)[] = [];

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
  clock = NOW;
  user = openUserStore({ db: new DatabaseSync(":memory:"), clientId: "app", getNow: () => clock });
  stops = [];
});

afterEach(async () => {
  for (const stop of stops) await stop();
  vi.useRealTimers();
});

const run = ({ outcomes, refused = false }: { outcomes: ("ok" | "fail")[]; refused?: boolean }) => {
  const server = fakeServer(outcomes);
  const statuses: SyncStatus[] = [];
  const client = startSync({
    user,
    url: "ws://sync.test/sync",
    token: "t",
    onRemoteChange: () => {},
    onStatus: (status) => statuses.push(status),
    openConnection: server.open,
    checkRefused: async () => refused,
    now: () => clock,
  });
  stops.push(client.stop);
  const states = () => statuses.map((s) => s.state);
  return { server, client, statuses, states };
};

const advance = async (ms: number) => {
  clock += ms;
  await vi.advanceTimersByTimeAsync(ms);
};

describe("startSync status", () => {
  it("goes from connecting to synced, with the time it synced", async () => {
    const { client, states } = run({ outcomes: ["ok"] });
    await advance(0);
    expect(states()).toEqual(["connecting", "synced"]);
    expect(client.status().lastSyncedAt).toBe(NOW);
  });

  it("is offline while it can't reach the server, retrying with backoff, then synced", async () => {
    const { client, states } = run({ outcomes: ["fail", "fail", "ok"] });
    await advance(0);
    expect(client.status()).toMatchObject({ state: "offline", retryAt: NOW + 500, lastSyncedAt: null });
    await advance(500);
    expect(client.status()).toMatchObject({ state: "offline", retryAt: NOW + 500 + 1000 });
    await advance(1000);
    expect(client.status()).toMatchObject({ state: "synced", retryAt: null });
    // Retries stay offline rather than flashing back to connecting.
    expect(states()).toEqual(["connecting", "offline", "offline", "synced"]);
  });

  it("goes offline when a synced connection drops, keeping when it last synced, and comes back", async () => {
    const { server, client } = run({ outcomes: ["ok", "ok"] });
    await advance(0);
    await advance(10 * MINUTE);
    server.attempts[0]?.onClose();
    expect(client.status()).toMatchObject({ state: "offline", lastSyncedAt: NOW });
    await advance(500);
    expect(client.status()).toMatchObject({ state: "synced", lastSyncedAt: NOW + 10 * MINUTE + 500 });
  });

  it("is refused when the server turns the token away, and doesn't retry", async () => {
    const { server, client } = run({ outcomes: ["fail", "ok"], refused: true });
    await advance(0);
    expect(client.status()).toMatchObject({ state: "refused", retryAt: null });
    await advance(10 * MINUTE);
    expect(client.status().state).toBe("refused");
    expect(server.tries.count).toBe(1);
  });

  it("moves lastSyncedAt as changes go out while synced", async () => {
    const { client } = run({ outcomes: ["ok"] });
    await advance(0);
    await advance(5 * MINUTE);
    user.store.setRow("notes", "n1", { body: "جديد" });
    expect(client.status().lastSyncedAt).toBe(NOW + 5 * MINUTE);
  });

  it("says nothing more once stopped", async () => {
    const { client, statuses } = run({ outcomes: ["fail"] });
    await advance(0);
    const count = statuses.length;
    await client.stop();
    await advance(MINUTE);
    expect(statuses).toHaveLength(count);
  });
});

describe("startSync clock warning", () => {
  const fromFastDevice = (offset: number) => {
    const fast = createMergeableStore("fast-device", () => clock + offset, MAX_CLOCK_SKEW_SECONDS);
    fast.setRow("notes", `from-${offset}`, { body: "من جهاز ساعته متقدمة" });
    return fast.getMergeableContent();
  };

  it("accepts a change stamped an hour ahead and warns until real time passes it", async () => {
    const { server, client } = run({ outcomes: ["ok"] });
    await advance(0);
    server.receive({ user, changes: fromFastDevice(60 * MINUTE) });
    expect(user.store.getCell("notes", `from-${60 * MINUTE}`, "body")).toBe("من جهاز ساعته متقدمة");
    expect(client.status()).toMatchObject({ state: "synced", clockAheadUntil: NOW + 60 * MINUTE });
    await advance(59 * MINUTE);
    expect(client.status().clockAheadUntil).toBe(NOW + 60 * MINUTE);
    await advance(MINUTE);
    expect(client.status().clockAheadUntil).toBeNull();
  });

  it("doesn't warn about a couple of minutes of drift", async () => {
    const { server, client } = run({ outcomes: ["ok"] });
    await advance(0);
    server.receive({ user, changes: fromFastDevice(2 * MINUTE) });
    expect(client.status().clockAheadUntil).toBeNull();
  });

  it("doesn't warn about this device's own edits", async () => {
    const { client } = run({ outcomes: ["ok"] });
    await advance(0);
    const fastUser = openUserStore({ db: new DatabaseSync(":memory:"), clientId: "app", getNow: () => clock + 60 * MINUTE });
    user.store.applyMergeableChanges(fastUser.store.getMergeableContent());
    user.store.setRow("notes", "mine", { body: "x" });
    expect(client.status().clockAheadUntil).toBeNull();
  });

  it("goes away on dismiss, and stays away for the same stamp but not a later one", async () => {
    const { server, client } = run({ outcomes: ["ok"] });
    await advance(0);
    const first = fromFastDevice(60 * MINUTE);
    server.receive({ user, changes: first });
    client.dismissClockWarning();
    expect(client.status().clockAheadUntil).toBeNull();
    server.receive({ user, changes: first });
    expect(client.status().clockAheadUntil).toBeNull();
    server.receive({ user, changes: fromFastDevice(2 * 60 * MINUTE) });
    expect(client.status().clockAheadUntil).toBe(NOW + 2 * 60 * MINUTE);
  });

  it("keeps warning about a clock a year ahead, past what one timer can wait", async () => {
    const { server, client } = run({ outcomes: ["ok"] });
    await advance(0);
    server.receive({ user, changes: fromFastDevice(365 * 24 * 60 * MINUTE) });
    await advance(2 * 60 * MINUTE);
    expect(client.status().clockAheadUntil).toBe(NOW + 365 * 24 * 60 * MINUTE);
  });
});

describe("startSync against a real address", () => {
  let server: Server | null = null;
  afterEach(async () => {
    await new Promise((done) => (server ? server.close(done) : done(undefined)));
    server = null;
  });

  const until = async (check: () => boolean) => {
    for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 25));
  };

  /** Answers as the sync Worker does to a token it doesn't know: 401, before any upgrade. */
  const unauthorized = async () => {
    server = createServer((_req, res) => {
      res.writeHead(401);
      res.end("Unauthorized");
    });
    server.on("upgrade", (_req, socket) => socket.end("HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n"));
    await new Promise<void>((done) => server?.listen(0, "127.0.0.1", done));
    return (server.address() as AddressInfo).port;
  };

  const freePort = async () => {
    const probe = createServer();
    await new Promise<void>((done) => probe.listen(0, "127.0.0.1", done));
    const { port } = probe.address() as AddressInfo;
    await new Promise((done) => probe.close(done));
    return port;
  };

  const start = (url: string) => {
    const statuses: SyncStatus[] = [];
    const client = startSync({ user, url, token: "wrong", onRemoteChange: () => {}, onStatus: (s) => statuses.push(s) });
    stops.push(client.stop);
    return client;
  };

  it("tells a refused token from a server that isn't there", async () => {
    vi.useRealTimers();
    const refused = start(`ws://127.0.0.1:${await unauthorized()}/sync`);
    const missing = start(`ws://127.0.0.1:${await freePort()}/sync`);
    await until(() => refused.status().state !== "connecting" && missing.status().state !== "connecting");
    expect(refused.status().state).toBe("refused");
    expect(missing.status().state).toBe("offline");
  });
});
