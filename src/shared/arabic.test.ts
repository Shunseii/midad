import { describe, expect, it } from "vitest";
import { foldArabic, stripHarakat } from "./arabic";

describe("foldArabic", () => {
  it("drops harakat, shadda, sukun, tanwin and the dagger alef", () => {
    expect(foldArabic("الْكَلَامُ")).toBe("الكلام");
    expect(foldArabic("مُحَمَّدٌ")).toBe("محمد");
    expect(foldArabic("هٰذا")).toBe("هذا");
  });

  it("drops tatweel", () => {
    expect(foldArabic("الكـــلام")).toBe("الكلام");
  });

  it("folds the alef forms to a bare alef", () => {
    expect(foldArabic("أإآٱ")).toBe("اااا");
    // Hamza and maddah written as combining marks fold the same way.
    expect(foldArabic(`ا${String.fromCodePoint(0x0654)}`)).toBe("ا");
  });

  it("reads alef maqsura and the hamza seats as their letters", () => {
    expect(foldArabic("على")).toBe(foldArabic("علي"));
    expect(foldArabic("مسئلة")).toBe(foldArabic("مسيله"));
    expect(foldArabic("مؤمن")).toBe("مومن");
  });

  it("reads ta marbuta as ha unless asked not to", () => {
    expect(foldArabic("صلاة")).toBe("صلاه");
    expect(foldArabic("صلاة", { foldTaMarbuta: false })).toBe("صلاة");
  });

  it("drops punctuation, Arabic and Latin", () => {
    expect(foldArabic("«قال»، ثم؛ لماذا؟ (هنا).")).toBe("قال ثم لماذا هنا");
  });

  it("turns Arabic-Indic and Persian digits into ASCII", () => {
    expect(foldArabic("١٢٣ ۴۵۶ 789")).toBe("123 456 789");
  });

  it("keeps harakat when asked to", () => {
    expect(foldArabic("الْكَلَامُ", { keepHarakat: true })).toBe("الْكَلَامُ");
    expect(foldArabic("أَحْمَدُ", { keepHarakat: true })).toBe("اَحْمَدُ");
  });
});

describe("stripHarakat", () => {
  it("keeps everything but the vowel marks", () => {
    expect(stripHarakat("أَحْمَدُ، قالَ")).toBe("أحمد، قال");
  });
});
