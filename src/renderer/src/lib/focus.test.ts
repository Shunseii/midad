import { describe, expect, it } from "vitest";
import {
  atWindowEdge,
  chromeHidden,
  FOCUS_IDLE_MS,
  type FocusChoice,
  focusChoiceFromLegacy,
  type FocusState,
  focusReducer,
  initialFocus,
  msUntilChange,
  PEEK_BOTTOM_EDGE_PX,
  PEEK_DWELL_MS,
  PEEK_EDGE_PX,
  pointerAtEdge,
  toggledFocus,
} from "./focus";

const input = ({
  state,
  now,
  mode = "auto",
  held = false,
  textHeld = false,
}: {
  state: FocusState;
  now: number;
  mode?: FocusChoice;
  held?: boolean;
  textHeld?: boolean;
}) => ({ mode, held, textHeld, state, now });

const hidden = (args: Parameters<typeof input>[0]) => chromeHidden(input(args));

describe("focus mode off", () => {
  it("never hides the chrome", () => {
    const state = initialFocus(0);
    expect(hidden({ state, now: 60_000, mode: "off" })).toBe(false);
    expect(msUntilChange(input({ state, now: 0, mode: "off" }))).toBeNull();
  });
});

describe("focus mode auto", () => {
  it("hides at once when turned on, without waiting for the reader to go idle", () => {
    const state = focusReducer(initialFocus(0), { type: "enable", now: 1000 });
    expect(hidden({ state, now: 1000 })).toBe(true);
    expect(msUntilChange(input({ state, now: 1000 }))).toBe(0);
  });

  it("waits until nothing holds the chrome before entering, even when turned on from the menu", () => {
    const state = focusReducer(initialFocus(0), { type: "enable", now: 1000 });
    expect(hidden({ state, now: 1000, held: true })).toBe(false);
    const moved = focusReducer(state, { type: "activity", now: 1100 });
    expect(hidden({ state: moved, now: 1200 })).toBe(true);
  });

  it("stays hidden after entering until the reader does something", () => {
    let state = focusReducer(initialFocus(0), { type: "enable", now: 1000 });
    state = focusReducer(state, { type: "hidden", now: 1000 });
    expect(hidden({ state, now: 1070 })).toBe(true);
    expect(msUntilChange(input({ state, now: 1070 }))).toBe(0);
  });

  it("brings the chrome back on movement once it has hidden", () => {
    let state = focusReducer(initialFocus(0), { type: "enable", now: 1000 });
    state = focusReducer(state, { type: "hidden", now: 1000 });
    state = focusReducer(state, { type: "activity", now: 5000 });
    expect(hidden({ state, now: 5000 })).toBe(false);
  });

  it("hides again after the idle time, not before", () => {
    const state = focusReducer(initialFocus(0), { type: "activity", now: 10_000 });
    expect(hidden({ state, now: 10_000 + FOCUS_IDLE_MS - 1 })).toBe(false);
    expect(hidden({ state, now: 10_000 + FOCUS_IDLE_MS })).toBe(true);
    expect(msUntilChange(input({ state, now: 10_500 }))).toBe(FOCUS_IDLE_MS - 500);
  });

  it("keeps the chrome while something holds it, however long the reader is idle", () => {
    const state = focusReducer(initialFocus(0), { type: "activity", now: 0 });
    expect(hidden({ state, now: 60_000, held: true })).toBe(false);
    expect(msUntilChange(input({ state, now: 60_000, held: true }))).toBeNull();
  });

  it("keeps the chrome while the reader selects or has a note open", () => {
    const state = focusReducer(initialFocus(0), { type: "activity", now: 0 });
    expect(hidden({ state, now: 60_000, textHeld: true })).toBe(false);
    expect(msUntilChange(input({ state, now: 60_000, textHeld: true }))).toBeNull();
  });

  it("hides as soon as the hold ends if the reader has already been idle long enough", () => {
    const state = focusReducer(initialFocus(0), { type: "activity", now: 0 });
    expect(hidden({ state, now: 60_000 })).toBe(true);
  });
});

