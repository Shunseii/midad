/**
 * Focus mode: the top bar, contents rail and scrubber step aside while the
 * reader reads.
 *
 * - Auto: they come back on any mouse movement or key press, and leave again
 *   once the reader is idle.
 * - Locked: they stay away through movement, selecting and highlighting. Resting
 *   the pointer against any edge of the window, or pushing it out past one, peeks
 *   them; they stay while the pointer is over them. Esc or F leaves focus mode.
 */
export type FocusKind = "auto" | "locked";
export type FocusChoice = "off" | FocusKind;

export const FOCUS_IDLE_MS = 2000;
/** How long the pointer has to rest against an edge of the window before Locked peeks the bars. */
export const PEEK_DWELL_MS = 300;
/**
 * How close to the top, left or right edge of the window counts as against it.
 * Generous enough to hit without aiming, and still inside space the text never
 * uses: the 60px header at the top, and at the sides the page's margins, where
 * even in the narrowest window the text starts about 100px in.
 */
export const PEEK_EDGE_PX = 48;
/**
 * The bottom band is taller: it covers the whole scrubber, whose bar sits 20 to
 * 52px up, so pointing anywhere at the height of the scrubber peeks it.
 */
export const PEEK_BOTTOM_EDGE_PX = 64;

export interface FocusState {
  /** When the reader last moved the mouse or pressed a key. */
  lastActivity: number;
  /** Set when focus mode is turned on: hide as soon as nothing holds the chrome, without waiting out the idle time. */
  entering: boolean;
  /** Since when the pointer has rested against an edge of the window; null while it is anywhere else. */
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

interface WindowPoint {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Whether a point is in the band along any edge of the window, or outside the window altogether. */
export const atWindowEdge = ({ x, y, width, height }: WindowPoint) =>
  x < PEEK_EDGE_PX || x >= width - PEEK_EDGE_PX || y < PEEK_EDGE_PX || y >= height - PEEK_BOTTOM_EDGE_PX;

/**
 * Whether the pointer counts as pushed against an edge. Leaving the window always
 * does, whatever position the event reports: it can only leave across an edge, and
 * on Wayland the leave event carries no position, so Chromium reports wherever
 * the last move was, which after a quick flick is often well short of the edge.
 * Nothing counts while a button is down, so dragging a selection to the bottom
 * of the page doesn't peek the scrubber over it.
 */
export const pointerAtEdge = ({ leftWindow, buttons, ...point }: WindowPoint & { leftWindow: boolean; buttons: number }) =>
  buttons === 0 && (leftWindow || atWindowEdge(point));

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

/**
 * How far to move the page so it sits in the middle of the window, in px, or
 * null to leave it. In focus mode the side panels keep their space while they
 * step aside, so the page moves by half the difference: left for the contents,
 * right for the side panel. Pass the panels as they are laid out, not as last
 * asked for: a panel toggled while the bars are hidden hasn't moved yet.
 */
export const pageBalance = ({
  focusOn,
  wide,
  scanBeside,
  contentsWidth,
  sideWidth,
}: {
  focusOn: boolean;
  wide: boolean;
  /** The scan takes the room beside the page, so there is no middle to move to. */
  scanBeside: boolean;
  /** 0 while the contents are closed. */
  contentsWidth: number;
  /** 0 while the side panel is closed. */
  sideWidth: number;
}): number | null => {
  if (!focusOn || !wide || scanBeside || contentsWidth === sideWidth) return null;
  return (contentsWidth - sideWidth) / 2;
};
