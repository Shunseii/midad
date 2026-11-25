import { getHlcFunctions, type MergeableChanges, type MergeableContent } from "tinybase";

type Stamped = MergeableChanges | MergeableContent;
import { CLOCK_WARNING_MS } from "../shared/sync";

const [, , , decodeHlc] = getHlcFunctions("clock-skew");

type Stamp = [thing: unknown, hlc?: string, ...rest: unknown[]];

/**
 * HLCs sort as strings, so the greatest one is the latest. `depth` is how many levels of stamps
 * sit under this one (tables → table → row → cell), so a cell's own value is never read as a stamp.
 */
const latestHlc = ({ stamp, depth }: { stamp: Stamp; depth: number }): string => {
  const [thing, hlc = ""] = stamp;
  let latest = hlc;
  if (depth === 0 || !thing || typeof thing !== "object") return latest;
  for (const child of Object.values(thing as Record<string, Stamp>)) {
    const childLatest = latestHlc({ stamp: child, depth: depth - 1 });
    if (childLatest > latest) latest = childLatest;
  }
  return latest;
};

/** The time on the latest stamp in a set of changes, or null when nothing in it is stamped. */
export const latestStampTime = (changes: Stamped): number | null => {
  const [tables, values] = changes;
  const tablesLatest = latestHlc({ stamp: tables as Stamp, depth: 3 });
  const valuesLatest = latestHlc({ stamp: values as Stamp, depth: 1 });
  const latest = tablesLatest > valuesLatest ? tablesLatest : valuesLatest;
  return latest ? decodeHlc(latest)[0] : null;
};

/** The stamp's time when changes carry one more than CLOCK_WARNING_MS ahead of `now`, else null. */
export const stampAheadOfClock = ({ changes, now }: { changes: Stamped; now: number }): number | null => {
  const latest = latestStampTime(changes);
  return latest !== null && latest - now > CLOCK_WARNING_MS ? latest : null;
};
