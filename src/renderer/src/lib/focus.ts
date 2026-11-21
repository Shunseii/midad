/**
 * Focus mode: the top bar, contents rail and scrubber step aside while the
 * reader reads.
 *
 * - Auto: they come back on any mouse movement or key press, and leave again
 *   once the reader is idle.
 * - Locked: they stay away through movement, selecting and highlighting. Holding
 *   the pointer against the top or bottom edge of the window peeks them; Esc or
 *   F leaves focus mode.
 */
export type FocusKind = "auto" | "locked";
export type FocusChoice = "off" | FocusKind;

export const FOCUS_IDLE_MS = 2000;
/** How long the pointer has to rest against the window's top or bottom edge before Locked peeks the bars. */
export const PEEK_DWELL_MS = 300;
/** How close to the window's top or bottom edge counts as against it. */
export const PEEK_EDGE_PX = 6;

export interface FocusState {
  /** When the reader last moved the mouse or pressed a key. */
  lastActivity: number;
  /** Set when focus mode is turned on: hide as soon as nothing holds the chrome, without waiting out the idle time. */
  entering: boolean;
  /** Since when the pointer has rested against the top or bottom edge; null while it is anywhere else. */
  edgeSince: number | null;
}

export type FocusEvent =
  | { type: "enable"; now: number }
  | { type: "activity"; now: number }
  /** The chrome has hidden; from here only new activity brings it back. */
  | { type: "hidden"; now: number }
  | { type: "pointer"; now: number; atEdge: boolean };

export const initialFocus = (now: number): FocusState => ({ lastActivity: now, entering: false, edgeSince: null });

export const focusReducer = (state: FocusState, event: FocusEvent): FocusState => {
  switch (event.type) {
    case "enable":
      return { lastActivity: event.now, entering: true, edgeSince: null };
    case "activity":
      return state.entering ? state : { ...state, lastActivity: event.now };
    case "hidden":
      return state.entering ? { ...state, entering: false, lastActivity: Math.min(state.lastActivity, event.now - FOCUS_IDLE_MS) } : state;
    case "pointer":
      if (!event.atEdge) return state.edgeSince === null ? state : { ...state, edgeSince: null };
      return state.edgeSince === null ? { ...state, edgeSince: event.now } : state;
  }
};

export const atWindowEdge = ({ y, height }: { y: number; height: number }) => y <= PEEK_EDGE_PX || y >= height - 1 - PEEK_EDGE_PX;

export const peeking = ({ state, now }: { state: FocusState; now: number }) => state.edgeSince !== null && now - state.edgeSince >= PEEK_DWELL_MS;

interface ChromeInput {
  mode: FocusChoice;
  /** Anything that needs the chrome in every mode: an open menu or dialog, the pointer over the bars, keyboard focus in them. */
  held: boolean;
  /** Reading the text itself: a selection, the selection toolbar, a note. Holds the chrome in Auto only. */
  textHeld: boolean;
  state: FocusState;
  now: number;
}

/** Whether the chrome should be hidden now. */
export const chromeHidden = ({ mode, held, textHeld, state, now }: ChromeInput): boolean => {
  if (mode === "off" || held) return false;
  if (mode === "locked") return !peeking({ state, now });
  return !textHeld && (state.entering || now - state.lastActivity >= FOCUS_IDLE_MS);
};

/** How long until the chrome should next show or hide, if nothing else happens; null when it won't. */
export const msUntilChange = ({ mode, held, textHeld, state, now }: ChromeInput): number | null => {
  if (mode === "off" || held) return null;
  if (mode === "locked") return state.edgeSince === null || peeking({ state, now }) ? null : state.edgeSince + PEEK_DWELL_MS - now;
  if (textHeld) return null;
  if (state.entering) return 0;
  return Math.max(0, state.lastActivity + FOCUS_IDLE_MS - now);
};

/** What the menu's switch, F and Esc turn focus mode to. Turning it on uses the kind chosen in Settings. */
export const toggledFocus = ({ choice, kind }: { choice: FocusChoice; kind: FocusKind }): FocusChoice => (choice === "off" ? kind : "off");

/** Focus mode used to be a plain on/off preference; on meant what is now Auto. */
export const focusChoiceFromLegacy = (legacy: unknown): FocusChoice => (legacy === true ? "auto" : "off");

export type FocusKeyAction = "toggle" | "leave" | null;

/**
 * What a key press does to focus mode. F turns it on and off; Esc leaves Locked
 * when it has nothing else to close. Neither fires while the reader is typing:
 * in a field, a note, or the harakat editor.
 */
export const focusKeyAction = ({
  key,
  code,
  modified,
  typing,
  choice,
  escapeTaken,
}: {
  key: string;
  code: string;
  /** Ctrl, Alt, Meta or Shift is down. */
  modified: boolean;
  typing: boolean;
  choice: FocusChoice;
  /** Esc has something else to close first: a menu, toolbar, note or letter cursor. */
  escapeTaken: boolean;
}): FocusKeyAction => {
  if (typing || modified) return null;
  if (code === "KeyF") return "toggle";
  if (key === "Escape" && choice === "locked" && !escapeTaken) return "leave";
  return null;
};
