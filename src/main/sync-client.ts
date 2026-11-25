import { createWsSynchronizer } from "tinybase/synchronizers/synchronizer-ws-client";
import type { SyncStatus } from "../shared/sync";
import { stampAheadOfClock } from "./clock-skew";
import type { UserStore } from "./user-store";

/**
 * Syncs the app's user store with the sync server over a WebSocket, reconnecting with backoff.
 * Only the app does this; the CLI and the MCP server reach other devices through the app, which
 * merges their saved copies. Changes arriving from the server are saved to the app's own copy
 * like any other change.
 */

/** Node's WebSocket (undici) takes request headers in a second argument the DOM type doesn't describe. */
type NodeWebSocket = new (url: string, init: { headers: Record<string, string> }) => WebSocket;

/** The part of a TinyBase synchronizer this file drives, so tests can stand in for the server. */
export interface Connection {
  startSync: () => Promise<unknown>;
  destroy: () => Promise<unknown>;
  /** 1 while it applies what the server sent. */
  getStatus: () => number;
}

export type OpenConnection = (input: { user: UserStore; url: string; token: string; onClose: () => void }) => Promise<Connection>;

/** Whether the server turned the token away (true) or couldn't be reached at all (false). */
export type CheckRefused = (input: { url: string; token: string }) => Promise<boolean>;

const MAX_DELAY_MS = 30_000;
const FIRST_DELAY_MS = 500;
/** lastSyncedAt moves with every change; the windows hear of it at most this often. */
const LAST_SYNCED_STEP_MS = 1000;
const CLOCK_RECHECK_MS = 60 * 60 * 1000;

/**
 * How long one sync request may take. A new device's first sync brings the whole library (about
 * 400 KB today) in a few replies; on a slow link a short timeout fails them, and the retry fails
 * the same way, so the device never catches up.
 */
const REQUEST_TIMEOUT_SECONDS = 15;

const openWebSocket: OpenConnection = async ({ user, url, token, onClose }) => {
  const ws = new (WebSocket as unknown as NodeWebSocket)(url, { headers: { authorization: `Bearer ${token}` } });
  ws.addEventListener("close", onClose);
  return createWsSynchronizer(user.store, ws, REQUEST_TIMEOUT_SECONDS);
};

/**
 * A WebSocket that fails its upgrade reports nothing about why, so ask over plain HTTP: the sync
 * Worker answers 401 to a token it doesn't know, before it looks for an upgrade.
 */
const askServerAboutToken: CheckRefused = async ({ url, token }) => {
  try {
    const response = await fetch(url.replace(/^ws/, "http"), { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) });
    return response.status === 401 || response.status === 403;
  } catch {
    return false;
  }
};

export const startSync = ({
  user,
  url,
  token,
  onRemoteChange,
  onStatus = () => {},
  openConnection = openWebSocket,
  checkRefused = askServerAboutToken,
  now = Date.now,
}: {
  user: UserStore;
  url: string;
  token: string;
  onRemoteChange: () => void;
  onStatus?: (status: SyncStatus) => void;
  openConnection?: OpenConnection;
  checkRefused?: CheckRefused;
  now?: () => number;
}) => {
  let connection: Connection | null = null;
  let stopped = false;
  let delay = FIRST_DELAY_MS;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let clockTimer: ReturnType<typeof setTimeout> | null = null;
  let remotePending = false;
  let attempts = 0;
  /** A dismissed warning stays away for stamps up to the one it was about. */
  let dismissedUntil = 0;
  let status: SyncStatus = { state: "connecting", lastSyncedAt: null, retryAt: null, clockAheadUntil: null };

  const update = (next: Partial<SyncStatus>) => {
    if (stopped) return;
    status = { ...status, ...next };
    onStatus(status);
  };

  const clearClockWarning = () => {
    if (clockTimer) clearTimeout(clockTimer);
    clockTimer = null;
    if (status.clockAheadUntil !== null) update({ clockAheadUntil: null });
  };

  // Timers longer than about 24 days fire at once, so a clock far ahead is checked on again hourly.
  const clearClockWarningAt = (stamp: number) => {
    const remaining = stamp - now();
    if (remaining <= 0) return clearClockWarning();
    clockTimer = setTimeout(() => clearClockWarningAt(stamp), Math.min(remaining, CLOCK_RECHECK_MS));
  };

  const warnAboutClock = (stamp: number) => {
    if (stamp <= Math.max(status.clockAheadUntil ?? 0, dismissedUntil)) return;
    if (clockTimer) clearTimeout(clockTimer);
    update({ clockAheadUntil: stamp });
    clearClockWarningAt(stamp);
  };

  const dismissClockWarning = () => {
    dismissedUntil = Math.max(dismissedUntil, status.clockAheadUntil ?? 0);
    clearClockWarning();
  };

  const isMerging = () => connection?.getStatus() === 1;
  const unmark = user.mergingWhile(isMerging);
  const listener = user.store.addDidFinishTransactionListener(() => {
    if (status.state === "synced" && now() - (status.lastSyncedAt ?? 0) >= LAST_SYNCED_STEP_MS) update({ lastSyncedAt: now() });
    if (!isMerging()) return;
    const ahead = stampAheadOfClock({ changes: user.store.getTransactionMergeableChanges(), now: now() });
    if (ahead !== null) warnAboutClock(ahead);
    // At once, so the windows hear of the change before the reply to any later request: undo must
    // already have forgotten what changed by the time a Ctrl+Z could act on it.
    onRemoteChange();
    if (remotePending) return;
    remotePending = true;
    // Outside the transaction, where tidying writes are allowed.
    setTimeout(() => {
      remotePending = false;
      user.runAfterMerge();
    }, 0);
  });

  const scheduleRetry = () => {
    if (stopped || retry) return;
    update({ state: "offline", retryAt: now() + delay });
    retry = setTimeout(() => {
      retry = null;
      void connect();
    }, delay);
    delay = Math.min(delay * 2, MAX_DELAY_MS);
  };

  const connect = async () => {
    if (stopped) return;
    const previous = connection;
    connection = null;
    await previous?.destroy().catch(() => {});
    const attempt = ++attempts;
    let closed = false;
    let synced = false;
    const onClose = () => {
      closed = true;
      // Lost after syncing: the network went. Before, the failure is handled below.
      if (synced && attempt === attempts && !stopped) scheduleRetry();
    };
    try {
      const next = await openConnection({ user, url, token, onClose });
      if (stopped) {
        await next.destroy();
        return;
      }
      connection = next;
      await next.startSync();
      if (closed) throw new Error("The connection closed while syncing");
      if (stopped) return;
      synced = true;
      delay = FIRST_DELAY_MS;
      update({ state: "synced", lastSyncedAt: now(), retryAt: null });
    } catch {
      if (stopped) return;
      // Retrying a refused token can't succeed: wait for Settings to give a new one.
      if (await checkRefused({ url, token })) update({ state: "refused", retryAt: null });
      else scheduleRetry();
    }
  };

  onStatus(status);
  void connect();

  return {
    status: () => status,
    dismissClockWarning,
    stop: async () => {
      stopped = true;
      if (retry) clearTimeout(retry);
      if (clockTimer) clearTimeout(clockTimer);
      user.store.delListener(listener);
      unmark();
      await connection?.destroy().catch(() => {});
    },
  };
};

export type SyncClient = ReturnType<typeof startSync>;
