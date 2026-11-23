/**
 * A book's own table of contents, read from its printed index of topics
 * (فهرس الموضوعات): each entry is a title, a dot leader and the printed page it
 * starts on. Books also carry indexes of verses, hadith, names and so on; only
 * the index of topics (or an unqualified فهرس) describes the book's structure.
 */

export interface IndexPage {
  position: number;
  /** The page number printed on the page. */
  number: number | null;
  /** The page's running header. */
  header: string | null;
  headings: string[];
  /** The page's main text, one line per line. */
  lines: string[];
}

export interface IndexEntry {
  text: string;
  /** The printed page the index gives. */
  number: number;
  /** The page in the book that printed number falls on. */
  position: number;
}

const DIGITS: Record<string, string> = Object.fromEntries(
  [..."٠١٢٣٤٥٦٧٨٩"].map((d, i) => [d, String(i)]).concat([..."۰۱۲۳۴۵۶۷۸۹"].map((d, i) => [d, String(i)])),
);
const toNumber = (digits: string) => Number([...digits].map((d) => DIGITS[d] ?? d).join(""));

/** Without harakat, tatweel or brackets, so فِهْرِسُ and [فهرس] read as فهرس. */
const plain = (text: string) => text.replace(/[ً-ٰٟـ]/g, "").replace(/[()[\]{}*•«»]/g, " ");

const INDEX_TITLE = /فهرس|فهارس|المحتويات/;
const TOPICS = /الموضوعات|المحتويات|المواضيع|المباحث/;
/** Indexes that list something other than the book's sections. */
const OTHER_INDEX = /الآيات|الايات|القرآن|السور|الأحاديث|الاحاديث|الآثار|الاثار|الأعلام|الاعلام|الأمثال|الامثال|القوافي|الأشعار|الاشعار|الأبيات|الألفاظ|الالفاظ|المراجع|المصادر|الأماكن|البلدان|الكتب|الفرق|الغريب|الفوائد|العامة|الفهارس/;

type IndexKind = "topics" | "plain" | "other";

/** The index a page belongs to by its headings and running header, or null when they name none. */
const indexTitle = (page: IndexPage): { kind: IndexKind; title: string } | null => {
  const titles = [...page.headings, page.header ?? ""]
    .map((t) => plain(t).replace(/[0-9٠-٩۰-۹]/g, "").replace(/\s+/g, " ").trim())
    .filter((t) => INDEX_TITLE.test(t));
  const title = titles[0];
  if (title === undefined) return null;
  const kind = titles.some((t) => TOPICS.test(t)) ? "topics" : titles.some((t) => OTHER_INDEX.test(t)) ? "other" : "plain";
  return { kind, title };
};

const NUMBER = "[0-9٠-٩۰-۹]+";
const LEADER = /\s*(?:[.…·_]\s*){3,}/;
/** A page, or several ("٤٥، ٧٨"); the first one counts. */
const PAGES = new RegExp(`^(${NUMBER})(?:\\s*[،,\\-–]\\s*${NUMBER})*$`);
/** A page that opens the next column's title: "١٧٦ (٢٣٨) باب …". */
const LEADING_PAGE = new RegExp(`^(${NUMBER})\\s+([^\\s\\-–].*)$`);
/** A title that ends in its page, with no leader between. */
const TRAILING_PAGE = new RegExp(`^(.*[^\\s0-9٠-٩۰-۹،,:\\-–(\\[])\\s+(${NUMBER})$`);

const cleanTitle = (text: string) =>
  text
    .replace(/^[\s\-–•*|]+/, "")
    .replace(/\s+/g, " ")
    .trim();

/**
 * The entries on one index page, in the order printed. A line is cut at its dot leaders: a title
 * followed by a page is an entry, and so is a title that ends in its page. Columns printed side by
 * side come out on one line, split by " | " or not at all; a title that wraps carries over to the
 * next line of its column.
 */
export const indexEntries = (lines: string[]): { text: string; number: number }[] => {
  const entries: { text: string; number: number }[] = [];
  const add = (title: string, page: string) => {
    const text = cleanTitle(title);
    const number = toNumber(page);
    if (text.length > 1 && number > 0) entries.push({ text, number });
  };
  const carried = new Map<number, string>();
  for (const line of lines) {
    if (/^#{1,6}\s/.test(line) || line.trim() === "---") continue;
    line.split("|").forEach((segment, column) => {
      const chunks = segment.split(LEADER).map((c) => c.trim());
      const carry = carried.get(column);
      carried.delete(column);
      if (carry) chunks[0] = `${carry} ${chunks[0] ?? ""}`.trim();
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i] ?? "";
        if (!chunk || PAGES.test(chunk)) continue;
        const page = PAGES.exec(chunks[i + 1] ?? "");
        if (page) {
          add(chunk, page[1] ?? "");
          i += 1;
          continue;
        }
        const leading = LEADING_PAGE.exec(chunks[i + 1] ?? "");
        if (leading) {
          add(chunk, leading[1] ?? "");
          chunks[i + 1] = leading[2] ?? "";
          continue;
        }
        const trailing = TRAILING_PAGE.exec(chunk);
        if (trailing) add(trailing[1] ?? "", trailing[2] ?? "");
        else if (i === chunks.length - 1) carried.set(column, chunk);
      }
    });
  }
  return entries;
};

/** Indexes sit near the front or the back of a book. */
const nearAnEnd = ({ index, count }: { index: number; count: number }) => index < Math.max(20, count * 0.15) || index >= count * 0.7;

const MIN_ENTRIES = 3;

/**
 * The book's contents from its index of topics, ordered as the pages run, or null when the book
 * has no index that can be read. Each entry points at the page its printed number falls on.
 */
export const bookIndex = (pages: IndexPage[]): IndexEntry[] | null => {
  const sections: { kind: IndexKind; title: string; entries: { text: string; number: number }[] }[] = [];
  let current: (typeof sections)[number] | null = null;
  for (const [index, page] of pages.entries()) {
    const named = nearAnEnd({ index, count: pages.length }) ? indexTitle(page) : null;
    // Each page of an index may repeat its title; a different title starts the next index.
    if (named && named.title !== current?.title) {
      current = { ...named, entries: [] };
      sections.push(current);
    }
    if (!current) continue;
    const found = indexEntries(page.lines);
    // An index ends at the first page after its start with nothing in it.
    if (found.length === 0 && !named) {
      current = null;
      continue;
    }
    current.entries.push(...found);
  }

  const usable = sections.filter((s) => s.entries.length >= MIN_ENTRIES);
  const chosen = usable.find((s) => s.kind === "topics") ?? usable.find((s) => s.kind === "plain");
  if (!chosen) return null;

  const numbered = pages.filter((p): p is IndexPage & { number: number } => p.number !== null);
  const positionOf = (number: number) => (numbered.find((p) => p.number === number) ?? numbered.find((p) => p.number > number))?.position ?? null;
  const entries = chosen.entries.flatMap((e) => {
    const position = positionOf(e.number);
    return position === null ? [] : [{ text: e.text, number: e.number, position }];
  });
  if (entries.length < MIN_ENTRIES) return null;
  return entries.map((e, i) => ({ ...e, i })).sort((a, b) => a.position - b.position || a.i - b.i).map(({ i: _, ...e }) => e);
};
