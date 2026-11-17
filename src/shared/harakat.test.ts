import { describe, expect, it } from "vitest";
import { displayMarks, inContext, lettersOf, MARK, markFromKey, mergeMarks, normalizeMarks } from "./harakat";

const { fatha, kasra, damma, shadda, sukun } = MARK;

describe("lettersOf", () => {
  it("attaches each mark to the letter before it", () => {
    expect(lettersOf(`ر${shadda}${fatha}ب`)).toEqual([
      { base: "ر", marks: `${shadda}${fatha}` },
      { base: "ب", marks: "" },
    ]);
  });

  it("counts the same letters with or without harakat", () => {
    expect(lettersOf(`الكَلامُ`).map((l) => l.base)).toEqual(lettersOf("الكلام").map((l) => l.base));
  });
});

describe("normalizeMarks", () => {
  it("puts shadda before the vowel", () => {
    expect(normalizeMarks(`${kasra}${shadda}`)).toBe(`${shadda}${kasra}`);
  });

  it.each([
    ["nothing", ""],
    ["a letter", "ب"],
    ["two vowels", `${fatha}${kasra}`],
    ["two shaddas", `${shadda}${shadda}`],
  ])("refuses %s", (_label, marks) => {
    expect(() => normalizeMarks(marks)).toThrow();
  });
});

describe("mergeMarks", () => {
  it("replaces the vowel with a new one", () => {
    expect(mergeMarks({ existing: fatha, typed: kasra })).toBe(kasra);
  });

  it("keeps a shadda when a vowel is typed", () => {
    expect(mergeMarks({ existing: `${shadda}${fatha}`, typed: damma })).toBe(`${shadda}${damma}`);
  });

  it("toggles shadda and keeps the vowel", () => {
    expect(mergeMarks({ existing: fatha, typed: shadda })).toBe(`${shadda}${fatha}`);
    expect(mergeMarks({ existing: `${shadda}${fatha}`, typed: shadda })).toBe(fatha);
  });

  it("removes a vowel typed again", () => {
    expect(mergeMarks({ existing: `${shadda}${sukun}`, typed: sukun })).toBe(shadda);
  });
});

describe("displayMarks", () => {
  it("replaces the corpus vowel with mine and keeps the corpus shadda", () => {
    expect(displayMarks({ corpus: `${shadda}${fatha}`, mine: kasra })).toEqual({ corpus: shadda, mine: kasra });
  });

  it("replaces the corpus shadda with mine and keeps the corpus vowel", () => {
    expect(displayMarks({ corpus: `${shadda}${fatha}`, mine: shadda })).toEqual({ corpus: fatha, mine: shadda });
  });

  it("leaves corpus marks alone when I have none", () => {
    expect(displayMarks({ corpus: damma, mine: "" })).toEqual({ corpus: damma, mine: "" });
  });
});

describe("markFromKey", () => {
  it("takes the character the Arabic layout types", () => {
    expect(markFromKey({ key: fatha, code: "KeyQ", shiftKey: true })).toBe(fatha);
  });

  it("maps shifted physical keys when the layout isn't Arabic", () => {
    expect(markFromKey({ key: "A", code: "KeyA", shiftKey: true })).toBe(kasra);
    expect(markFromKey({ key: "~", code: "Backquote", shiftKey: true })).toBe(shadda);
  });

  it("ignores unshifted letters and other keys", () => {
    expect(markFromKey({ key: "a", code: "KeyA", shiftKey: false })).toBeNull();
    expect(markFromKey({ key: "Z", code: "KeyZ", shiftKey: true })).toBeNull();
  });
});

describe("inContext", () => {
  const ZWJ = String.fromCodePoint(0x200d);
  // ا ل د ل ا ل ة
  const letters = lettersOf("الدلالة");
  const at = (index: number) => inContext({ letters, index });

  it("joins a letter to the neighbours it connects to", () => {
    expect(at(1)).toEqual({ before: "", after: ZWJ });
    // ي ك و ن: the kaf joins both ways.
    expect(inContext({ letters: lettersOf("يكون"), index: 1 })).toEqual({ before: ZWJ, after: ZWJ });
  });

  it("doesn't join after a letter that only connects backwards", () => {
    expect(at(2)).toEqual({ before: ZWJ, after: "" });
    expect(at(3)).toEqual({ before: "", after: ZWJ });
  });

  it("doesn't join past the ends of the word", () => {
    expect(at(0)).toEqual({ before: "", after: "" });
    expect(at(6)).toEqual({ before: ZWJ, after: "" });
  });
});
