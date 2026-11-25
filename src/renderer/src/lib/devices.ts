import type { SyncStatus } from "../../../shared/sync";

/** What the Devices indicator shows; a fast clock elsewhere outranks "up to date", a lost connection outranks the clock. */
export type DevicesView = "connecting" | "synced" | "offline" | "refused" | "clockWarning";

/** Null when sync is off, and nothing is shown. */
export const devicesView = (status: SyncStatus | undefined): DevicesView | null => {
  if (!status || status.state === "off") return null;
  if (status.state === "refused" || status.state === "offline") return status.state;
  if (status.clockAheadUntil !== null) return "clockWarning";
  return status.state;
};

export const isProblem = (view: DevicesView) => view === "offline" || view === "refused" || view === "clockWarning";
