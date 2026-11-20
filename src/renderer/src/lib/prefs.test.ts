import { describe, expect, it, vi } from "vitest";
import { getPref, setPref, subscribePref } from "./prefs";

describe("shared preferences", () => {
  it("gives the fallback until a value is set, then the value", () => {
    expect(getPref({ key: "test.width", fallback: "narrow" })).toBe("narrow");
    setPref({ key: "test.width", value: "wide" });
    expect(getPref({ key: "test.width", fallback: "narrow" })).toBe("wide");
  });

  it("tells every listener on a key when it changes, and no one else", () => {
    const first = vi.fn();
    const second = vi.fn();
    const other = vi.fn();
    subscribePref({ key: "test.theme", listener: first });
    subscribePref({ key: "test.theme", listener: second });
    subscribePref({ key: "test.focus", listener: other });
    setPref({ key: "test.theme", value: "dark" });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(other).not.toHaveBeenCalled();
  });

  it("stops telling a listener once it unsubscribes", () => {
    const listener = vi.fn();
    const unsubscribe = subscribePref({ key: "test.scale", listener });
    unsubscribe();
    setPref({ key: "test.scale", value: 1.25 });
    expect(listener).not.toHaveBeenCalled();
  });

  it("doesn't notify when the value is unchanged", () => {
    setPref({ key: "test.same", value: true });
    const listener = vi.fn();
    subscribePref({ key: "test.same", listener });
    setPref({ key: "test.same", value: true });
    expect(listener).not.toHaveBeenCalled();
  });

  it("returns the same object on repeated reads so React doesn't re-render forever", () => {
    expect(getPref({ key: "test.object", fallback: { a: 1 } })).toBe(getPref({ key: "test.object", fallback: { a: 1 } }));
  });
});
