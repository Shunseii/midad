import type { UpdatePhase, UpdateStatus } from "../shared/update";

/**
 * Auto-update through electron-updater, from public GitHub Releases. Only packaged Windows builds
 * and Linux AppImages update themselves; anything else (run from source, or a Linux build that
 * isn't an AppImage) is "managed": no checks, and Settings says updates happen outside the app.
 * Checks on launch and every 6 hours, downloads by itself, and installs on quit or on Restart,
 * which waits while an Ask AI answer streams.
 */

export const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

export type UpdaterMode = "on" | "managed";

export const updaterMode = ({ isPackaged, platform, env }: { isPackaged: boolean; platform: NodeJS.Platform; env: { APPIMAGE?: string | undefined } }): UpdaterMode => {
  if (!isPackaged) return "managed";
  if (platform === "win32") return "on";
  if (platform === "linux" && env.APPIMAGE) return "on";
  return "managed";
};

export type UpdaterEvent =
  | { type: "checking" }
  | { type: "available"; version: string }
  | { type: "notAvailable" }
  | { type: "progress"; percent: number }
  | { type: "downloaded"; version: string }
  | { type: "error"; message: string };

/** The next phase after an updater event. A downloaded update stays ready whatever a later check says. */
export const nextPhase = ({ phase, event }: { phase: UpdatePhase; event: UpdaterEvent }): UpdatePhase => {
  if (phase.kind === "managed") return phase;
  if (phase.kind === "ready") return event.type === "downloaded" ? { kind: "ready", version: event.version } : phase;
  switch (event.type) {
    case "checking":
      return phase.kind === "downloading" ? phase : { kind: "checking" };
    case "available":
      return { kind: "downloading", version: event.version, percent: 0 };
    case "notAvailable":
      return { kind: "upToDate" };
    case "progress":
      return { kind: "downloading", version: phase.kind === "downloading" ? phase.version : "", percent: Math.max(0, Math.min(100, Math.round(event.percent))) };
    case "downloaded":
      return { kind: "ready", version: event.version };
    case "error":
      return { kind: "error", during: phase.kind === "downloading" ? "download" : "check", message: event.message };
  }
};

const OFFLINE = /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENETUNREACH|ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_NETWORK_CHANGED|ERR_CONNECTION/;

/** A short reason for "Couldn't check: …". */
export const updateErrorMessage = (err: unknown): string => {
  const text = err instanceof Error ? err.message : String(err);
  if (OFFLINE.test(text)) return "no connection";
  if (/\b404\b|Cannot find .*latest.*\.yml|No published versions/i.test(text)) return "no update published yet";
  if (/\b(403|429)\b|rate limit/i.test(text)) return "GitHub is busy, try later";
  if (/sha512 checksum mismatch|checksum/i.test(text)) return "the download was damaged";
  const line = text.split("\n")[0]?.trim() ?? "";
  return line.length > 80 ? `${line.slice(0, 79)}…` : line || "unknown error";
};

/** What createUpdater needs from electron-updater, so tests can stand in for it. */
export interface UpdateSource {
  /** Calls back with each updater event. */
  listen: (onEvent: (event: UpdaterEvent) => void) => void;
  check: () => Promise<unknown>;
  install: () => void;
}

export const createUpdater = ({
  mode,
  currentVersion,
  source,
  onStatus,
  now = Date.now,
  every = CHECK_EVERY_MS,
}: {
  mode: UpdaterMode;
  currentVersion: string;
  source: UpdateSource | null;
  onStatus: (status: UpdateStatus) => void;
  now?: () => number;
  every?: number;
}) => {
  let status: UpdateStatus = { currentVersion, phase: mode === "managed" ? { kind: "managed" } : { kind: "idle" }, checkedAt: null, restartBlocked: false };
  let timer: ReturnType<typeof setInterval> | null = null;

  const publish = (next: Partial<UpdateStatus>) => {
    const updated = { ...status, ...next };
    if (JSON.stringify(updated) === JSON.stringify(status)) return;
    status = updated;
    onStatus(status);
  };

  const apply = (event: UpdaterEvent) => {
    const reached = event.type === "available" || event.type === "notAvailable";
    publish({ phase: nextPhase({ phase: status.phase, event }), ...(reached ? { checkedAt: now() } : {}) });
  };

  const active = source && mode === "on" ? source : null;
  active?.listen(apply);

  const check = async () => {
    if (!active) return status;
    const { kind } = status.phase;
    if (kind === "checking" || kind === "downloading" || kind === "ready") return status;
    apply({ type: "checking" });
    try {
      await active.check();
    } catch (err) {
      apply({ type: "error", message: updateErrorMessage(err) });
    }
    return status;
  };

  return {
    status: () => status,
    check,
    start: () => {
      if (!active || timer) return;
      void check();
      timer = setInterval(() => void check(), every);
    },
    stop: () => {
      if (timer) clearInterval(timer);
      timer = null;
    },
    /** While an answer streams, Restart is held back. */
    setBusy: (busy: boolean) => {
      if (busy !== status.restartBlocked) publish({ restartBlocked: busy });
    },
    restart: () => {
      if (!active || status.phase.kind !== "ready") throw new Error("No update is ready yet.");
      if (status.restartBlocked) throw new Error("Restart once Claude finishes answering.");
      active.install();
    },
  };
};

export type Updater = ReturnType<typeof createUpdater>;
