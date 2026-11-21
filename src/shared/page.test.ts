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

  it("keeps the ruby base in the matn and attaches the gloss to its words", () => {
    const page = parsePage(REAL_PAGE);
    const text = page.matn.map((b) => b.text).join("\n");
    expect(text).toContain("الصحة من مرض");
    expect(text).toContain("والإقامة.");
    expect(text).not.toContain("فلا يجب على مريض");
    expect(text).not.toMatch(/<\/?(ruby|rt)>/);
    expect(page.glosses.filter((g) => g.part === "matn")).toEqual([
      { part: "matn", line: 2, from: 4, to: 4, text: "فلا يجب على مريض وحائض ونفساء. (عز)" },
      { part: "matn", line: 2, from: 9, to: 9, text: "فلا يجب على مسافر" },
    ]);
  });

  it("attaches glosses inside the hashiya to the footnote's words", () => {
    const page = parsePage(REAL_PAGE);
    expect(page.hashiya[0]?.text).toContain("[وهو عبارة عن تفريغ الذمة");
    expect(page.hashiya[0]?.text).not.toContain("[ث]");
    expect(page.glosses.filter((g) => g.part === "hashiya")).toEqual([{ part: "hashiya", line: 1, from: 3, to: 3, text: "[ث]" }]);
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
    expect(parsePage("")).toEqual({ header: null, matn: [], hashiya: [], glosses: [] });
    expect(parsePage("  \n\n ")).toEqual({ header: null, matn: [], hashiya: [], glosses: [] });
  });

  it("turns <br> into a newline inside a line", () => {
    const page = parsePage("سطر<br>تكملة<br/>ثالث");
    expect(page.matn[0]?.text).toBe("سطر\nتكملة\nثالث");
  });

  it("renders superscript markers like $^*$ as plain text", () => {
    expect(parsePage("كلمة$^*$ أخرى").matn[0]?.text).toBe("كلمة* أخرى");
  });
});

