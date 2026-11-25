import { createWsSynchronizer, type WsSynchronizer } from "tinybase/synchronizers/synchronizer-ws-client";
import type { UserStore } from "./user-store";

/**
 * Syncs the app's user store with the sync server over a WebSocket, reconnecting with backoff.
 * Only the app does this; the CLI and the MCP server reach other devices through the app, which
 * merges their saved copies. Changes arriving from the server are saved to the app's own copy
 * like any other change.
 */

export type SyncState = "connecting" | "synced" | "offline";

/** Node's WebSocket (undici) takes request headers in a second argument the DOM type doesn't describe. */
type NodeWebSocket = new (url: string, init: { headers: Record<string, string> }) => WebSocket;

const MAX_DELAY_MS = 30_000;

/**
 * How long one sync request may take. A new device's first sync brings the whole library (about
 * 400 KB today) in a few replies; on a slow link a short timeout fails them, and the retry fails
 * the same way, so the device never catches up.
 */
const REQUEST_TIMEOUT_SECONDS = 15;

export const startSync = ({
  user,
  url,
  token,
  onRemoteChange,
  onState = () => {},
}: {
  user: UserStore;
  url: string;
  token: string;
  onRemoteChange: () => void;
  onState?: (state: SyncState) => void;
}) => {
  let synchronizer: WsSynchronizer<WebSocket> | null = null;
  let stopped = false;
  let delay = 500;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let remotePending = false;

  // The synchronizer reports Loading (1) while it applies what the server sent.
  const unmark = user.mergingWhile(() => synchronizer?.getStatus() === 1);
  const listener = user.store.addDidFinishTransactionListener(() => {
    if (synchronizer?.getStatus() !== 1) return;
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

  const reconnect = () => {
    if (stopped || retry) return;
    onState("offline");
    retry = setTimeout(() => {
      retry = null;
      void connect();
    }, delay);
    delay = Math.min(delay * 2, MAX_DELAY_MS);
  };

  const connect = async () => {
    if (stopped) return;
    onState("connecting");
    const previous = synchronizer;
    synchronizer = null;
    await previous?.destroy().catch(() => {});
    try {
      const ws = new (WebSocket as unknown as NodeWebSocket)(url, { headers: { authorization: `Bearer ${token}` } });
      ws.addEventListener("close", reconnect);
      const next = await createWsSynchronizer(user.store, ws, REQUEST_TIMEOUT_SECONDS);
      if (stopped) {
        await next.destroy();
        return;
      }
      synchronizer = next;
      await next.startSync();
      delay = 500;
      onState("synced");
    } catch {
      reconnect();
    }
  };

  void connect();

  return {
    stop: async () => {
      stopped = true;
      if (retry) clearTimeout(retry);
      user.store.delListener(listener);
      unmark();
      await synchronizer?.destroy().catch(() => {});
    },
  };
};
