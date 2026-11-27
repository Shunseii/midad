import { describe, expect, it } from "vitest";
import type { SyncStatus } from "../../../shared/sync";
import { devicesView, toolbarIndicator, toolbarLabel } from "./devices";

const status = (over: Partial<SyncStatus>): SyncStatus => ({ state: "synced", lastSyncedAt: 1, retryAt: null, clockAheadUntil: null, ...over });

describe("devicesView", () => {
  it("shows nothing when sync is off or not known yet", () => {
    expect(devicesView(undefined)).toBeNull();
    expect(devicesView(status({ state: "off" }))).toBeNull();
  });

  it("follows the connection's state", () => {
    expect(devicesView(status({ state: "connecting" }))).toBe("connecting");
    expect(devicesView(status({ state: "synced" }))).toBe("synced");
    expect(devicesView(status({ state: "offline" }))).toBe("offline");
    expect(devicesView(status({ state: "refused" }))).toBe("refused");
  });

  it("puts the clock warning over up to date and connecting, but not over a lost connection", () => {
    const clockAheadUntil = Date.now() + 3_600_000;
    expect(devicesView(status({ state: "synced", clockAheadUntil }))).toBe("clockWarning");
    expect(devicesView(status({ state: "connecting", clockAheadUntil }))).toBe("clockWarning");
    expect(devicesView(status({ state: "offline", clockAheadUntil }))).toBe("offline");
    expect(devicesView(status({ state: "refused", clockAheadUntil }))).toBe("refused");
  });
});

describe("toolbarIndicator", () => {
  it("shows nothing with sync off and no update waiting", () => {
    expect(toolbarIndicator({ view: null, updateReady: false })).toBeNull();
  });

  it("shows the sync state alone, with a dot only for problems, when no update waits", () => {
    expect(toolbarIndicator({ view: "synced", updateReady: false })).toEqual({ glyph: "synced", dot: null });
    expect(toolbarIndicator({ view: "offline", updateReady: false })).toEqual({ glyph: "offline", dot: "problem" });
  });

  it("swaps to the download glyph with the update dot once an update is ready", () => {
    expect(toolbarIndicator({ view: "synced", updateReady: true })).toEqual({ glyph: "updateWithDevices", dot: "update" });
    expect(toolbarIndicator({ view: "connecting", updateReady: true })).toEqual({ glyph: "updateWithDevices", dot: "update" });
  });

  it("lets a sync problem's dot win over the update's", () => {
    expect(toolbarIndicator({ view: "offline", updateReady: true })).toEqual({ glyph: "updateWithDevices", dot: "problem" });
    expect(toolbarIndicator({ view: "refused", updateReady: true })).toEqual({ glyph: "updateWithDevices", dot: "problem" });
    expect(toolbarIndicator({ view: "clockWarning", updateReady: true })).toEqual({ glyph: "updateWithDevices", dot: "problem" });
  });

  it("still shows an icon for the update with sync off", () => {
    expect(toolbarIndicator({ view: null, updateReady: true })).toEqual({ glyph: "updateOnly", dot: "update" });
  });
});

describe("toolbarLabel", () => {
  it("mentions the update after the sync state, or alone with sync off", () => {
    expect(toolbarLabel({ devicesLabel: "Up to date", updateReady: true })).toBe("Up to date · Update ready");
    expect(toolbarLabel({ devicesLabel: null, updateReady: true })).toBe("Update ready");
    expect(toolbarLabel({ devicesLabel: "Offline", updateReady: false })).toBe("Offline");
  });
});
