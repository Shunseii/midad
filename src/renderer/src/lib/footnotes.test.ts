import { describe, expect, it } from "vitest";
import { footnotesByMarker, splitFootnoteRef } from "./footnotes";

describe("footnotesByMarker", () => {
  it("keys each footnote by its marker", () => {
    const notes = footnotesByMarker([
      { marker: "١", text: "first" },
      { marker: "٢", text: "second" },
    ]);
    expect(notes.get("١")).toBe("first");
    expect(notes.get("٢")).toBe("second");
  });

  it("joins an unmarked entry onto the footnote before it", () => {
    const notes = footnotesByMarker([
      { marker: "١", text: "starts here" },
      { marker: null, text: "and carries on" },
    ]);
    expect(notes.get("١")).toBe("starts here and carries on");
  });

  it("joins a repeated marker onto the first instead of replacing it", () => {
    expect(footnotesByMarker([{ marker: "١", text: "a" }, { marker: "١", text: "b" }]).get("١")).toBe("a b");
  });

  it("drops unmarked text that comes before any marker", () => {
    expect([...footnotesByMarker([{ marker: null, text: "orphan" }]).keys()]).toEqual([]);
  });
});

describe("splitFootnoteRef", () => {
  it("finds an Arabic-Indic reference inside a word", () => {
    expect(splitFootnoteRef("الطلب،(١)")).toEqual({ before: "الطلب،", marker: "١", after: "" });
  });

  it("finds a Latin-digit reference", () => {
    expect(splitFootnoteRef("(12)x")).toEqual({ before: "", marker: "12", after: "x" });
  });

  it("leaves text without a reference alone", () => {
    expect(splitFootnoteRef("(كلمة)")).toBeNull();
    expect(splitFootnoteRef("بلا")).toBeNull();
  });
});
