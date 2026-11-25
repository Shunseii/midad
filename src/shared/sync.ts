/**
 * TinyBase silently skips stamps further ahead of the merging store's clock than this (300 seconds
 * by default). Skipping one in a client's own saved copy, after its clock was set back, would drop
 * it from the next save for good, and on the sync server it would drop a fast device's edits. So
 * every store, client and server, accepts any skew: a fast clock only makes that device's edits win
 * until real time catches up.
 */
export const MAX_CLOCK_SKEW_SECONDS = 100 * 365 * 24 * 60 * 60;

/** A change stamped this far ahead of this device's clock means another device's clock is fast. */
export const CLOCK_WARNING_MS = 5 * 60 * 1000;

/** `refused`: the server turned the token away; nothing is retried until the token changes. */
export type SyncState = "off" | "connecting" | "synced" | "offline" | "refused";

export interface SyncStatus {
  state: SyncState;
  lastSyncedAt: number | null;
  /** When the next attempt to reach the server is due, while offline. */
  retryAt: number | null;
  /** The latest time stamped on a change from a device whose clock runs fast, until real time passes it. */
  clockAheadUntil: number | null;
}

/** What the renderer may know about the sync setup: never the token itself. */
export interface SyncSettings {
  url: string;
  hasToken: boolean;
  enabled: boolean;
  /** The OS keychain encrypts the saved token; false on Linux without a keyring, where it is saved unencrypted. */
  keychain: boolean;
  /** MIDAD_SYNC_URL and MIDAD_SYNC_TOKEN are set, and override what Settings saved. */
  fromEnvironment: boolean;
}
