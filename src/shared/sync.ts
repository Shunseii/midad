/**
 * TinyBase silently skips stamps further ahead of the merging store's clock than this (300 seconds
 * by default). Skipping one in a client's own saved copy, after its clock was set back, would drop
 * it from the next save for good, and on the sync server it would drop a fast device's edits. So
 * every store, client and server, accepts any skew: a fast clock only makes that device's edits win
 * until real time catches up.
 */
export const MAX_CLOCK_SKEW_SECONDS = 100 * 365 * 24 * 60 * 60;
