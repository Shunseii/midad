import type { UpdateStatus } from "../../../shared/update";
import { timeAgo } from "./format";

export type UpdateTone = "neutral" | "accent" | "ok" | "warn";

/** The status line in Settings → Updates. */
export const updateBadge = ({ status, now }: { status: UpdateStatus; now: number }): { label: string; tone: UpdateTone } => {
  const { phase, checkedAt } = status;
  switch (phase.kind) {
    case "managed":
      return { label: "Managed outside the app", tone: "neutral" };
    case "idle":
    case "checking":
      return { label: "Checking…", tone: "accent" };
    case "upToDate":
      return { label: `Up to date · checked ${timeAgo(Math.min(checkedAt ?? now, now), now)}`, tone: "ok" };
    case "downloading":
      return { label: `Downloading ${phase.percent}%`, tone: "accent" };
    case "ready":
      return { label: "Ready — Restart to update", tone: "ok" };
    case "error":
      return { label: `Couldn't ${phase.during === "download" ? "download" : "check"}: ${phase.message}`, tone: "warn" };
  }
};

/** The line under the version. */
export const updateDetail = ({ status, now }: { status: UpdateStatus; now: number }): string => {
  const { phase, checkedAt, restartBlocked } = status;
  switch (phase.kind) {
    case "managed":
      return "This copy doesn't update itself. Update it the way you installed it.";
    case "downloading":
      return `Getting Midad ${phase.version || "update"}. Keep reading; nothing changes until you restart.`;
    case "ready":
      return restartBlocked ? "Restart once Claude finishes answering, or quit to install." : `Midad ${phase.version} installs when you restart, or the next time you quit.`;
    case "error":
      return checkedAt === null ? "Midad tries again in 6 hours." : `Last checked ${timeAgo(Math.min(checkedAt, now), now)}. Midad tries again in 6 hours.`;
    default:
      return "Checks on launch and every 6 hours.";
  }
};

/** The "Update ready" notice shows for a downloaded update until dismissed; a newer download shows it again. */
export const showNotice = ({ status, dismissed }: { status: UpdateStatus | undefined; dismissed: string | null }): boolean =>
  status?.phase.kind === "ready" && status.phase.version !== dismissed;
