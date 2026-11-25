import { createMergeableStore } from "tinybase";
import { describe, expect, it } from "vitest";
import { MAX_CLOCK_SKEW_SECONDS } from "../shared/sync";
import { latestStampTime, stampAheadOfClock } from "./clock-skew";

const NOW = Date.UTC(2026, 10, 25, 12);
const MINUTE = 60_000;

const changesFrom = ({ offset, write }: { offset: number; write: (store: ReturnType<typeof createMergeableStore>) => void }) => {
  const store = createMergeableStore("other-device", () => NOW + offset, MAX_CLOCK_SKEW_SECONDS);
  write(store);
  return store.getMergeableContent();
};

const aRow = (store: ReturnType<typeof createMergeableStore>) => store.setRow("notes", "n1", { body: "حاشية" });

describe("stampAheadOfClock", () => {
  it("finds a change from a device whose clock is an hour fast", () => {
    const changes = changesFrom({ offset: 60 * MINUTE, write: aRow });
    expect(stampAheadOfClock({ changes, now: NOW })).toBe(NOW + 60 * MINUTE);
  });

  it("lets a few minutes of drift pass", () => {
    expect(stampAheadOfClock({ changes: changesFrom({ offset: 4 * MINUTE, write: aRow }), now: NOW })).toBeNull();
    expect(stampAheadOfClock({ changes: changesFrom({ offset: 0, write: aRow }), now: NOW })).toBeNull();
  });

  it("ignores changes from a clock that's behind", () => {
    expect(stampAheadOfClock({ changes: changesFrom({ offset: -60 * MINUTE, write: aRow }), now: NOW })).toBeNull();
  });

  it("finds a fast stamp on a value, not only on a row", () => {
    const changes = changesFrom({ offset: 10 * MINUTE, write: (store) => store.setValue("theme", "dark") });
    expect(stampAheadOfClock({ changes, now: NOW })).toBe(NOW + 10 * MINUTE);
  });

  it("finds the one fast cell among many in time", () => {
    const store = createMergeableStore("mixed", () => NOW, MAX_CLOCK_SKEW_SECONDS);
    store.setRow("notes", "n1", { body: "a" });
    const fast = createMergeableStore("fast", () => NOW + 30 * MINUTE, MAX_CLOCK_SKEW_SECONDS);
    fast.setCell("highlights", "h1", "color", "green");
    store.applyMergeableChanges(fast.getMergeableContent());
    expect(latestStampTime(store.getMergeableContent())).toBe(NOW + 30 * MINUTE);
  });

  it("reads a cell holding an array-like string as a value, not a stamp", () => {
    const changes = changesFrom({ offset: 0, write: (store) => store.setRow("notes", "n1", { body: "[\"x\",\"zzzzzzzzzzzzzzzz\"]" }) });
    expect(latestStampTime(changes)).toBe(NOW);
  });

  it("is null for an empty store", () => {
    expect(latestStampTime(createMergeableStore("empty").getMergeableContent())).toBeNull();
  });
});
