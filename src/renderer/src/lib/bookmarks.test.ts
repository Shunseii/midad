import { describe, expect, it } from "vitest";
import type { PageSummary } from "../../../shared/library";
import type { Page } from "../../../shared/page";
import { bookmarkFolio, openingLines } from "./bookmarks";

const summary = (position: number, number: number | null): PageSummary => ({ position, number, fileId: `f${position}`, header: null, headings: [] });

describe("bookmarkFolio", () => {
  it("names the page by its printed number", () => {
    expect(bookmarkFolio({ position: 2, pages: [summary(1, 11), summary(2, 12)] })).toBe("ص ١٢");
  });

  it("falls back to the page's place in the book when it has no printed number", () => {
    expect(bookmarkFolio({ position: 1, pages: [summary(1, null)] })).toBe("ص ١");
  });
});

describe("openingLines", () => {
  const page = (matn: Page["matn"]): Page => ({ header: null, matn, hashiya: [], glosses: [] });

  it("takes the first three lines of the main text, headings included, skipping blank ones", () => {
    const lines = openingLines({
      page: page([
        { kind: "heading", level: 2, text: "بابُ الفاعلِ", line: 1 },
        { kind: "paragraph", text: "  ", line: 2 },
        { kind: "paragraph", text: "الفاعلُ هو الاسمُ المرفوعُ", line: 3 },
        { kind: "paragraph", text: "وهو على قسمين", line: 4 },
        { kind: "paragraph", text: "ظاهرٌ ومضمرٌ", line: 5 },
      ]),
    });
    expect(lines).toEqual(["بابُ الفاعلِ", "الفاعلُ هو الاسمُ المرفوعُ", "وهو على قسمين"]);
  });

  it("is empty for a page without main text", () => {
    expect(openingLines({ page: page([]) })).toEqual([]);
  });
});
