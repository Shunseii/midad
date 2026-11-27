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

export type ToolbarGlyph = DevicesView | "updateWithDevices" | "updateOnly";
export type ToolbarDot = "problem" | "update" | null;

/**
 * The reader top bar's status icon: device sync's state, swapped for a download glyph while an
 * update waits. A sync problem's dot outranks the update's. Null when there's nothing to show.
 */
export const toolbarIndicator = ({ view, updateReady }: { view: DevicesView | null; updateReady: boolean }): { glyph: ToolbarGlyph; dot: ToolbarDot } | null => {
  const problem = view !== null && isProblem(view);
  if (!updateReady) return view ? { glyph: view, dot: problem ? "problem" : null } : null;
  return { glyph: view ? "updateWithDevices" : "updateOnly", dot: problem ? "problem" : "update" };
};

/** The top bar icon's tooltip, e.g. "Up to date · Update ready". */
export const toolbarLabel = ({ devicesLabel, updateReady }: { devicesLabel: string | null; updateReady: boolean }): string =>
  [devicesLabel, updateReady ? "Update ready" : null].filter(Boolean).join(" · ");
