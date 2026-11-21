import type { PageSummary } from "../../../shared/library";
import type { Page } from "../../../shared/page";
import { arabicNumber } from "./format";

/** How many of a page's opening lines the bookmark preview shows. */
export const PREVIEW_LINES = 3;

/** The page as printed ("ص ١٢"), or its place among the scans when it has no printed number. */
export const bookmarkFolio = ({ position, pages }: { position: number; pages: PageSummary[] }) =>
  `ص ${arabicNumber(pages[position - 1]?.number ?? position)}`;

/** The first lines of a page's main text, for the bookmark preview. */
export const openingLines = ({ page, count = PREVIEW_LINES }: { page: Page; count?: number }): string[] =>
  page.matn
    .map((b) => b.text.trim())
    .filter(Boolean)
    .slice(0, count);
