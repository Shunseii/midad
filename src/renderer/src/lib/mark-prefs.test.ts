import { describe, expect, it } from "vitest";
import { glossModeFrom, noteIconsFrom } from "./mark-prefs";

describe("noteIconsFrom", () => {
  it("turns the old icon on the words into corners and keeps the margin", () => {
    expect(noteIconsFrom("words")).toBe("corners");
    expect(noteIconsFrom("corners")).toBe("corners");
    expect(noteIconsFrom("margin")).toBe("margin");
    expect(noteIconsFrom(undefined)).toBe("corners");
  });
});

describe("glossModeFrom", () => {
  it("keeps a chosen mode", () => {
    expect(glossModeFrom({ stored: "hover", legacyMarkers: false })).toBe("hover");
    expect(glossModeFrom({ stored: "hidden", legacyMarkers: true })).toBe("hidden");
  });

  it("follows the old gloss markers switch until a mode is chosen", () => {
    expect(glossModeFrom({ stored: null, legacyMarkers: false })).toBe("hidden");
    expect(glossModeFrom({ stored: null, legacyMarkers: true })).toBe("under");
    expect(glossModeFrom({ stored: "rings", legacyMarkers: true })).toBe("under");
  });
});