describe("focus mode locked", () => {
  const locked = (state: FocusState, now: number, rest: { held?: boolean; textHeld?: boolean } = {}) =>
    hidden({ state, now, mode: "locked", ...rest });

  it("hides at once when turned on", () => {
    const state = focusReducer(initialFocus(0), { type: "enable", now: 1000 });
    expect(locked(state, 1000)).toBe(true);
  });

  it("stays hidden through mouse movement and key presses", () => {
    let state = focusReducer(initialFocus(0), { type: "enable", now: 0 });
    state = focusReducer(state, { type: "hidden", now: 1000 });
    state = focusReducer(state, { type: "activity", now: 5000 });
    state = focusReducer(state, { type: "pointer", now: 5000, atEdge: false });
    expect(locked(state, 5000)).toBe(true);
    expect(msUntilChange(input({ state, now: 5000, mode: "locked" }))).toBeNull();
  });

  it("stays hidden while the reader selects, highlights or writes a note", () => {
    const state = focusReducer(initialFocus(0), { type: "enable", now: 0 });
    expect(locked(state, 100, { textHeld: true })).toBe(true);
  });

  it("still shows the chrome for an open menu or the pointer over the bars", () => {
    const state = focusReducer(initialFocus(0), { type: "enable", now: 0 });
    expect(locked(state, 100, { held: true })).toBe(false);
  });

  it("peeks the bars once the pointer has rested against the edge for the dwell time", () => {
    let state = focusReducer(initialFocus(0), { type: "enable", now: 0 });
    state = focusReducer(state, { type: "pointer", now: 1000, atEdge: true });
    expect(locked(state, 1000 + PEEK_DWELL_MS - 1)).toBe(true);
    expect(msUntilChange(input({ state, now: 1100, mode: "locked" }))).toBe(PEEK_DWELL_MS - 100);
    expect(locked(state, 1000 + PEEK_DWELL_MS)).toBe(false);
    expect(msUntilChange(input({ state, now: 1000 + PEEK_DWELL_MS, mode: "locked" }))).toBeNull();
  });

  it("keeps the dwell running while the pointer moves along the edge", () => {
    let state = focusReducer(initialFocus(0), { type: "pointer", now: 1000, atEdge: true });
    state = focusReducer(state, { type: "pointer", now: 1200, atEdge: true });
    expect(state.edgeSince).toBe(1000);
    expect(locked(state, 1000 + PEEK_DWELL_MS)).toBe(false);
  });

  it("doesn't peek for a pointer that only passes the edge", () => {
    let state = focusReducer(initialFocus(0), { type: "pointer", now: 1000, atEdge: true });
    state = focusReducer(state, { type: "pointer", now: 1100, atEdge: false });
    expect(locked(state, 2000)).toBe(true);
  });

  it("hides the peeked bars again when the pointer moves away", () => {
    let state = focusReducer(initialFocus(0), { type: "pointer", now: 1000, atEdge: true });
    expect(locked(state, 2000)).toBe(false);
    state = focusReducer(state, { type: "pointer", now: 2000, atEdge: false });
    expect(locked(state, 2000)).toBe(true);
  });

  it("returns the same state for pointer moves that change nothing, so React skips the render", () => {
    const away = initialFocus(0);
    expect(focusReducer(away, { type: "pointer", now: 10, atEdge: false })).toBe(away);
    const atEdge = focusReducer(away, { type: "pointer", now: 10, atEdge: true });
    expect(focusReducer(atEdge, { type: "pointer", now: 20, atEdge: true })).toBe(atEdge);
  });
});

describe("the window edge", () => {
  const size = { width: 1400, height: 900 };
  const at = (x: number, y: number) => atWindowEdge({ x, y, ...size });

  it("counts a band along the top, left and right, anywhere along each", () => {
    for (const x of [0, 300, 700, 1100, 1399]) {
      expect(at(x, 0)).toBe(true);
      expect(at(x, PEEK_EDGE_PX - 1)).toBe(true);
    }
    for (const y of [0, 200, 450, 700, 899]) {
      expect(at(0, y)).toBe(true);
      expect(at(PEEK_EDGE_PX - 1, y)).toBe(true);
      expect(at(1399, y)).toBe(true);
      expect(at(1400 - PEEK_EDGE_PX, y)).toBe(true);
    }
  });

  it("counts a taller band along the bottom, anywhere along it, corners included", () => {
    for (const x of [0, 50, 700, 1350, 1399]) {
      expect(at(x, 899)).toBe(true);
      expect(at(x, 900 - PEEK_BOTTOM_EDGE_PX)).toBe(true);
    }
    expect(PEEK_BOTTOM_EDGE_PX).toBeGreaterThan(PEEK_EDGE_PX);
  });

  it("stops at the inner side of each band", () => {
    expect(at(700, PEEK_EDGE_PX)).toBe(false);
    expect(at(PEEK_EDGE_PX, 450)).toBe(false);
    expect(at(1400 - PEEK_EDGE_PX - 1, 450)).toBe(false);
    expect(at(700, 900 - PEEK_BOTTOM_EDGE_PX - 1)).toBe(false);
    expect(at(700, 450)).toBe(false);
  });

  it("leaves the page area alone, 60px in from any edge", () => {
    expect(at(700, 60)).toBe(false);
    expect(at(700, 840)).toBe(false);
    expect(at(60, 450)).toBe(false);
    expect(at(1340, 450)).toBe(false);
  });

  it("counts points outside the window", () => {
    expect(at(700, -5)).toBe(true);
    expect(at(700, 905)).toBe(true);
    expect(at(-5, 450)).toBe(true);
    expect(at(1405, 450)).toBe(true);
  });
});

describe("the pointer against an edge", () => {
  const base = { width: 1400, height: 900, buttons: 0, leftWindow: false };

  it("follows the edge band while the pointer is in the window", () => {
    expect(pointerAtEdge({ ...base, x: 10, y: 890 })).toBe(true);
    expect(pointerAtEdge({ ...base, x: 700, y: 450 })).toBe(false);
  });

  it("counts leaving the window, even when the reported position is short of the edge", () => {
    expect(pointerAtEdge({ ...base, x: 300, y: 820, leftWindow: true })).toBe(true);
  });

  it("ignores the edge while a button is down, as when dragging a selection", () => {
    expect(pointerAtEdge({ ...base, x: 700, y: 895, buttons: 1 })).toBe(false);
    expect(pointerAtEdge({ ...base, x: 700, y: 950, buttons: 1, leftWindow: true })).toBe(false);
  });
});

describe("turning focus mode on and off", () => {
  it("turns on the kind chosen in Settings, and off again", () => {
    expect(toggledFocus({ choice: "off", kind: "auto" })).toBe("auto");
    expect(toggledFocus({ choice: "off", kind: "locked" })).toBe("locked");
    expect(toggledFocus({ choice: "locked", kind: "locked" })).toBe("off");
    expect(toggledFocus({ choice: "auto", kind: "locked" })).toBe("off");
  });

  it("migrates the old on/off preference: on becomes Auto", () => {
    expect(focusChoiceFromLegacy(true)).toBe("auto");
    expect(focusChoiceFromLegacy(false)).toBe("off");
    expect(focusChoiceFromLegacy(undefined)).toBe("off");
    expect(focusChoiceFromLegacy("garbage")).toBe("off");
  });
});