describe("parsePage glosses", () => {
  const one = (line: string) => {
    const page = parsePage(line);
    return { text: page.matn[0]?.text, glosses: page.glosses.map(({ from, to, text }) => ({ from, to, text })) };
  };

  it("covers every word of a multi-word base with a long gloss", () => {
    expect(one("[١٣] <ruby>ما زال بصفاته قديما قبل<rt>[وفي «نور»: لم يزدد]</rt></ruby> خلقه")).toEqual({
      text: "[١٣] ما زال بصفاته قديما قبل خلقه",
      glosses: [{ from: 2, to: 6, text: "[وفي «نور»: لم يزدد]" }],
    });
  });

  it("keeps a footnote-style number as the base", () => {
    expect(one("افتتح <ruby>(١)<rt>المراد به: إما الوقاية</rt></ruby> كتابه")).toEqual({
      text: "افتتح (١) كتابه",
      glosses: [{ from: 2, to: 2, text: "المراد به: إما الوقاية" }],
    });
  });

  it("leaves a footnote reference after the base alone", () => {
    expect(one("<ruby>فيكون<rt>متعلق بالدخول، أو بقوله: «فيكون»</rt></ruby> (١)")).toEqual({
      text: "فيكون (١)",
      glosses: [{ from: 1, to: 1, text: "متعلق بالدخول، أو بقوله: «فيكون»" }],
    });
  });

  it("puts a gloss whose base is blank on the word before it, or after it at the start", () => {
    expect(one("أي الكعب <ruby> <rt>وهو الأرجل</rt></ruby> هنا")).toEqual({ text: "أي الكعب   هنا", glosses: [{ from: 2, to: 2, text: "وهو الأرجل" }] });
    expect(one("<ruby> <rt>وهو الأرجل</rt></ruby> هنا")).toEqual({ text: "هنا", glosses: [{ from: 1, to: 1, text: "وهو الأرجل" }] });
  });

  it("anchors a gloss that lost its <ruby> on the word before it", () => {
    expect(one("ولا يجوز بيعُ الجيِّد بالرديء<rt>[أي مما توجد فيه العلتان]</rt></ruby> مما فيه الربا")).toEqual({
      text: "ولا يجوز بيعُ الجيِّد بالرديء مما فيه الربا",
      glosses: [{ from: 5, to: 5, text: "[أي مما توجد فيه العلتان]" }],
    });
  });

  it("keeps the base as plain text when the gloss is empty or self-closed", () => {
    expect(one("<ruby>[أَيْ]<rt> </rt></ruby> قال")).toEqual({ text: "[أَيْ] قال", glosses: [] });
    expect(one("<ruby>[٢٠- بطلان النكاح]<rt></rt></ruby>")).toEqual({ text: "[٢٠- بطلان النكاح]", glosses: [] });
    expect(one("<ruby>تفريغ<rt/></ruby> على")).toEqual({ text: "تفريغ على", glosses: [] });
    expect(one("<ruby>تفريغ<rt /> على")).toEqual({ text: "تفريغ على", glosses: [] });
  });

  it("falls back to plain text for a ruby without a gloss, or one closed by </rt>", () => {
    expect(one("<ruby>لأن الرهن في ضمانه. (ع)</ruby> قال")).toEqual({ text: "لأن الرهن في ضمانه. (ع) قال", glosses: [] });
    expect(one("<ruby>تفريغ على الدليلين المذكورين لإبطال مذهبه</rt>")).toEqual({ text: "تفريغ على الدليلين المذكورين لإبطال مذهبه", glosses: [] });
  });

  it("drops an unclosed ruby before a nested one and keeps the inner gloss", () => {
    expect(one("<ruby>تفريغ على <ruby>نفي<rt>من افتراض الأدنى</rt></ruby> قال")).toEqual({
      text: "تفريغ على نفي قال",
      glosses: [{ from: 3, to: 3, text: "من افتراض الأدنى" }],
    });
  });

  it("runs a gloss left open to the end of its line, and cut-off tags never show", () => {
    expect(one("افتتح <ruby>(١)<rt>المراد به: الوقاية</rt")).toEqual({ text: "افتتح (١)", glosses: [{ from: 2, to: 2, text: "المراد به: الوقاية" }] });
    expect(one("افتتح <ruby>(١)<rt>المراد به")).toEqual({ text: "افتتح (١)", glosses: [{ from: 2, to: 2, text: "المراد به" }] });
  });

  it("does not let a ruby run across lines", () => {
    const page = parsePage("<ruby>أول<rt>شرح\nثان</rt></ruby> بعده");
    expect(page.matn.map((b) => b.text)).toEqual(["أول", "ثان بعده"]);
    expect(page.glosses).toEqual([{ part: "matn", line: 1, from: 1, to: 1, text: "شرح" }]);
  });

  it("keeps a line break inside a gloss and unwraps other tags", () => {
    expect(one("<ruby>مميزا<rt>[لا متصلاً]<br>احتراز عن المتصل. (ز)</rt></ruby>")).toEqual({
      text: "مميزا",
      glosses: [{ from: 1, to: 1, text: "[لا متصلاً]\nاحتراز عن المتصل. (ز)" }],
    });
    expect(one("<ruby><sup>(٥)</sup><rt>[الظهار]</rt></ruby> قال")).toEqual({ text: "(٥) قال", glosses: [{ from: 1, to: 1, text: "[الظهار]" }] });
    expect(one("كتاب الخلع <sup>(١)</sup> <b>بعده</b>")).toEqual({ text: "كتاب الخلع (١) بعده", glosses: [] });
  });

  it("attaches a gloss in a heading and leaves none in the running header", () => {
    const page = parsePage("<ruby>الباب<rt>أي الأول</rt></ruby> ٣\n\n---\n\n## <ruby>فصل<rt>في الصوم</rt></ruby> آخر");
    expect(page.header).toBe("الباب ٣");
    expect(page.matn[0]).toMatchObject({ kind: "heading", text: "فصل آخر" });
    expect(page.glosses).toEqual([{ part: "matn", line: 1, from: 1, to: 1, text: "في الصوم" }]);
  });

  it("degrades garbled markup to plain text without any tags", () => {
    const page = parsePage("<rt>قال</ruby> <ruby><ruby>كلمة</rt><rt/></rt> <span class=x>نص</span> </ruby");
    const text = page.matn.map((b) => b.text).join("\n");
    expect(text).not.toMatch(/[<>]|\brt\b|ruby/);
    expect(text.replace(/\s+/g, " ")).toBe("كلمة نص");
  });
});

describe("parsePage glosses on a line of their own", () => {
  it("keeps the empty line and puts the gloss on the last word of the line before", () => {
    const page = parsePage("وذلك لأنه تعالى اختار\n<ruby> <rt>أي كون المراد هو العظم</rt></ruby>\nلفظ الجمع");
    expect(page.matn.map((b) => b.text)).toEqual(["وذلك لأنه تعالى اختار", "", "لفظ الجمع"]);
    expect(page.glosses).toEqual([{ part: "matn", line: 1, from: 4, to: 4, text: "أي كون المراد هو العظم" }]);
  });

  it("puts it on the first word of the next line when nothing comes before", () => {
    const page = parsePage("<ruby><rt>ذلك القول</rt></ruby>\nقال المصنف");
    expect(page.glosses).toEqual([{ part: "matn", line: 2, from: 1, to: 1, text: "ذلك القول" }]);
  });
});
