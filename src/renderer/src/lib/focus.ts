/**
 * Focus mode: the top bar and contents rail step aside while the reader reads,
 * and come back on any mouse movement or key press.
 */
export const FOCUS_IDLE_MS = 2000;

export interface FocusState {
  /** When the reader last moved the mouse or pressed a key. */
  lastActivity: number;
  /** Set when focus mode is turned on: hide as soon as nothing holds the chrome, without waiting out the idle time. */
  entering: boolean;
}

export type FocusEvent = { type: "enable"; now: number } | { type: "activity"; now: number } | { type: "hidden" };

export const initialFocus = (now: number): FocusState => ({ lastActivity: now, entering: false });

export const focusReducer = (state: FocusState, event: FocusEvent): FocusState => {
  switch (event.type) {
    case "enable":
      return { lastActivity: event.now, entering: true };
    case "activity":
      return state.entering ? state : { ...state, lastActivity: event.now };
    case "hidden":
      return state.entering ? { ...state, entering: false } : state;
  }
};

/**
 * Whether the chrome should be hidden now. `held` is anything that needs the
 * chrome: an open menu, popover or dialog, a text selection, the pointer over
 * the bars or a panel.
 */
export const chromeHidden = ({ enabled, held, state, now }: { enabled: boolean; held: boolean; state: FocusState; now: number }): boolean =>
  enabled && !held && (state.entering || now - state.lastActivity >= FOCUS_IDLE_MS);

/** How long until the chrome should hide, if nothing else happens; null when it won't. */
export const msUntilHidden = ({ enabled, held, state, now }: { enabled: boolean; held: boolean; state: FocusState; now: number }): number | null => {
  if (!enabled || held) return null;
  if (state.entering) return 0;
  return Math.max(0, state.lastActivity + FOCUS_IDLE_MS - now);
};
