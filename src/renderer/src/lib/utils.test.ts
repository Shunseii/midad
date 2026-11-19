import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
  it("keeps the app's font sizes next to a text colour", () => {
    expect(cn("text-ar-small text-ink-2")).toBe("text-ar-small text-ink-2");
    expect(cn("text-body", "text-ink-3")).toBe("text-body text-ink-3");
  });

  it("still lets a later font size override an earlier one", () => {
    expect(cn("text-ar-small", "text-ar-reading")).toBe("text-ar-reading");
  });
});
