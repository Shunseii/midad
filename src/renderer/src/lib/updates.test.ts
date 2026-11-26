import { describe, expect, it } from "vitest";
import type { UpdatePhase, UpdateStatus } from "../../../shared/update";
import { showNotice, updateBadge, updateDetail } from "./updates";

const NOW = 10 * 60 * 60 * 1000;
const status = (phase: UpdatePhase, over: Partial<UpdateStatus> = {}): UpdateStatus => ({ currentVersion: "0.2.0", phase, checkedAt: null, restartBlocked: false, ...over });

describe("updateBadge", () => {
  it("names each state in a few words", () => {
    expect(updateBadge({ status: status({ kind: "checking" }), now: NOW })).toEqual({ label: "Checking…", tone: "accent" });
    expect(updateBadge({ status: status({ kind: "upToDate" }, { checkedAt: NOW - 5 * 60_000 }), now: NOW })).toEqual({ label: "Up to date · checked 5 minutes ago", tone: "ok" });
    expect(updateBadge({ status: status({ kind: "downloading", version: "0.3.0", percent: 42 }), now: NOW }).label).toBe("Downloading 42%");
    expect(updateBadge({ status: status({ kind: "ready", version: "0.3.0" }), now: NOW })).toEqual({ label: "Ready — Restart to update", tone: "ok" });
    expect(updateBadge({ status: status({ kind: "error", during: "check", message: "no connection" }), now: NOW })).toEqual({ label: "Couldn't check: no connection", tone: "warn" });
    expect(updateBadge({ status: status({ kind: "error", during: "download", message: "the download was damaged" }), now: NOW }).label).toBe("Couldn't download: the download was damaged");
    expect(updateBadge({ status: status({ kind: "managed" }), now: NOW })).toEqual({ label: "Managed outside the app", tone: "neutral" });
  });

  it("never says a check happened in the future", () => {
    expect(updateBadge({ status: status({ kind: "upToDate" }, { checkedAt: NOW + 60_000 }), now: NOW }).label).toBe("Up to date · checked just now");
  });
});

describe("updateDetail", () => {
  it("says Restart waits for a streaming answer", () => {
    expect(updateDetail({ status: status({ kind: "ready", version: "0.3.0" }), now: NOW })).toBe("Midad 0.3.0 installs when you restart, or the next time you quit.");
    expect(updateDetail({ status: status({ kind: "ready", version: "0.3.0" }, { restartBlocked: true }), now: NOW })).toBe("Restart once Claude finishes answering, or quit to install.");
  });

  it("says when the last good check was after a failure", () => {
    expect(updateDetail({ status: status({ kind: "error", during: "check", message: "x" }, { checkedAt: NOW - 3 * 3600_000 }), now: NOW })).toBe("Last checked 3 hours ago. Midad tries again in 6 hours.");
    expect(updateDetail({ status: status({ kind: "error", during: "check", message: "x" }), now: NOW })).toBe("Midad tries again in 6 hours.");
  });
});

describe("showNotice", () => {
  it("shows only for a ready update that wasn't dismissed", () => {
    expect(showNotice({ status: undefined, dismissed: null })).toBe(false);
    expect(showNotice({ status: status({ kind: "downloading", version: "0.3.0", percent: 99 }), dismissed: null })).toBe(false);
    expect(showNotice({ status: status({ kind: "ready", version: "0.3.0" }), dismissed: null })).toBe(true);
    expect(showNotice({ status: status({ kind: "ready", version: "0.3.0" }), dismissed: "0.3.0" })).toBe(false);
    expect(showNotice({ status: status({ kind: "ready", version: "0.4.0" }), dismissed: "0.3.0" })).toBe(true);
  });
});
