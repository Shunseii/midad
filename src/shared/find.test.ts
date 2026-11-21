import { describe, expect, it } from "vitest";
import { quoteSpan } from "./annotations";
import { type FindOptions, findOnPage } from "./find";
import { parsePage } from "./page";

const page = parsePage(
  [
    "h",
    "",
    "---",
    "الْكَلَامُ هُوَ اللَّفْظُ الْمُرَكَّبُ الْمُفِيدُ بِالْوَضْعِ",
    "وأقسامه ثلاثة: اسم، وفعل، وحرف جاء لمعنى",
    "والكتاب في الصلاة كتاب(١)",
    "---",
    "### الحاشية",
    "(١) أي الكتاب المذكور في الصلوة",
  ].join("\n"),
);

const loose: FindOptions = { matchHarakat: false, wholeWord: false };
const found = (query: string, options: FindOptions = loose) => findOnPage({ page, query, options }).map((span) => `${span.part}:${quoteSpan({ page, span })}`);

describe("findOnPage", () => {
  it("ignores harakat in the text and the query", () => {
    expect(found("الكلام")).toEqual(["matn:الْكَلَامُ"]);
    expect(found("اللَّفظ")).toEqual(["matn:اللَّفْظُ"]);
  });

  it("finds a word inside a longer one, so a word with a clitic matches", () => {
    expect(found("كتاب")).toEqual(["matn:والكتاب", "matn:كتاب(١)", "hashiya:الكتاب"]);
  });

  it("folds ta marbuta, alef and hamza spellings", () => {
    expect(found("الصلاه")).toEqual(["matn:الصلاة"]);
    expect(found("اقسامه")).toEqual(["matn:وأقسامه"]);
  });

  it("ignores punctuation between words", () => {
    expect(found("اسم وفعل")).toEqual(["matn:اسم، وفعل،"]);
    expect(found("ثلاثة اسم")).toEqual(["matn:ثلاثة: اسم،"]);
  });

  it("matches across a line break", () => {
    expect(found("بالوضع وأقسامه")).toEqual(["matn:بِالْوَضْعِ وأقسامه"]);
  });

  it("searches the ḥāshiya too", () => {
    expect(found("المذكور")).toEqual(["hashiya:المذكور"]);
  });

  it("with whole words, allows leading clitics but not other letters around the match", () => {
    const whole = { matchHarakat: false, wholeWord: true };
    expect(found("كتاب", whole)).toEqual(["matn:والكتاب", "matn:كتاب(١)", "hashiya:الكتاب"]);
    expect(found("كتا", whole)).toEqual([]);
    expect(found("سم", whole)).toEqual([]);
  });

  it("with harakat matching, matches only the same vowels", () => {
    const vowels = { matchHarakat: true, wholeWord: false };
    expect(found("الْكَلَامُ", vowels)).toEqual(["matn:الْكَلَامُ"]);
    expect(found("الْكَلَامَ", vowels)).toEqual([]);
  });

  it("finds nothing for an empty or punctuation-only query", () => {
    expect(found("  ")).toEqual([]);
    expect(found("،")).toEqual([]);
  });
});
