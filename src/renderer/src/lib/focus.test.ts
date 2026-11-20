import { describe, expect, it } from "vitest";
import { chromeHidden, FOCUS_IDLE_MS, type FocusState, focusReducer, initialFocus, msUntilHidden } from "./focus";

const hidden = ({ state, now, enabled = true, held = false }: { state: FocusState; now: number; enabled?: boolean; held?: boolean }) =>
  chromeHidden({ enabled, held, state, now });

describe("focus mode", () => {
  it("never hides the chrome while focus mode is off", () => {
    const state = initialFocus(0);
    expect(hidden({ state, now: 60_000, enabled: false })).toBe(false);
    expect(msUntilHidden({ enabled: false, held: false, state, now: 0 })).toBeNull();
  });

  it("hides at once when turned on, without waiting for the reader to go idle", () => {
    const state = focusReducer(initialFocus(0), { type: "enable", now: 1000 });
    expect(hidden({ state, now: 1000 })).toBe(true);
    expect(msUntilHidden({ enabled: true, held: false, state, now: 1000 })).toBe(0);
  });

  it("waits until nothing holds the chrome before entering, even when turned on from the menu", () => {
    const state = focusReducer(initialFocus(0), { type: "enable", now: 1000 });
    expect(hidden({ state, now: 1000, held: true })).toBe(false);
    const moved = focusReducer(state, { type: "activity", now: 1100 });
    expect(hidden({ state: moved, now: 1200 })).toBe(true);
  });

  it("brings the chrome back on movement once it has hidden", () => {
    let state = focusReducer(initialFocus(0), { type: "enable", now: 1000 });
    state = focusReducer(state, { type: "hidden" });
    state = focusReducer(state, { type: "activity", now: 5000 });
    expect(hidden({ state, now: 5000 })).toBe(false);
  });

  it("hides again after the idle time, not before", () => {
    const state = focusReducer(initialFocus(0), { type: "activity", now: 10_000 });
    expect(hidden({ state, now: 10_000 + FOCUS_IDLE_MS - 1 })).toBe(false);
    expect(hidden({ state, now: 10_000 + FOCUS_IDLE_MS })).toBe(true);
    expect(msUntilHidden({ enabled: true, held: false, state, now: 10_500 })).toBe(FOCUS_IDLE_MS - 500);
  });

  it("keeps the chrome while something holds it, however long the reader is idle", () => {
    const state = focusReducer(initialFocus(0), { type: "activity", now: 0 });
    expect(hidden({ state, now: 60_000, held: true })).toBe(false);
    expect(msUntilHidden({ enabled: true, held: true, state, now: 60_000 })).toBeNull();
  });

  it("hides as soon as the hold ends if the reader has already been idle long enough", () => {
    const state = focusReducer(initialFocus(0), { type: "activity", now: 0 });
    expect(hidden({ state, now: 60_000, held: false })).toBe(true);
  });

  it("always restores on movement: activity after hiding resets the idle clock", () => {
    let state = focusReducer(initialFocus(0), { type: "activity", now: 0 });
    expect(hidden({ state, now: 3000 })).toBe(true);
    state = focusReducer(state, { type: "activity", now: 3000 });
    expect(hidden({ state, now: 3001 })).toBe(false);
  });
});
