import { describe, expect, it } from "vitest";
import { parsePage } from "./page";

const REAL_PAGE = `الصوم: المبادئ ٢٠١ الشروط والأنواع

---

[٤- شروط وجوب الأداء]
ويشترط لوجوب أدائه(١): <ruby>الصحة<rt>فلا يجب على مريض وحائض ونفساء. (عز)</rt></ruby> من مرض* وحيض ونفاس، <ruby>والإقامة<rt>فلا يجب على مسافر</rt></ruby>.

## فصل
[في صفة الصوم وتقسيمه. (م)]

---

### الحاشية
(١) قوله: أدائه: <ruby>[وهو<rt>[ث]</rt></ruby> عبارة عن تفريغ الذمة في وقته. (مراقي الفلاح)] (٢) قوله: النية: أراد بـ«النية» النية في وقتها.
(٣) قوله: سقوط الواجب إلخ: هو مقيد.`;

describe("parsePage", () => {
  it("treats the single line before the first divider as the running header", () => {
    const page = parsePage(REAL_PAGE);
    expect(page.header).toBe("الصوم: المبادئ ٢٠١ الشروط والأنواع");
    expect(page.matn.map((b) => b.text)).not.toContain(page.header);
  });

  it("has no header when the page has no divider", () => {
    const page = parsePage("الكلامُ: هو اللفظُ المركَّبُ.\nوأقسامُه ثلاثةٌ.");
    expect(page.header).toBeNull();
    expect(page.matn.map((b) => b.text)).toEqual([
      "الكلامُ: هو اللفظُ المركَّبُ.",
      "وأقسامُه ثلاثةٌ.",
    ]);
  });

  it("does not take a multi-line opening block as the header", () => {
    const page = parsePage("سطر أول\nسطر ثان\n\n---\n\n### الحاشية\n(١) حاشية.");
    expect(page.header).toBeNull();
    expect(page.matn.map((b) => b.text)).toEqual(["سطر أول", "سطر ثان"]);
    expect(page.hashiya.map((f) => f.text)).toEqual(["حاشية."]);
  });

  it("keeps the ruby base and drops the interlinear gloss in the matn", () => {
    const text = parsePage(REAL_PAGE).matn.map((b) => b.text).join("\n");
    expect(text).toContain("الصحة من مرض");
    expect(text).toContain("والإقامة.");
    expect(text).not.toContain("فلا يجب على مريض");
    expect(text).not.toContain("فلا يجب على مسافر");
    expect(text).not.toMatch(/<\/?(ruby|rt)>/);
  });

  it("drops interlinear glosses inside the hashiya too", () => {
    const first = parsePage(REAL_PAGE).hashiya[0];
    expect(first?.text).toContain("[وهو عبارة عن تفريغ الذمة");
    expect(first?.text).not.toContain("[ث]");
  });

  it("turns markdown headings into heading blocks, but not the hashiya title", () => {
    const page = parsePage(REAL_PAGE);
    const headings = page.matn.filter((b) => b.kind === "heading");
    expect(headings).toEqual([expect.objectContaining({ level: 2, text: "فصل" })]);
    expect(page.matn.map((b) => b.text).join("\n")).not.toContain("الحاشية");
  });

  it("splits the hashiya into entries at each marker, even on one line", () => {
    const page = parsePage(REAL_PAGE);
    expect(page.hashiya.map((f) => f.marker)).toEqual(["١", "٢", "٣"]);
    expect(page.hashiya[1]?.text).toBe("قوله: النية: أراد بـ«النية» النية في وقتها.");
    expect(page.hashiya[2]?.text).toBe("قوله: سقوط الواجب إلخ: هو مقيد.");
  });

  it("keeps hashiya text that comes before any marker as an unmarked entry", () => {
    const page = parsePage("متن.\n\n---\n\n### الحاشية\n$^*$ قوله في الحاشية: شرح. (١) تعليق.");
    expect(page.hashiya).toEqual([
      { marker: null, text: "* قوله في الحاشية: شرح." },
      { marker: "١", text: "تعليق." },
    ]);
  });

  it("numbers matn lines from 1 in reading order, headings included", () => {
    const page = parsePage(REAL_PAGE);
    expect(page.matn.map((b) => b.line)).toEqual([1, 2, 3, 4]);
    expect(page.matn[2]).toMatchObject({ kind: "heading", line: 3 });
  });

  it("returns an empty hashiya when the page has a header but no footnotes", () => {
    const page = parsePage("الباب الأول ٣\n\n---\n\nالكلامُ هو اللفظ.");
    expect(page.header).toBe("الباب الأول ٣");
    expect(page.matn).toHaveLength(1);
    expect(page.hashiya).toEqual([]);
  });

  it("returns an empty page for empty input", () => {
    expect(parsePage("")).toEqual({ header: null, matn: [], hashiya: [] });
    expect(parsePage("  \n\n ")).toEqual({ header: null, matn: [], hashiya: [] });
  });

  it("turns <br> into a newline inside a line", () => {
    const page = parsePage("سطر<br>تكملة<br/>ثالث");
    expect(page.matn[0]?.text).toBe("سطر\nتكملة\nثالث");
  });

  it("renders superscript markers like $^*$ as plain text", () => {
    expect(parsePage("كلمة$^*$ أخرى").matn[0]?.text).toBe("كلمة* أخرى");
  });
});
