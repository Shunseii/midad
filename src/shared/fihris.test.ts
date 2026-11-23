import { describe, expect, it } from "vitest";
import { bookIndex, type IndexPage, indexEntries } from "./fihris";

const body = (position: number, number: number | null = position): IndexPage => ({ position, number, header: null, headings: [], lines: ["نص الصفحة"] });

/** A book of `count` body pages numbered from 1, with `extra` pages appended. */
const book = ({ count, extra }: { count: number; extra: Omit<IndexPage, "position">[] }): IndexPage[] => [
  ...Array.from({ length: count }, (_, i) => body(i + 1)),
  ...extra.map((p, i) => ({ ...p, position: count + i + 1 })),
];

describe("indexEntries", () => {
  it("reads title, dot leader, page", () => {
    expect(indexEntries(["١- تفسير سورة الفاتحة ........................ ٢٧", "كلمة الناشر . . . . . . . . ٥"])).toEqual([
      { text: "١- تفسير سورة الفاتحة", number: 27 },
      { text: "كلمة الناشر", number: 5 },
    ]);
  });

  it("splits columns printed on one line, with or without a separator", () => {
    expect(indexEntries(["- كلمة الناشر ........ ٥ | ٢٧- تفسير سورة النمل ........ ٧٠٣"])).toEqual([
      { text: "كلمة الناشر", number: 5 },
      { text: "٢٧- تفسير سورة النمل", number: 703 },
    ]);
    expect(indexEntries(["(٢٠٢) بَابٌ فيما فوقَ ذلك ......... ١٧٦ (٢٣٨) باب أجناس العطش ......... ١٩٠"])).toEqual([
      { text: "(٢٠٢) بَابٌ فيما فوقَ ذلك", number: 176 },
      { text: "(٢٣٨) باب أجناس العطش", number: 190 },
    ]);
  });

  it("reads a title that ends in its page, and a leader that separates columns", () => {
    expect(indexEntries(["مقدمة ٧ ........................ (٢٥) بابُ اعْتِيَاصِ الْأَمْرِ ........................ ٦١"])).toEqual([
      { text: "مقدمة", number: 7 },
      { text: "(٢٥) بابُ اعْتِيَاصِ الْأَمْرِ", number: 61 },
    ]);
  });

  it("joins a title that wraps onto the next line of its own column", () => {
    expect(
      indexEntries([
        "- مقدمة فضيلة الشيخ : محمد بن صالح العثيمين رحمه | ٢٩- تفسير سورة العنكبوت ....... ٧٣٤",
        "الله تعالى ....... ٨ | ٣٠- تفسير سورة الرُّوم ....... ٧٤٧",
      ]),
    ).toEqual([
      { text: "٢٩- تفسير سورة العنكبوت", number: 734 },
      { text: "مقدمة فضيلة الشيخ : محمد بن صالح العثيمين رحمه الله تعالى", number: 8 },
      { text: "٣٠- تفسير سورة الرُّوم", number: 747 },
    ]);
  });

  it("takes the first of several pages, and Persian digits", () => {
    expect(indexEntries(["الحجّاج بن يوسف ......... ١١١، ١٢٦، ١٥٣", "كثر ........ ۱۷۲"])).toEqual([
      { text: "الحجّاج بن يوسف", number: 111 },
      { text: "كثر", number: 172 },
    ]);
  });

  it("ignores lines that aren't entries", () => {
    expect(indexEntries(["الآية رقمها رقم الصفحة", "---", ""])).toEqual([]);
  });
});

