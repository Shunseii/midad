import { describe, expect, it } from "vitest";
import type { SyncStatus } from "../../../shared/sync";
import { devicesView } from "./devices";

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
