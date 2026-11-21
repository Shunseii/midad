import { describe, expect, it } from "vitest";
import {
  atWindowEdge,
  chromeHidden,
  FOCUS_IDLE_MS,
  type FocusChoice,
  focusChoiceFromLegacy,
  focusKeyAction,
  type FocusState,
  focusReducer,
  initialFocus,
  msUntilChange,
  PEEK_DWELL_MS,
  PEEK_EDGE_PX,
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
  it("counts the top and bottom few pixels and nothing between", () => {
    expect(atWindowEdge({ y: 0, height: 800 })).toBe(true);
    expect(atWindowEdge({ y: PEEK_EDGE_PX, height: 800 })).toBe(true);
    expect(atWindowEdge({ y: PEEK_EDGE_PX + 1, height: 800 })).toBe(false);
    expect(atWindowEdge({ y: 400, height: 800 })).toBe(false);
    expect(atWindowEdge({ y: 799, height: 800 })).toBe(true);
    expect(atWindowEdge({ y: 799 - PEEK_EDGE_PX - 1, height: 800 })).toBe(false);
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

describe("focus keys", () => {
  const press = (over: Partial<Parameters<typeof focusKeyAction>[0]> = {}) =>
    focusKeyAction({ key: "f", code: "KeyF", modified: false, typing: false, choice: "off", escapeTaken: false, ...over });
  const esc = { key: "Escape", code: "Escape" };

  it("toggles with F in any mode, by key position so the Arabic layout works too", () => {
    expect(press()).toBe("toggle");
    expect(press({ choice: "auto" })).toBe("toggle");
    expect(press({ key: "ب", choice: "locked" })).toBe("toggle");
  });

  it("ignores F while typing in a field, a note or the harakat editor", () => {
    expect(press({ typing: true })).toBeNull();
    expect(press({ typing: true, choice: "locked" })).toBeNull();
  });

  it("ignores F with a modifier, so shortcuts like Ctrl+F stay free", () => {
    expect(press({ modified: true })).toBeNull();
  });

  it("leaves Locked with Esc", () => {
    expect(press({ ...esc, choice: "locked" })).toBe("leave");
  });

  it("lets Esc close a menu, toolbar or note first", () => {
    expect(press({ ...esc, choice: "locked", escapeTaken: true })).toBeNull();
  });

  it("leaves Esc alone in Auto and when focus mode is off", () => {
    expect(press({ ...esc, choice: "auto" })).toBeNull();
    expect(press({ ...esc, choice: "off" })).toBeNull();
  });
});