describe("bookIndex", () => {
  const topics = (lines: string[], header = "فهرس الموضوعات"): Omit<IndexPage, "position"> => ({ number: null, header, headings: [], lines });

  it("orders the index of topics by page and points each entry at its page", () => {
    const pages = book({
      count: 40,
      extra: [topics(["الباب الثاني ...... ٢٠ | الباب الأول ...... ٣", "الباب الثالث ...... ٣٥"])],
    });
    expect(bookIndex(pages)).toEqual([
      { text: "الباب الأول", number: 3, position: 3 },
      { text: "الباب الثاني", number: 20, position: 20 },
      { text: "الباب الثالث", number: 35, position: 35 },
    ]);
  });

  it("maps printed numbers onto positions when they differ, using the next numbered page for a gap", () => {
    const pages = [...Array.from({ length: 40 }, (_, i) => body(i + 1, i === 9 ? null : i + 3)), { ...topics(["باب أ ..... ٥", "باب ب ..... ١٢", "باب ج ..... ٣٠"]), position: 41 }];
    expect(bookIndex(pages)?.map((e) => e.position)).toEqual([3, 11, 28]);
  });

  it("uses the index of topics, not the indexes of verses, hadith or names", () => {
    const pages = book({
      count: 40,
      extra: [
        { number: null, header: "فهرس الآيات القرآنية", headings: ["فهرس الآيات القرآنية"], lines: ["إنما ذلكم الشيطان ...... ٤", "واخفض لهما ...... ٩", "قل هو الله أحد ...... ١٢"] },
        { number: null, header: "فِهْرِسُ الأَعْلَامِ", headings: [], lines: ["ابن الأعرابي ...... ٦٩", "داود بن علي ...... ٢", "النحاس ...... ٣"] },
        topics(["مقدمة ...... ١", "باب الصلاة ...... ١٠", "باب الزكاة ...... ٢٠"]),
      ],
    });
    expect(bookIndex(pages)?.map((e) => e.text)).toEqual(["مقدمة", "باب الصلاة", "باب الزكاة"]);
  });

  it("keeps reading an index across pages whose running header alternates with the book title", () => {
    const pages = book({
      count: 40,
      extra: [topics(["باب أ ..... ١", "باب ب ..... ٢"]), { number: null, header: "الألفاظ الكتابية", headings: [], lines: ["باب ج ..... ٣", "باب د ..... ٤"] }, topics(["باب هـ ..... ٥"], "٤٣٥ فِهْرِسُ المَوضُوعَاتِ")],
    });
    expect(bookIndex(pages)?.map((e) => e.text)).toEqual(["باب أ", "باب ب", "باب ج", "باب د", "باب هـ"]);
  });

  it("takes an unqualified الفهرس, and ends it at the first page without entries", () => {
    const pages = book({
      count: 40,
      extra: [topics(["باب أ ..... ١", "باب ب ..... ٢"], "الفهرس ١١٤٩"), topics(["باب ج ..... ٣"], "الفهرس ١١٥٠"), { number: null, header: null, headings: [], lines: ["رفع عبد الرحمن"] }, { number: null, header: null, headings: [], lines: ["باب د ..... ٤"] }],
    });
    expect(bookIndex(pages)?.map((e) => e.text)).toEqual(["باب أ", "باب ب", "باب ج"]);
  });

  it("finds an index printed at the front of the book", () => {
    const pages = [{ ...topics(["باب أ ..... ٥", "باب ب ..... ٢٠", "باب ج ..... ٣٠"]), position: 1 }, ...Array.from({ length: 40 }, (_, i) => body(i + 2, i + 2))];
    expect(bookIndex(pages)?.map((e) => e.position)).toEqual([5, 20, 30]);
  });

  it("is null without a readable index", () => {
    expect(bookIndex(book({ count: 40, extra: [] }))).toBeNull();
    expect(bookIndex(book({ count: 40, extra: [topics(["باب أ ..... ١"])] }))).toBeNull();
    // A فهرس heading in the middle of the book isn't the book's index.
    const middle = book({ count: 40, extra: [] });
    middle[20] = { ...middle[20], position: 21, header: "فهرس الموضوعات", lines: ["باب أ ..... ١", "باب ب ..... ٢", "باب ج ..... ٣"] } as IndexPage;
    expect(bookIndex(middle)).toBeNull();
  });
});
