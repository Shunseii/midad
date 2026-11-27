import { DevicesIndicator } from "../components/devices";
import { UpdateNotice } from "../components/updates";
import { ArrowLeft, Bookmark, ChevronLeft, ChevronRight, FileImage, NotebookPen, PanelLeftClose, PanelLeftOpen, Search, Sparkles, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { flushSync } from "react-dom";
import { type CSSProperties, type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { type Highlight, type LetterRef, lineText, type Note, type NoteTarget, type Part, quoteSpan, type Span, spanContains, spansOverlap, wordsOf } from "../../../shared/annotations";
import { isArabicLetter, lettersOf, markFromKey, mergeMarks } from "../../../shared/harakat";
import type { BookDetail, Bookmark as SavedBookmark, ScrollAnchor, StoredPage } from "../../../shared/library";
import { DisplayMenu, stepScale, WHEEL_STEP, ZOOM_SHOWN_MS, ZoomLevel } from "../components/display-menu";
import { InlinePanel, SideSheet } from "../components/side-sheet";
import { SidePanel, SidePanelBody } from "../components/side-panel";
import { useMediaQuery } from "../lib/media";
import { NoteEditor, NoteLayer, NotePeek, NoteRowPeek, SelectionToolbar } from "../components/annotation-popovers";
import { AnnotationsPanel, type NoteDraft, type PanelTab, spanLabel } from "../components/annotations-panel";
import { type AskSelection, AskHeader, AskPanel, useAskConversation } from "../components/ask-panel";
import { PageScrubber } from "../components/page-scrubber";
import { CLOSED_FIND, FindBar, type FindState, revealMatch, useFindHighlights } from "../components/find-bar";
import { findOnPage } from "../../../shared/find";
import { citeSpans } from "../../../shared/ask";
import { ScanPane, ScanSlot } from "../components/scan-pane";
import { caretNear, letterAtSelectionStart, type NoteMarkTarget, PageView, rectWithGlosses, rowOfWord, screenRows, selectionCoversWord, selectSpan, spanFromSelection, type WordTarget } from "../components/page-view";
import { IconButton, Segmented, Skeleton, Toast, ToastAction, cx } from "../components/ui";
import { rememberCopy } from "../lib/copied";
import { tintWords } from "../lib/reveal";
import { entryIndexFor, visibleEntries } from "../lib/contents";
import { arabicNumber } from "../lib/format";
import { type BookmarkState, createUndoStack, type MarkerAt, type UndoStack } from "../lib/undo";
import { midad, keys, useAnnotationActions, useAnnotations, useBook, useBookmarks, useBookMarks, useMarker, usePage, useSetBookmark, useSetMarker, useWaitingBooks } from "../lib/midad";
import { BookmarkList, BookmarkRibbon } from "../components/bookmarks";
import { COVER_TRANSITION_MS, markClosingBook } from "../components/book-cover";
import { bookmarkFolio } from "../lib/bookmarks";
import { usePref } from "../lib/prefs";
import { useFocusMode, useGlossMode, useHighlightStyle, useNoteIcons, usePageWidth } from "../lib/appearance";
import { pageBalance } from "../lib/focus";
import { useChromeHover } from "../lib/use-chrome-hover";
import { useFocusChrome, useSteadyWhileHidden } from "../lib/use-focus-chrome";
import { switchListInTransition } from "../lib/view-transition";
import { useKeybindings } from "../lib/use-keybindings";
import { shortcutKeys, shortcutLabel, withShortcut } from "../lib/keymap";
import { neighbourPages } from "../lib/neighbours";
import { continuesBurst, firstFullyVisible, nearestWord, restoredScrollTop, wordSelector } from "../lib/zoom-anchor";
import { arrival, pageMemory, type PagePlace, type PageRef } from "../lib/page-memory";

interface TocEntry {
  /** The page number printed in the book, when the page has one. */
  number: number | null;
  text: string;
  level: number;
  position: number;
}

/** Deeper headings are left out until the contents can fold them under their chapter. */
const TOP_LEVEL = 2;

/**
 * The book's own index of topics when it has one Midad can read; otherwise its top-level headings,
 * then its running headers for books without headings.
 */
const tableOfContents = (book: BookDetail): TocEntry[] => {
  if (book.index) return book.index.map((e) => ({ text: e.text, level: TOP_LEVEL, position: e.position, number: e.number }));
  const headings = book.pages.flatMap((p) =>
    p.headings.filter((h) => h.level <= TOP_LEVEL).map((h) => ({ text: h.text, level: h.level, position: p.position, number: p.number })),
  );
  if (headings.length > 0) return headings;
  return book.pages
    .filter((p, i) => p.header && p.header !== book.pages[i - 1]?.header)
    .map((p) => ({ text: p.header ?? "", level: 2, position: p.position, number: p.number }));
};

const CONTENTS_WIDTH = 264;
/** Room for the Contents | Bookmarks tabs and the close button. */
const CONTENTS_MIN = 256;
const CONTENTS_MAX = 420;
const PANEL_WIDTH = 400;
/** Room for the side panel's tabs or Ask AI's buttons, and the close button. */
const PANEL_MIN = 320;
/** Ask AI opens wider than highlights and notes, until the reader sizes it themselves. */
const ASK_WIDTH = 560;
const ASK_EXTRA = 120;

type Toolbar =
  | { mode: "selection"; span: Span; rect: DOMRect; text: string }
  | { mode: "highlight"; highlight: Highlight; rect: DOMRect };

interface NoteState {
  note: Note | null;
  span: Span;
  rect: DOMRect;
  /** Hovering shows a read-only peek; clicking it (or adding a note) edits. A row lists every note ending on one row. */
  mode: "peek" | "edit" | "row";
  /** In row mode, the notes on the row. */
  row?: Note[];
}

interface Point {
  x: number;
  y: number;
}

/** What a link into the reader can ask for: where to scroll the page once it has loaded, by offset or by a word. */
/** `launched`: Midad reopened straight into the book, so the layout comes back exactly as it was left. */
export type ReaderState = ({ scrollTop: number } | { anchor: ScrollAnchor } | { scrollTop?: never; anchor?: never }) & { launched?: boolean };

/** How long scrolling has to settle before the place on the page is saved. */
const SAVE_PLACE_MS = 400;

/** A word held in place while the text size changes, and how far below the top of the page's view it was. */
interface ZoomAnchor {
  selector: string;
  offset: number;
  at: number;
}

const sameLines = (a: number[], b: number[]) => a.length === b.length && a.every((line, i) => line === b[i]);

/** Longer than the column's width transition, in case its transitionend never comes. */
const WIDTH_FOLLOW_MAX_MS = 600;

/** The first whole word at the top of the page's view, and how far below the view's top it sits. */
const topWordAnchor = (root: HTMLElement): ScrollAnchor | null => {
  const view = root.getBoundingClientRect();
  const words = [...root.querySelectorAll<HTMLElement>("[data-w]")];
  const word = words[firstFullyVisible({ words: words.map((w) => w.getBoundingClientRect()), view })];
  const { part, line, w } = word?.dataset ?? {};
  if (!word || (part !== "matn" && part !== "hashiya")) return null;
  return { part, line: Number(line), word: Number(w), offset: word.getBoundingClientRect().top - view.top };
};

const focusInNoteEditor =() => document.activeElement?.closest('[role="dialog"][aria-label="Note"]') != null;

/** Scrolls to the first of some spans and tints the words of all of them for a moment. */
const revealSpans = ({ root, spans }: { root: HTMLElement | null; spans: Span[] }) => {
  if (!root) return;
  const words = [...root.querySelectorAll<HTMLElement>("[data-part][data-w]")].filter((el) => {
    const line = Number(el.dataset.line);
    const word = Number(el.dataset.w);
    return spans.some((span) => {
      if (el.dataset.part !== span.part) return false;
      const afterStart = line > span.start.line || (line === span.start.line && word >= span.start.word);
      const beforeEnd = line < span.end.line || (line === span.end.line && word <= span.end.word);
      return afterStart && beforeEnd;
    });
  });
  words[0]?.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  tintWords(words);
};

interface LineRange {
  part: Part;
  from: number;
  to: number;
}

/** An Ask AI citation or pasted quote: whole lines, or with `phrase` or `words`, part of them. */
type Citation = LineRange & { words: { from: number; to: number } | null; phrase: string | null };

const revealCitation = ({ root, cite, page }: { root: HTMLElement | null; cite: Citation; page: StoredPage["page"] | undefined }) => {
  const spans = page ? citeSpans({ cite, page }) : [];
  if (spans.length) revealSpans({ root, spans });
  else if (!cite.phrase && !cite.words) revealLines({ root, ...cite });
};

/** Scrolls to some lines and tints their words for a moment, the same band a cited phrase gets. */
const revealLines = ({ root, part, from, to }: LineRange & { root: HTMLElement | null }) => {
  const words = [...(root?.querySelectorAll<HTMLElement>(`[data-part="${part}"][data-w]`) ?? [])].filter((el) => {
    const line = Number(el.dataset.line);
    return line >= from && line <= to;
  });
  words[0]?.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  tintWords(words);
};

/** Scrolls to the screen row a word is on and tints that row for a moment. */
const revealRow = ({ root, part, line, word }: { root: HTMLElement | null; part: Part; line: number; word: number }) => {
  const block = root?.querySelector<HTMLElement>(`[data-line-block="${part}-${line}"]`);
  if (!block) return;
  const rows = screenRows(block);
  const row = rowOfWord(rows, word);
  const next = row && rows[rows.indexOf(row) + 1];
  const onRow = [...block.querySelectorAll<HTMLElement>("[data-w]")].filter((el) => {
    const w = Number(el.dataset.w);
    return row !== null && w >= row.word && (!next || w < next.word);
  });
  onRow[0]?.scrollIntoView({ block: "center" });
  tintWords(onRow);
};

/** How much of a line must show before it counts as on screen. */
const SEEN_PX = 24;

/** The matn lines at least partly on screen in the page's scroll area. */
const linesOnScreen = (root: HTMLElement): number[] => {
  const view = root.getBoundingClientRect();
  return [...root.querySelectorAll<HTMLElement>('[data-line-block^="matn-"]')].flatMap((el) => {
    const r = el.getBoundingClientRect();
    const seen = Math.min(r.bottom, view.bottom) - Math.max(r.top, view.top);
    return seen >= Math.min(SEEN_PX, r.height) ? [Number(el.dataset.lineBlock?.slice("matn-".length))] : [];
  });
};

/**
 * The block behind the contents entries on screen. It slides between entries
 * as the reader moves through the book instead of jumping.
 */
const useActiveIndicator = (active: number[]) => {
  const list = useRef<HTMLDivElement>(null);
  const followed = useRef(false);
  const [box, setBox] = useState<{ top: number; height: number; animate: boolean } | null>(null);
  const first = active.length ? Math.min(...active) : -1;
  const last = active.length ? Math.max(...active) : -1;
  // Resizing the panel rewraps the titles: measure again, in place.
  useLayoutEffect(() => {
    const el = list.current;
    if (!el) return;
    // It also fires once when it starts watching; the chapter change above already measured, and may be sliding.
    let started = false;
    const observer = new ResizeObserver(() => {
      if (!started) {
        started = true;
        return;
      }
      const items = el.querySelectorAll<HTMLElement>("[data-entry]");
      const top = items[first];
      const bottom = items[last];
      if (top && bottom) setBox({ top: top.offsetTop, height: bottom.offsetTop + bottom.offsetHeight - top.offsetTop, animate: false });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [first, last]);
  useLayoutEffect(() => {
    const items = list.current?.querySelectorAll<HTMLElement>("[data-entry]");
    const top = items?.[first];
    const bottom = items?.[last];
    if (!top || !bottom) {
      setBox(null);
      // Before the first heading nothing is current: go back to the start of the list.
      const scroller = list.current?.closest<HTMLElement>(".overflow-y-auto");
      const smooth = followed.current && !matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (scroller && scroller.scrollTop > 0) scroller.scrollTo({ top: 0, behavior: smooth ? "smooth" : "instant" });
      return;
    }
    setBox((prev) => ({ top: top.offsetTop, height: bottom.offsetTop + bottom.offsetHeight - top.offsetTop, animate: prev !== null }));
    // Follow the reader: bring the current chapter into view when it's scrolled out, at once when the list opens.
    const scroller = top.closest<HTMLElement>(".overflow-y-auto");
    if (!scroller) return;
    const view = scroller.getBoundingClientRect();
    const at = top.getBoundingClientRect();
    if (at.top >= view.top && at.bottom <= view.bottom) return;
    const smooth = followed.current && !matchMedia("(prefers-reduced-motion: reduce)").matches;
    scroller.scrollTo({ top: scroller.scrollTop + at.top - view.top - (view.height - at.height) / 2, behavior: smooth ? "smooth" : "instant" });
  }, [first, last]);
  useEffect(() => {
    followed.current = true;
  }, []);
  return { list, box };
};

export type SidebarTab = "contents" | "bookmarks";

const SIDEBAR_TABS: { value: SidebarTab; label: string }[] = [
  { value: "contents", label: "Contents" },
  { value: "bookmarks", label: "Bookmarks" },
];

/** The left sidebar: the book's contents, or its bookmarks. */
const ContentsRail = ({
  entries,
  active,
  onGo,
  tab,
  onTab,
  bookmarks,
  width,
  onResize,
  onResetSize,
  onClose,
}: {
  entries: TocEntry[];
  /** The entries whose text is on screen. */
  active: number[];
  onGo: (position: number) => void;
  tab: SidebarTab;
  onTab: (tab: SidebarTab) => void;
  bookmarks: ReactNode;
  width: number;
  onResize: (width: number) => void;
  onResetSize: () => void;
  onClose: () => void;
}) => (
  <SidePanel
    side="left"
    as="nav"
    label={tab === "contents" ? "Contents" : "Bookmarks"}
    width={width}
    onResize={onResize}
    onResetSize={onResetSize}
    header={
      <>
        <Segmented<SidebarTab>
          label="Sidebar"
          value={tab}
          onChange={(next) => switchListInTransition({ list: "sidebar", order: SIDEBAR_TABS.map((t) => t.value), from: tab, to: next, apply: onTab })}
          options={SIDEBAR_TABS}
          fullWidth
          className="min-w-0 flex-1"
        />
        <IconButton icon={X} label="Hide contents" onClick={onClose} />
      </>
    }
  >
    {/* Keyed by tab, so each list starts at its top. */}
    <SidePanelBody key={tab} switchList="sidebar" className="gap-0.5 px-4 py-4">
      {tab === "contents" ? <ContentsList entries={entries} active={active} onGo={onGo} /> : bookmarks}
    </SidePanelBody>
  </SidePanel>
);

const ContentsList = ({ entries, active, onGo }: { entries: TocEntry[]; active: number[]; onGo: (position: number) => void }) => {
  const { list, box } = useActiveIndicator(active);
  return (
    <>
      {entries.length === 0 && <p className="px-2.5 text-xs text-ink-3">This book has no chapter headings.</p>}
      <div ref={list} className="relative flex flex-col gap-0.5">
        {box && (
          <span
            aria-hidden
            style={{ translate: `0 ${box.top}px`, height: box.height }}
            className={cx(
              "pointer-events-none absolute inset-x-0 top-0 rounded-lg bg-accent-soft",
              box.animate && "transition-[translate,height] duration-slide ease-move motion-reduce:transition-none",
            )}
          />
        )}
        {entries.map((e, i) => (
          <button
            key={`${e.position}-${i}`}
            type="button"
            data-entry
            aria-current={active.includes(i) ? "location" : undefined}
            onClick={() => onGo(e.position)}
            className={cx(
              "relative flex items-center gap-2 rounded-lg px-2.5 py-1 text-left transition-colors",
              active.includes(i) ? "text-accent" : "text-ink-2 hover:bg-ink/5 hover:text-ink",
              e.level > 2 && "pl-5",
            )}
          >
            <span className="ar text-ar-small text-ink-3">{arabicNumber(e.number ?? e.position)}</span>
            <span className="ar flex-1 text-right text-ar-small">{e.text}</span>
          </button>
        ))}
      </div>
    </>
  );
};

const baseAt = ({ page, ref }: { page: StoredPage["page"]; ref: LetterRef }): string | undefined => {
  const word = wordsOf(lineText({ page, part: ref.part, line: ref.line }) ?? "")[ref.word - 1];
  return word ? lettersOf(word)[ref.letter - 1]?.base : undefined;
};

/** Whether a letter can take harakat: Arabic letters can, brackets and digits can't. */
const takesHarakat = ({ page, ref }: { page: StoredPage["page"]; ref: LetterRef }) => isArabicLetter(baseAt({ page, ref }) ?? "");

/** Moves the typing target by `delta` letters, crossing into neighbouring words on the same line and skipping punctuation. */
const moveTarget = ({ page, target, delta }: { page: StoredPage["page"]; target: LetterRef; delta: number }): LetterRef => {
  const text = lineText({ page, part: target.part, line: target.line }) ?? "";
  const counts = wordsOf(text).map((w) => lettersOf(w).length);
  const step = (from: LetterRef): LetterRef | null => {
    const letter = from.letter + delta;
    if (letter >= 1 && letter <= (counts[from.word - 1] ?? 0)) return { ...from, letter };
    const word = from.word + delta;
    const size = counts[word - 1];
    return size ? { ...from, word, letter: delta > 0 ? 1 : size } : null;
  };
  for (let next = step(target); next; next = step(next)) if (takesHarakat({ page, ref: next })) return next;
  return target;
};

/**
 * What focus mode leaves of the chrome: a thin line along the top that shows
 * how far through the book the reader is (filling right to left). It fades in
 * as the bars step aside.
 */
const FocusTrace = ({ shown, progress }: { shown: boolean; progress: number }) => (
  <div aria-hidden data-state={shown ? "shown" : "hidden"} className="group/trace pointer-events-none absolute inset-0 z-30">
    <div className="absolute inset-x-0 top-0 h-0.5 bg-line opacity-0 transition-opacity duration-panel ease-sheet group-data-[state=shown]/trace:opacity-100">
      <div style={{ transform: `scaleX(${progress})` }} className="h-full origin-right bg-accent" />
    </div>
  </div>
);

export const ReaderRoute = () => {
  const { bookId = "" } = useParams();
  const [search, setSearch] = useSearchParams();
  const book = useBook(bookId);
  const waiting = useWaitingBooks();
  const navigate = useNavigate();
  // A book removed while open (from the midad CLI, or on another device) goes back to the library.
  const hadBook = useRef(false);
  useEffect(() => {
    hadBook.current = false;
  }, [bookId]);
  useEffect(() => {
    if (book.data) hadBook.current = true;
    else if (book.data === null && hadBook.current) void navigate("/", { replace: true, viewTransition: true });
  }, [book.data, navigate]);
  // Wide windows show contents and the side panel beside the text (remembered);
  // narrower ones slide them over the page, closed until asked for.
  const wide = useMediaQuery("(min-width: 80rem)");
  const [contentsPref, setContentsPref] = usePref({ key: "reader.contentsOpen", fallback: true });
  const [contentsSheet, setContentsSheet] = useState(false);
  const contentsOpen = wide ? contentsPref : contentsSheet;
  const setContentsOpen = wide ? setContentsPref : setContentsSheet;
  const [showHarakat, setShowHarakat] = usePref({ key: "reader.showHarakat", fallback: true });
  const [showMine] = usePref({ key: "reader.showMine", fallback: true });
  const [lineNumbers] = usePref({ key: "reader.lineNumbers", fallback: true });
  const [glosses] = useGlossMode();
  const [hashiyaMarkers] = usePref({ key: "reader.hashiyaMarkers", fallback: true });
  const [noteIcons] = useNoteIcons();
  const [textScale, setTextScale] = usePref({ key: "reader.textScale", fallback: 1 });
  const [showScan, setShowScan] = usePref({ key: "reader.showScan", fallback: false });
  const [target, setTarget] = useState<LetterRef | null>(null);
  useEffect(() => {
    if (!showHarakat || !showMine) setTarget(null);
  }, [showHarakat, showMine]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [panelPref, setPanelPref] = usePref({ key: "reader.panelOpen", fallback: false });
  const [panelSheet, setPanelSheet] = useState(false);
  const panelOpen = wide ? panelPref : panelSheet;
  const setPanelOpen = wide ? setPanelPref : setPanelSheet;
  const [panelWidth, setPanelWidth] = usePref({ key: "reader.panelWidth", fallback: PANEL_WIDTH });
  const [savedContentsWidth, setContentsWidth] = usePref({ key: "reader.contentsWidth", fallback: CONTENTS_WIDTH });
  // Widths saved before the minimums grew still open wide enough for the panels' headers.
  const contentsWidth = Math.max(savedContentsWidth, CONTENTS_MIN);
  const [panelTab, setPanelTab] = usePref<PanelTab>({ key: "reader.panelTab", fallback: "highlights" });
  const [annotationsTab, setAnnotationsTab] = usePref<Exclude<PanelTab, "ask">>({ key: "reader.annotationsTab", fallback: "highlights" });
  const [askWidth, setAskWidth] = usePref<number | null>({ key: "reader.askWidth", fallback: null });
  const asking = panelTab === "ask";
  // Ask AI only opens when asked for: a book opens with it closed, even if it was open last time.
  // Reopening Midad into the book it was left on keeps it as it was.
  const launched = (useLocation().state as ReaderState | null)?.launched === true;
  const askOpenAtLoad = useRef({ asking, panelPref, setPanelPref, launched });
  askOpenAtLoad.current = { asking, panelPref, setPanelPref, launched };
  useEffect(() => {
    const { asking: wasAsking, panelPref: wasOpen, setPanelPref: close, launched: keep } = askOpenAtLoad.current;
    if (wasAsking && wasOpen && !keep) close(false);
  }, [bookId]);
  const sideWidth = Math.max(asking ? (askWidth ?? Math.max(ASK_WIDTH, panelWidth + ASK_EXTRA)) : panelWidth, PANEL_MIN);
  const setSideWidth = asking ? setAskWidth : setPanelWidth;
  const [toolbar, setToolbar] = useState<Toolbar | null>(null);
  const [removal, setRemoval] = useState<{ id: number; message: string } | null>(null);
  // A highlight just made is drawn in like a marker; this clears once that has played.
  const [freshHighlight, setFreshHighlight] = useState<string | null>(null);
  const freshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const drawIn = (id: string) => {
    setFreshHighlight(id);
    clearTimeout(freshTimer.current);
    freshTimer.current = setTimeout(() => setFreshHighlight(null), 1000);
  };
  // Kept after closing so the toolbar can animate out with its content.
  const lastToolbar = useRef<Toolbar | null>(null);
  if (toolbar) lastToolbar.current = toolbar;
  const [noteEditor, setNoteEditor] = useState<NoteState | null>(null);
  // Kept after closing so the popover can animate out with its content.
  const lastNote = useRef<NoteState | null>(null);
  if (noteEditor) lastNote.current = noteEditor;
  const [entryTint, setEntryTint] = useState<string | null>(null);
  const [markTint, setMarkTint] = useState<readonly string[]>([]);
  const [panelEditTint, setPanelEditTint] = useState<string | null>(null);
  /** A page or line note being written in the Notes tab; dropped when the page turns. */
  const [noteDraft, setNoteDraft] = useState<{ position: number; draft: NoteDraft } | null>(null);
  const tinted = useMemo<ReadonlySet<string>>(() => {
    const fromLayer = !noteEditor
      ? []
      : noteEditor.mode === "row"
        ? entryTint
          ? [entryTint]
          : (noteEditor.row ?? []).map((n) => n.id)
        : noteEditor.note
          ? [noteEditor.note.id]
          : [];
    return new Set([...fromLayer, ...markTint, ...(panelEditTint ? [panelEditTint] : [])]);
  }, [noteEditor, entryTint, markTint, panelEditTint]);
  const pageRoot = useRef<HTMLDivElement>(null);
  const pointerInNote = useRef(false);
  const leftNote = useRef(false);
  // A popover that closes under the pointer never sees it leave.
  if (!noteEditor) {
    pointerInNote.current = false;
    leftNote.current = false;
  }
  const reselect = useRef<Span | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const marker = useMarker(bookId);
  const setMarker = useSetMarker(bookId);
  const bookmarks = useBookmarks(bookId);
  const setBookmark = useSetBookmark(bookId);
  const [sidebarTab, setSidebarTab] = usePref<SidebarTab>({ key: "reader.sidebarTab", fallback: "contents" });
  const pendingReveal = useRef<(Citation & { position: number }) | null>(null);
  const pendingRow = useRef<{ position: number; part: Part; line: number; word: number } | null>(null);
  const arrivedWith = useLocation().state as ReaderState | null;
  const pendingScroll = useRef(arrivedWith && "scrollTop" in arrivedWith ? arrivedWith.scrollTop : null);
  const pendingPlace = useRef(arrivedWith && "anchor" in arrivedWith ? arrivedWith.anchor : null);
  const [askSelection, setAskSelection] = useState<AskSelection | null>(null);
  const conversation = useAskConversation({ bookId, onNew: () => setAskSelection(null) });
  const client = useQueryClient();
  const [find, setFind] = useState<FindState>(CLOSED_FIND);
  const [findFocus, setFindFocus] = useState(0);

  const total = book.data?.pageCount ?? 0;
  const fromUrl = Number(search.get("p"));
  // Opening a book returns to its last-read marker; without one, to the last page viewed.
  const position = fromUrl >= 1 ? fromUrl : (marker.data?.position ?? book.data?.progress?.position ?? 1);
  const page = usePage({ bookId, position });
  const annotations = useAnnotations({ bookId, position });
  const actions = useAnnotationActions({ bookId, position });
  const bookMarks = useBookMarks(bookId);
  const toc = useMemo(() => (book.data ? tableOfContents(book.data) : []), [book.data]);
  // Load the pages either side ahead of time, so a page turn's snapshot never catches a loading page.
  useEffect(() => {
    for (const p of neighbourPages({ position, total: book.data?.pageCount ?? 0 })) {
      void client.prefetchQuery({ queryKey: keys.page(bookId, p), queryFn: () => midad["library.page"]({ bookId, position: p }) });
      void client.prefetchQuery({ queryKey: keys.annotations(bookId, p), queryFn: () => midad["annotations.list"]({ bookId, position: p }) });
    }
  }, [client, bookId, position, book.data?.pageCount]);
  const findMatches = useMemo(
    () => (find.open && page.data ? findOnPage({ page: page.data.page, query: find.query, options: find.options }) : []),
    [find.open, find.query, find.options, page.data],
  );
  const activeMatch = findMatches.length ? Math.min(find.active, findMatches.length - 1) : 0;
  useFindHighlights({ root: pageRoot, matches: findMatches, active: activeMatch, open: find.open });
  const latestMatches = useRef(findMatches);
  latestMatches.current = findMatches;
  useEffect(() => {
    if (find.open) revealMatch({ root: pageRoot.current, span: latestMatches.current[activeMatch] });
  }, [find.open, find.query, find.options, activeMatch, page.data]);
  const stepMatch = (by: 1 | -1) => {
    const count = findMatches.length;
    if (count) setFind((f) => ({ ...f, active: (activeMatch + by + count) % count }));
  };
  const openFind = () => {
    setFind((f) => ({ ...f, open: true }));
    setFindFocus((n) => n + 1);
  };
  const closeFind = () => {
    setFind((f) => ({ ...f, open: false }));
    if (document.activeElement instanceof HTMLElement && document.activeElement.closest('[role="search"]')) document.activeElement.blur();
  };
  const chapterTitle = toc[entryIndexFor(toc, position)]?.text ?? null;
  const [chosenWidth] = usePageWidth();
  // Lags the choice by a render, so the reading place is picked in the old column before it changes.
  const [pageWidth, setPageWidth] = useState(chosenWidth);
  const [highlightStyle] = useHighlightStyle();
  const [onScreen, setOnScreen] = useState<{ position: number; lines: number[] }>({ position, lines: [] });
  const measureFrame = useRef(0);
  const measureOnScreen = useCallback(() => {
    cancelAnimationFrame(measureFrame.current);
    measureFrame.current = requestAnimationFrame(() => {
      const root = pageRoot.current;
      if (!root) return;
      const lines = linesOnScreen(root);
      // A resize (the side panel sliding, say) fires every frame; only a change in what's on screen needs a render.
      setOnScreen((current) => (current.position === position && sameLines(current.lines, lines) ? current : { position, lines }));
    });
  }, [position]);
  useLayoutEffect(() => {
    measureOnScreen();
    const root = pageRoot.current;
    if (!root) return;
    const resized = new ResizeObserver(measureOnScreen);
    resized.observe(root);
    return () => resized.disconnect();
  }, [measureOnScreen, page.data, textScale, showHarakat]);
  const activeEntries = useMemo(
    () =>
      visibleEntries({
        entries: toc,
        position,
        headingLines: page.data?.position === position ? page.data.page.matn.flatMap((b) => (b.kind === "heading" ? [b.line] : [])) : [],
        visibleLines: onScreen.position === position ? onScreen.lines : [],
      }),
    [toc, position, page.data, onScreen],
  );

  const go = useCallback(
    (next: number) => {
      if (next < 1 || next === position || next > total) return;
      // The book reads right to left: the next page comes in from the left.
      document.documentElement.dataset.turn = next > position ? "forward" : "back";
      setSearch({ p: String(next) }, { replace: true, viewTransition: true });
    },
    [total, position, setSearch],
  );

  const dismiss = useCallback(() => {
    setToolbar(null);
    setNoteEditor(null);
    setTarget(null);
    setRemoval(null);
  }, []);

  useEffect(dismiss, [position, dismiss]);
  useEffect(() => setFind((f) => ({ ...f, active: 0 })), [position]);
  // The library names its cover and marks the opening; once the transition has played, page turns use their own name again.
  useEffect(() => {
    const timer = setTimeout(() => delete document.documentElement.dataset.opening, COVER_TRANSITION_MS);
    return () => clearTimeout(timer);
  }, []);

  // Leaving the reader is a screen change, not a page turn.
  useEffect(
    () => () => {
      delete document.documentElement.dataset.turn;
    },
    [],
  );

  const resumed = useRef(false);
  useEffect(() => {
    if (resumed.current || !marker.isSuccess) return;
    resumed.current = true;
    if (!fromUrl && marker.data) pendingRow.current = marker.data;
  }, [marker.isSuccess, marker.data, fromUrl]);

  // A page comes back where it was left this session, or else starts at its top. A navigation with its own
  // target (a citation, the marker's row, a launch or Settings place) goes there instead, as does opening the book.
  const shownPage = page.data?.position;
  const shownBook = page.data?.bookId;
  const lastShownPage = useRef<PageRef | null>(null);
  useLayoutEffect(() => {
    if (shownPage === undefined || shownBook === undefined) return;
    const last = lastShownPage.current;
    if (last?.bookId === shownBook && last.position === shownPage) return;
    lastShownPage.current = { bookId: shownBook, position: shownPage };
    const hasTarget =
      pendingReveal.current?.position === shownPage || pendingRow.current?.position === shownPage || pendingScroll.current !== null || pendingPlace.current !== null;
    const next = arrival({ page: { bookId: shownBook, position: shownPage }, opening: last === null, hasTarget, memory: pageMemory });
    if (next.kind === "restore") restorePlace(next.place);
    else if (next.kind === "top") pageRoot.current?.scrollTo({ top: 0 });
  }, [shownPage, shownBook]);

  useEffect(() => {
    const reveal = pendingReveal.current;
    if (reveal && page.data?.position === reveal.position) {
      pendingReveal.current = null;
      requestAnimationFrame(() => revealCitation({ root: pageRoot.current, cite: reveal, page: page.data?.page }));
    }
    const scrollTop = pendingScroll.current;
    if (scrollTop !== null && page.data?.position === position) {
      pendingScroll.current = null;
      requestAnimationFrame(() => pageRoot.current?.scrollTo({ top: scrollTop }));
    }
    const place = pendingPlace.current;
    if (place && page.data?.position === position) {
      pendingPlace.current = null;
      // The saved word only lands in the right spot once the page's fonts have laid it out.
      void document.fonts.ready.then(() => requestAnimationFrame(() => holdAnchor({ selector: wordSelector(place), offset: place.offset })));
    }
    const row = pendingRow.current;
    if (row && page.data?.position === row.position) {
      pendingRow.current = null;
      requestAnimationFrame(() => revealRow({ root: pageRoot.current, ...row }));
    }
  });

  const citeLines = ({ position: at, ...cite }: Citation & { position: number }) => {
    // A sheet covers the page, so step out of the way to show where the citation points.
    if (!wide) setPanelOpen(false);
    if (at === position) revealCitation({ root: pageRoot.current, cite, page: page.data?.page });
    else {
      pendingReveal.current = { position: at, ...cite };
      go(at);
    }
  };

  /**
   * Switches the side panel between the annotations and Ask AI. While it's on
   * screen the whole panel slides across, like a list switch: Ask AI's button
   * sits right of the annotations', so it comes in from the right.
   */
  const switchPanelTab = (next: PanelTab) => {
    const group = (tab: PanelTab) => (tab === "ask" ? "ask" : "annotations");
    const onScreen = panelOpen && (!wide || (panelShown && !focused));
    if (!onScreen || group(next) === group(panelTab)) {
      setPanelTab(next);
      return;
    }
    switchListInTransition({ list: "panel", order: ["annotations", "ask"], from: group(panelTab), to: group(next), apply: () => setPanelTab(next) });
  };

  const openAsk = (selection: AskSelection | null) => {
    if (selection) {
      setAskSelection(selection);
      // Asking about a passage shows the chat, even if the saved conversations were open.
      if (conversation.screen.name !== "chat") conversation.showScreen("chat");
    }
    switchPanelTab("ask");
    setPanelOpen(true);
    setAskShown(true);
  };

  const markerAt = (): MarkerAt => {
    const m = marker.data;
    return m ? { position: m.position, part: m.part, line: m.line, word: m.word } : null;
  };

  const markRow = (at: { part: Part; line: number; word: number }) => void edits().setMarker({ before: markerAt(), after: { position, ...at } });

  /** Closes the note shortly, unless the pointer comes back. Leaving the popover itself closes even the editor. */
  const scheduleNoteClose = ({ left = false }: { left?: boolean } = {}) => {
    // Words the pointer crosses on its way out reschedule the close; they mustn't drop the "left the popover" reason.
    leftNote.current ||= left;
    clearTimeout(closeTimer.current);
    // Leaving a word gives the pointer time to cross the glosses under it into the note.
    closeTimer.current = setTimeout(
      () => {
        if (pointerInNote.current) return;
        if (leftNote.current || !focusInNoteEditor()) setNoteEditor(null);
      },
      leftNote.current ? 120 : 400,
    );
  };

  const onWordHover = (target: WordTarget, note: Note | null) => {
    if (!note) {
      if (noteEditor && noteEditor.mode !== "edit") scheduleNoteClose();
      return;
    }
    clearTimeout(closeTimer.current);
    if (toolbar || focusInNoteEditor() || noteEditor?.note?.id === note.id) return;
    if (noteEditor?.mode === "edit" && pointerInNote.current) return;
    // Right under the word, over any glosses there, so the pointer has no gap to cross into it.
    setNoteEditor({ note, span: note.span, rect: target.element.getBoundingClientRect(), mode: "peek" });
  };

  /** A margin mark's notes as the note layer shows them: one note's peek or editor, or the row's list. */
  const noteMarkState = ({ notes, anchor }: NoteMarkTarget, single: "peek" | "edit"): NoteState | null => {
    const [first] = notes;
    if (!first) return null;
    return notes.length === 1 ? { note: first, span: first.span, rect: anchor, mode: single } : { note: null, span: first.span, rect: anchor, mode: "row", row: notes };
  };
  const sameNotes = (a: NoteState | null, b: NoteState) =>
    a?.mode === b.mode && a.note?.id === b.note?.id && (a.row ?? []).map((n) => n.id).join() === (b.row ?? []).map((n) => n.id).join();

  const noteMarkHandlers = {
    /** Hovering a margin mark only tints its notes' words; clicking opens them. */
    onHover: (target: NoteMarkTarget | null) => setMarkTint(target ? target.notes.map((n) => n.id) : []),
    onOpen: (target: NoteMarkTarget) => {
      clearTimeout(closeTimer.current);
      setToolbar(null);
      const next = noteMarkState(target, "edit");
      if (next && !sameNotes(noteEditor, next)) setNoteEditor(next);
    },
  };

  const onWordClick = (word: WordTarget, highlight: Highlight | null) => {
    if (!window.getSelection()?.isCollapsed) return;
    if (word.letter !== null) {
      const ref = { part: word.part, line: word.ref.line, word: word.ref.word, letter: word.letter };
      // Marks the reader can't see can't be edited: with harakat (or their own) hidden, a click picks no letter.
      const takes = showHarakat && showMine && page.data && takesHarakat({ page: page.data.page, ref });
      // Words aren't focusable, so a text field (the Ask AI composer) would keep the keys meant for the letter.
      if (takes && document.activeElement instanceof HTMLElement && (document.activeElement.isContentEditable || document.activeElement.matches("input, textarea"))) {
        document.activeElement.blur();
      }
      setTarget(takes ? ref : null);
    }
    if (!highlight) return;
    setNoteEditor(null);
    setToolbar({ mode: "highlight", highlight, rect: rectWithGlosses(word.element) });
  };

  /**
   * The first click redraws the word with the letter cursor, so the browser
   * neither fires dblclick nor selects the word. Select it on the second press.
   */
  /** A drag that starts off the text (margins, gaps) still selects, from the nearest text. */
  const startDragSelection = (e: React.MouseEvent<HTMLElement>) => {
    const root = pageRoot.current;
    const anchor = root && caretNear({ root, x: e.clientX, y: e.clientY });
    const selection = window.getSelection();
    if (!root || !anchor || !selection) return;
    e.preventDefault();
    selection.collapse(anchor.node, anchor.offset);
    const move = (ev: MouseEvent) => {
      const focus = caretNear({ root, x: ev.clientX, y: ev.clientY });
      if (focus) selection.extend(focus.node, focus.offset);
    };
    const up = (ev: MouseEvent) => {
      window.removeEventListener("mousemove", move);
      // Released over the page, the page's own mouseup handles it.
      if (!(ev.target instanceof Node && root.contains(ev.target))) onSelectionEnd();
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up, { once: true });
  };

  /**
   * While the button is down, the margin controls inside each line stop taking
   * the pointer. Otherwise a drag that runs into the margin past a line's start
   * lands on them, and the browser reads that as the end of the line, so the
   * selection flips to the other way.
   */
  const markDragging = (root: HTMLElement) => {
    root.dataset.dragging = "";
    window.addEventListener("mouseup", () => delete root.dataset.dragging, { once: true, capture: true });
  };

  const onMouseDown = (e: React.MouseEvent<HTMLElement>) => {
    goalX.current = null;
    setMenuOpen(false);
    dismiss();
    if (e.button === 0 && pageRoot.current) markDragging(pageRoot.current);
    const offText = e.target instanceof Element && !e.target.closest("[data-w], [data-gloss-label], [role=link], button, a, input, textarea");
    if (e.button === 0 && e.detail === 1 && offText) return startDragSelection(e);
    if (e.detail === 3 && e.target instanceof Element) {
      const onLine = e.target.closest<HTMLElement>("[data-w]") ?? e.target.closest("[data-line]")?.querySelector<HTMLElement>("[data-w]");
      if (onLine) {
        e.preventDefault();
        selectLine(onLine);
        return;
      }
    }
    const word = e.detail === 2 && e.target instanceof Element ? e.target.closest<HTMLElement>("[data-w]") : null;
    const root = pageRoot.current;
    if (!word || !root) return;
    e.preventDefault();
    const ref = { line: Number(word.dataset.line), word: Number(word.dataset.w) };
    const span: Span = { part: word.dataset.part as Span["part"], start: ref, end: ref };
    if (target) {
      reselect.current = span;
      setTarget(null);
    } else selectSpan({ root, span });
  };

  /**
   * The browser only moves a selection with the keyboard in editable text, so the page does it
   * for its own selection. Words are the smallest step, since a selection snaps to whole words.
   */
  // The column Shift+↑/↓ keep to across rows, as a text field does; any other move forgets it.
  const goalX = useRef<number | null>(null);

  const extendSelection = (step: { direction: "left" | "right" | "backward" | "forward"; granularity: "word" | "lineboundary" } | { lines: 1 | -1 }) => {
    const root = pageRoot.current;
    const selection = window.getSelection();
    // A selection shrunk back to nothing keeps its place, so it can grow again past where it started, as in a text field.
    if (!root || !selection || selection.rangeCount === 0 || !selection.focusNode || !root.contains(selection.focusNode)) return false;
    if ("lines" in step) extendByLine({ root, selection, lines: step.lines });
    else {
      goalX.current = null;
      const before = JSON.stringify(spanFromSelection(root)?.span ?? null);
      // A step can land on a line break or the selection's start without changing the words; take another.
      for (let tries = 0; tries < 3; tries++) {
        selection.modify("extend", step.direction, step.granularity);
        if (!selection.isCollapsed && JSON.stringify(spanFromSelection(root)?.span ?? null) !== before) break;
      }
    }
    onSelectionEnd();
  };

  /** Moves the selection's moving end to the word in the row above or below, at the same column. */
  const extendByLine = ({ root, selection, lines }: { root: HTMLElement; selection: Selection; lines: 1 | -1 }) => {
    const range = selection.getRangeAt(0);
    const backward = !range.collapsed && range.startContainer === selection.focusNode && range.startOffset === selection.focusOffset;
    const picked = spanFromSelection(root);
    const at = (part: string, ref: { line: number; word: number }) => root.querySelector<HTMLElement>(`[data-part="${part}"][data-line="${ref.line}"][data-w="${ref.word}"]`);
    const focusNode = selection.focusNode as Node;
    const from = picked
      ? at(picked.span.part, backward ? picked.span.start : picked.span.end)
      : (focusNode instanceof Element ? focusNode : focusNode.parentElement)?.closest<HTMLElement>("[data-w]");
    if (!from) return;
    const here = from.getBoundingClientRect();
    const x = goalX.current ?? (here.left + here.right) / 2;
    const words = [...root.querySelectorAll<HTMLElement>("[data-w]")].map((el) => ({ el, r: el.getBoundingClientRect() }));
    const beyond = words.filter(({ r }) => (lines > 0 ? r.top >= here.bottom - here.height / 3 : r.bottom <= here.top + here.height / 3));
    if (beyond.length === 0) return;
    const rowEdge = lines > 0 ? Math.min(...beyond.map(({ r }) => r.top)) : Math.max(...beyond.map(({ r }) => r.bottom));
    const row = beyond.filter(({ r }) => (lines > 0 ? Math.abs(r.top - rowEdge) : Math.abs(r.bottom - rowEdge)) < here.height / 2);
    const gap = ({ r }: { r: DOMRect }) => (x < r.left ? r.left - x : x > r.right ? x - r.right : 0);
    const target = row.reduce((best, w) => (gap(w) < gap(best) ? w : best)).el;
    const parent = target.parentNode;
    if (!parent || !selection.anchorNode) return;
    const index = [...parent.childNodes].indexOf(target);
    // The moving end takes in the target word: after it when it lies past the fixed end, before it when it comes first.
    const anchor = document.createRange();
    anchor.setStart(selection.anchorNode, selection.anchorOffset);
    const targetFirst = anchor.comparePoint(parent, index) < 0;
    selection.extend(parent, targetFirst ? index : index + 1);
    goalX.current = x;
  };

  /**
   * Moves focus to the region beside the one it's in: contents, page, side panel, left to right.
   * Closed or hidden panels are skipped; at either end it stays put.
   */
  const moveRegion = (step: -1 | 1) => {
    const order = ["contents", "page", "side"] as const;
    const open = order.filter((name) => {
      const el = document.querySelector<HTMLElement>(`[data-region="${name}"]`);
      return el && el.offsetWidth > 0 && !el.closest("[inert], [data-focus=hidden]");
    });
    const here = (document.activeElement?.closest<HTMLElement>("[data-region]")?.dataset.region ?? "page") as (typeof order)[number];
    const next = open[open.indexOf(here) + step];
    if (!next) return;
    const region = document.querySelector<HTMLElement>(`[data-region="${next}"]`);
    if (!region) return;
    const target =
      next === "page"
        ? region
        : (region.querySelector<HTMLElement>("[role=textbox][aria-multiline]") ??
          region.querySelector<HTMLElement>("[aria-current]:is(button, a, [tabindex])") ??
          region.querySelector<HTMLElement>("button:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])"));
    target?.focus();
  };

  /** Selects every word of the page, main text and ḥāshiya, and nothing around it. */
  const selectPage = () => {
    const root = pageRoot.current;
    const words = root?.querySelectorAll<HTMLElement>("[data-w]");
    const first = words?.[0];
    const last = words?.[words.length - 1];
    if (!root || !first || !last) return false;
    const range = document.createRange();
    range.setStartBefore(first);
    range.setEndAfter(last);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    onSelectionEnd();
  };

  /** Selects a whole line: the browser's triple-click stops at inline pieces such as a note's corners. */
  const selectLine = (word: HTMLElement) => {
    const root = pageRoot.current;
    if (!root) return;
    const { part, line } = word.dataset;
    const words = root.querySelectorAll<HTMLElement>(`[data-part="${part}"][data-line="${line}"][data-w]`);
    const last = words[words.length - 1];
    if (!last) return;
    selectSpan({ root, span: { part: part as Span["part"], start: { line: Number(line), word: 1 }, end: { line: Number(line), word: Number(last.dataset.w) } } });
    onSelectionEnd();
  };

  /**
   * The page paints any word a selection touches as wholly selected; the selection itself, which is
   * what gets copied, is stretched to match, so a copy never stops partway through a word.
   */
  const snapToWords = ({ root, span, range }: { root: HTMLElement; span: Span; range: Range }) => {
    const at = (ref: { line: number; word: number }) => root.querySelector<HTMLElement>(`[data-part="${span.part}"][data-line="${ref.line}"][data-w="${ref.word}"]`);
    const first = at(span.start);
    const last = at(span.end);
    const selection = window.getSelection();
    if (!first?.parentNode || !last?.parentNode || !selection) return;
    const whole = document.createRange();
    whole.setStartBefore(first);
    whole.setEndAfter(last);
    // Only ever grows: a selection reaching into the ḥāshiya keeps its end there.
    if (range.compareBoundaryPoints(Range.START_TO_START, whole) < 0) whole.setStart(range.startContainer, range.startOffset);
    if (range.compareBoundaryPoints(Range.END_TO_END, whole) > 0) whole.setEnd(range.endContainer, range.endOffset);
    if (range.compareBoundaryPoints(Range.START_TO_START, whole) === 0 && range.compareBoundaryPoints(Range.END_TO_END, whole) === 0) return;
    // Keeps which end moves, so Shift+arrows carry on from the same side.
    const backward = selection.anchorNode === range.endContainer && selection.anchorOffset === range.endOffset && !range.collapsed;
    if (backward) selection.setBaseAndExtent(whole.endContainer, whole.endOffset, whole.startContainer, whole.startOffset);
    else selection.setBaseAndExtent(whole.startContainer, whole.startOffset, whole.endContainer, whole.endOffset);
  };

  const onSelectionEnd = () => {
    const root = pageRoot.current;
    const picked = root && spanFromSelection(root);
    if (!picked) {
      if (toolbar?.mode === "selection") setToolbar(null);
      return;
    }
    setNoteEditor(null);
    const { start, end, part } = picked.span;
    const range = window.getSelection()?.getRangeAt(0);
    const word = root.querySelector<HTMLElement>(`[data-part="${part}"][data-line="${start.line}"][data-w="${start.word}"]`);
    const insideOneWord = start.line === end.line && start.word === end.word && range && word && !selectionCoversWord({ range, word });
    if (!insideOneWord && range) snapToWords({ root, span: picked.span, range });
    setToolbar({ mode: "selection", ...picked, text: window.getSelection()?.toString() ?? "" });
    if (insideOneWord) {
      const letter = letterAtSelectionStart(root);
      if (letter !== null) setTarget({ part, line: start.line, word: start.word, letter });
    } else if (target) {
      // Dropping the letter cursor re-renders the word and loses the selection, so put it back afterwards.
      reselect.current = picked.span;
      setTarget(null);
    }
  };

  useLayoutEffect(() => {
    const span = reselect.current;
    reselect.current = null;
    if (span && pageRoot.current) selectSpan({ root: pageRoot.current, span });
  });

  const mineAt = (ref: LetterRef) =>
    annotations.data?.harakat.find(
      (h) => !h.stale && h.part === ref.part && h.line === ref.line && h.word === ref.word && h.letter === ref.letter,
    )?.marks ?? "";

  // Undo and redo cover every edit on the current page; the stack starts over on a new page.
  const latestActions = useRef(actions);
  latestActions.current = actions;
  const latestSetMarker = useRef(setMarker);
  latestSetMarker.current = setMarker;
  const latestSetBookmark = useRef(setBookmark);
  latestSetBookmark.current = setBookmark;
  const undoStack = useRef<{ position: number; stack: UndoStack } | null>(null);
  const edits = (): UndoStack => {
    if (undoStack.current?.position !== position) {
      const a = () => latestActions.current;
      undoStack.current = {
        position,
        stack: createUndoStack({
          addHighlight: async (input) => (await a().addHighlight(input)).id,
          removeHighlight: (id) => a().removeHighlight(id),
          addNote: async (input) => (await a().addNote(input)).id,
          updateNote: (input) => a().updateNote(input),
          deleteNote: (id) => a().deleteNote(id),
          setMarks: ({ ref, marks }) => (marks ? a().setHarakat({ ...ref, marks }) : a().removeHarakat(ref)),
          clearMarks: (span) => a().clearHarakat(span),
          setMarker: (at) => latestSetMarker.current(at),
          setBookmark: (input) => latestSetBookmark.current(input),
        }),
      };
    }
    return undoStack.current.stack;
  };

  // A merge from the CLI or another device changed something: undo forgets entries naming it.
  useEffect(
    () =>
      window.midadEvents.onRemoteChanges((changes) => {
        const open = undoStack.current;
        if (!open) return;
        void open.stack.forget({
          highlights: new Set(changes.highlights),
          notes: new Set(changes.notes),
          letters: changes.harakat.filter((l) => l.bookId === bookId && l.position === open.position),
          marker: changes.markers.includes(bookId),
          bookmarkPositions: new Set(changes.bookmarks.filter((b) => b.bookId === bookId).map((b) => b.position)),
        });
      }),
    [bookId],
  );

  const editMarks = (ref: LetterRef, after: string) => void edits().setMarks({ ref, before: mineAt(ref), after });

  const typeMark = (ref: LetterRef, typed: string) => editMarks(ref, mergeMarks({ existing: mineAt(ref), typed }));

  const announceRemoval = (message: string) => setRemoval({ id: Date.now(), message });

  const pageBookmark = bookmarks.data?.find((b) => b.position === position) ?? null;
  const savedState = (b: SavedBookmark): BookmarkState => ({ name: b.name, createdAt: b.createdAt });
  const removeBookmark = (b: SavedBookmark) => {
    void edits().setBookmark({ position: b.position, before: savedState(b), after: null });
    announceRemoval("Bookmark removed");
  };
  const renameBookmark = ({ bookmark, name }: { bookmark: SavedBookmark; name: string }) =>
    void edits().setBookmark({ position: bookmark.position, before: savedState(bookmark), after: { name, createdAt: bookmark.createdAt } });
  const toggleBookmark = () => {
    if (!book.data || position < 1 || position > total) return;
    if (pageBookmark) removeBookmark(pageBookmark);
    else void edits().setBookmark({ position, before: null, after: { name: null } });
  };

  const removeHighlight = (id: string) => {
    const h = annotations.data?.highlights.find((x) => x.id === id);
    if (!h) return;
    void edits().removeHighlight({ id, span: h.span, color: h.color });
    announceRemoval("Highlight removed");
  };

  const noteWrites = {
    create: async ({ body, ...target }: NoteTarget & { body: string }) => {
      return { id: await edits().addNote({ target, body }) };
    },
    update: async ({ id, body }: { id: string; body: string }) => {
      const page = annotations.data;
      const before = (page?.pageNote?.id === id ? page.pageNote.body : page?.notes.find((n) => n.id === id)?.body) ?? "";
      await edits().updateNote({ id, before, after: body });
    },
    remove: async (id: string) => {
      const page = annotations.data;
      if (page?.pageNote?.id === id) {
        await edits().deleteNote({ id, target: { page: true }, body: page.pageNote.body });
        announceRemoval("Page note deleted");
        return;
      }
      const n = page?.notes.find((x) => x.id === id);
      if (!n) return;
      const target: NoteTarget = n.kind === "line" ? { line: { part: n.span.part, line: n.span.start.line } } : { span: n.span };
      await edits().deleteNote({ id, target, body: n.body });
      announceRemoval("Note deleted");
    },
  };

  const openNotes = (draft: NoteDraft | null) => {
    setPanelTab("notes");
    setAnnotationsTab("notes");
    setPanelOpen(true);
    if (draft) setNoteDraft({ position, draft });
  };
  const startLineNote = (line: number) => {
    const text = page.data ? lineText({ page: page.data.page, part: "matn", line }) : null;
    if (text) openNotes({ kind: "line", line: { part: "matn", line }, text });
  };
  const openPageNote = () => openNotes(annotations.data?.pageNote ? null : { kind: "page" });

  const step = (direction: "undo" | "redo") => {
    setRemoval(null);
    void edits()
      [direction]()
      .then((change) => {
        if (change?.kind === "harakat") setTarget(change.ref);
      })
      .catch((err: unknown) => console.error(`Couldn't ${direction}:`, err));
  };

  const finishToolbar = () => {
    setToolbar(null);
    window.getSelection()?.removeAllRanges();
  };

  const openNoteFromToolbar = () => {
    if (!toolbar) return;
    const span = toolbar.mode === "selection" ? toolbar.span : toolbar.highlight.span;
    setNoteEditor({ note: null, span, rect: toolbar.rect, mode: "edit" });
    finishToolbar();
  };

  // Saved when the book loads or the page changes, not on every refetch: a refetch after another
  // device's change would save this device's place again, and two open readers would bounce it forever.
  const bookLoaded = book.data !== undefined;
  useEffect(() => {
    if (bookLoaded && position >= 1 && position <= total) {
      void midad["library.setProgress"]({ bookId, position });
    }
  }, [bookLoaded, bookId, position, total]);

  const shownRef = useRef<PageRef | null>(null);
  shownRef.current = page.data ? { bookId: page.data.bookId, position: page.data.position } : null;
  const placeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const savePlace = useCallback(() => {
    clearTimeout(placeTimer.current);
    placeTimer.current = undefined;
    const root = pageRoot.current;
    const at = shownRef.current?.position;
    const anchor = root && topWordAnchor(root);
    if (at === undefined || !anchor) return;
    void midad["library.setProgress"]({ bookId, position: at, anchor }).catch(() => undefined);
  }, [bookId]);
  const memoryFrame = useRef(0);
  const rememberPlace = () => {
    cancelAnimationFrame(memoryFrame.current);
    memoryFrame.current = requestAnimationFrame(() => {
      const root = pageRoot.current;
      const shown = shownRef.current;
      // Until a launch's or Settings' place is put back, the scroll isn't the reader's own.
      if (!root || !shown || pendingScroll.current !== null || pendingPlace.current !== null) return;
      const anchor = topWordAnchor(root);
      pageMemory.remember({ page: shown, place: anchor ? { anchor } : { scrollTop: root.scrollTop } });
    });
  };
  const schedulePlaceSave = () => {
    clearTimeout(placeTimer.current);
    placeTimer.current = setTimeout(savePlace, SAVE_PLACE_MS);
  };
  // Quitting right after a scroll still keeps the place.
  useEffect(() => {
    const flush = () => placeTimer.current !== undefined && savePlace();
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
      flush();
    };
  }, [savePlace]);

  const latestScale = useRef(textScale);
  latestScale.current = textScale;
  const [zoomShown, setZoomShown] = useState(false);
  const zoomTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(zoomTimer.current), []);
  const zoomAnchor = useRef<ZoomAnchor | null>(null);
  const pendingAnchor = useRef<ZoomAnchor | null>(null);

  /**
   * The word to hold in place while the text size changes: the one under the
   * pointer, or the first whole one at the top of the page. A burst of steps
   * keeps the first step's word and height, so the page doesn't drift.
   */
  const pickAnchor = (pointer: Point | null): ZoomAnchor | null => {
    const root = pageRoot.current;
    if (!root) return null;
    const now = performance.now();
    const last = zoomAnchor.current;
    if (last && continuesBurst({ anchoredAt: last.at, now })) {
      last.at = now;
      return last;
    }
    const view = root.getBoundingClientRect();
    const words = [...root.querySelectorAll<HTMLElement>("[data-w]")];
    const boxes = words.map((w) => w.getBoundingClientRect());
    const overPage = pointer && pointer.x >= view.left && pointer.x <= view.right && pointer.y >= view.top && pointer.y <= view.bottom;
    const word = words[overPage ? nearestWord({ words: boxes, ...pointer }) : firstFullyVisible({ words: boxes, view })];
    if (!word) return null;
    const { part, line, w } = word.dataset;
    zoomAnchor.current = { selector: wordSelector({ part: part ?? "", line: line ?? "", word: w ?? "" }), offset: word.getBoundingClientRect().top - view.top, at: now };
    return zoomAnchor.current;
  };

  const holdAnchor = (anchor: Pick<ZoomAnchor, "selector" | "offset"> | null) => {
    const root = pageRoot.current;
    const word = anchor && root?.querySelector(anchor.selector);
    if (!anchor || !root || !word) return false;
    root.scrollTop = restoredScrollTop({
      scrollTop: root.scrollTop,
      anchorTop: word.getBoundingClientRect().top,
      viewTop: root.getBoundingClientRect().top,
      offset: anchor.offset,
      maxScrollTop: root.scrollHeight - root.clientHeight,
    });
    return true;
  };

  /** Puts a page back where it was left, at once; its word is held again once fonts that were still loading arrive. */
  const restorePlace = (place: PagePlace) => {
    const root = pageRoot.current;
    if (!root) return;
    if ("scrollTop" in place) {
      root.scrollTop = place.scrollTop;
      return;
    }
    const anchor = { selector: wordSelector(place.anchor), offset: place.anchor.offset };
    if (!holdAnchor(anchor)) {
      root.scrollTop = 0;
      return;
    }
    if (document.fonts.status !== "loaded") void document.fonts.ready.then(() => holdAnchor(anchor));
  };

  useLayoutEffect(() => {
    holdAnchor(pendingAnchor.current);
    pendingAnchor.current = null;
  }, [textScale]);

  /**
   * Narrow and Wide: the column eases to its new width (a max-width
   * transition in styles.css), reflowing as it goes, while the first whole word
   * at the top is held in place every frame until it settles.
   */
  const stopWidthFollow = useRef<(hold: boolean) => void>(() => {});
  useEffect(() => {
    if (chosenWidth === pageWidth) return;
    stopWidthFollow.current(false);
    const anchor = pickAnchor(null);
    flushSync(() => setPageWidth(chosenWidth));
    holdAnchor(anchor);
    const article = pageRoot.current?.querySelector<HTMLElement>(".reader-text");
    if (!article) return;
    let frame = requestAnimationFrame(function follow() {
      holdAnchor(anchor);
      frame = requestAnimationFrame(follow);
    });
    const settled = (e: TransitionEvent) => {
      if (e.target === article && e.propertyName === "max-width") stop(true);
    };
    const timer = setTimeout(() => stop(true), WIDTH_FOLLOW_MAX_MS);
    const stop = (hold: boolean) => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      article.removeEventListener("transitionend", settled);
      if (hold) holdAnchor(anchor);
      stopWidthFollow.current = () => {};
    };
    article.addEventListener("transitionend", settled);
    stopWidthFollow.current = stop;
  }, [chosenWidth, pageWidth]);
  // A page turn or leaving the reader ends the hold; the new page keeps its own scroll.
  useEffect(() => () => stopWidthFollow.current(false), [position]);

  /** Changes the text size, keeping the reader's place on the page. */
  const resize = ({ scale, pointer }: { scale: number; pointer: Point | null }) => {
    if (scale === latestScale.current) return;
    pendingAnchor.current = pickAnchor(pointer);
    latestScale.current = scale;
    setTextScale(scale);
  };

  /** Sets the text size from a shortcut and briefly shows the new size. */
  const zoomTo = ({ scale, pointer = null }: { scale: number; pointer?: Point | null }) => {
    resize({ scale, pointer });
    setZoomShown(true);
    clearTimeout(zoomTimer.current);
    zoomTimer.current = setTimeout(() => setZoomShown(false), ZOOM_SHOWN_MS);
  };
  const zoomBy = ({ by, pointer = null }: { by: 1 | -1; pointer?: Point | null }) => zoomTo({ scale: stepScale({ scale: latestScale.current, by }), pointer });

  // Ctrl+wheel (and trackpad pinch, which arrives as one) steps the text size too, holding the word under the pointer.
  const wheelZoom = useRef({ zoomBy, owed: 0 });
  wheelZoom.current.zoomBy = zoomBy;
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey || (e.target instanceof Element && e.target.closest("[data-scan]"))) return;
      e.preventDefault();
      const z = wheelZoom.current;
      z.owed += e.deltaY;
      if (Math.abs(z.owed) < WHEEL_STEP) return;
      z.zoomBy({ by: z.owed < 0 ? 1 : -1, pointer: { x: e.clientX, y: e.clientY } });
      z.owed = 0;
    };
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => window.removeEventListener("wheel", onWheel);
  }, []);

  // Focus mode: the top bar, rail and scrubber step aside while reading, unless something needs them.
  const focusMode = useFocusMode();
  const [selecting, setSelecting] = useState(false);
  useEffect(() => {
    const onChange = () => setSelecting(!(window.getSelection()?.isCollapsed ?? true));
    document.addEventListener("selectionchange", onChange);
    return () => document.removeEventListener("selectionchange", onChange);
  }, []);
  const chrome = useChromeHover();
  const chromeHover = chrome.props;
  // Ask AI from a selection shows the panel even while the bars are away, until the pointer has been in it and left.
  const [askShown, setAskShown] = useState(false);
  if (askShown && !panelOpen) setAskShown(false);
  if (askShown && chrome.pointerIn) setAskShown(false);
  const focusOn = focusMode.choice !== "off";
  const focused = useFocusChrome({
    mode: focusMode.choice,
    held: menuOpen || chrome.pointerIn || chrome.keyboardIn || askShown || (!wide && (contentsOpen || panelOpen)),
    textHeld: toolbar !== null || noteEditor !== null || selecting,
  });
  // A panel toggled while the bars are away waits for them to come back, so nothing moves on screen until then.
  const contentsShown = useSteadyWhileHidden({ value: contentsOpen, hidden: focused });
  const panelShown = useSteadyWhileHidden({ value: panelOpen, hidden: focused });
  // In focus mode the panels keep their space but step out of sight, so the page shifts to the middle of the window.
  const balance = pageBalance({
    focusOn,
    wide,
    scanBeside: showScan && !!page.data,
    contentsWidth: contentsShown ? contentsWidth : 0,
    sideWidth: panelShown ? sideWidth : 0,
  });
  const panelRoom = wide && focused && panelShown ? sideWidth : 0;

  const bookmarkList = (open: (position: number) => void) => (
    <BookmarkList
      bookId={bookId}
      bookmarks={bookmarks.data ?? []}
      pages={book.data?.pages ?? []}
      current={position}
      showHarakat={showHarakat}
      onOpen={open}
      onRename={renameBookmark}
      onDelete={removeBookmark}
    />
  );

  const togglePanels = () => {
    const open = !(contentsOpen || panelOpen);
    setContentsOpen(open);
    // A narrow window shows one sheet at a time.
    if (wide || !open) setPanelOpen(open);
  };

  /** At either end of the book a page key does nothing here, and keeps its own job of scrolling the page. */
  const turnTo = (next: number) => {
    if (next < 1 || next > total || next === position) return false;
    go(next);
  };

  /** Esc has something else to close first. A menu or popover may already have closed itself on this Esc, before the reader sees it. */
  const escapeTaken = (e: KeyboardEvent) =>
    menuOpen ||
    toolbar !== null ||
    noteEditor !== null ||
    find.open ||
    focusInNoteEditor() ||
    (e.target instanceof Element && e.target.closest("[data-slot=popover-content], [role=dialog], [role=toolbar]") !== null);

  useKeybindings({
    scope: "route",
    handlers: {
      // Ctrl with =, - or 0 sizes the page's text instead of zooming the whole window.
      "text.bigger": () => zoomBy({ by: 1 }),
      "text.smaller": () => zoomBy({ by: -1 }),
      "text.reset": () => zoomTo({ scale: 1 }),
      "find.open": openFind,
      "bookmark.toggle": toggleBookmark,
      "contents.toggle": () => setContentsOpen(!contentsOpen),
      "panel.toggle": () => setPanelOpen(!panelOpen),
      "panels.toggle": togglePanels,
      "edit.undo": () => step("undo"),
      "edit.redo": () => step("redo"),
      // F is a letter in the harakat editor and the note editor.
      "focus.toggle": () => {
        if (target !== null || focusInNoteEditor()) return false;
        focusMode.toggle();
      },
      "focus.leave": (e) => {
        if (focusMode.choice !== "locked" || escapeTaken(e)) return false;
        focusMode.toggle();
      },
      // Right-to-left book: the next page is to the left.
      "page.next": () => turnTo(position + 1),
      "page.previous": () => turnTo(position - 1),
      "selection.all": () => selectPage(),
      "region.left": () => moveRegion(-1),
      "region.right": () => moveRegion(1),
      "selection.extendLeft": () => extendSelection({ direction: "left", granularity: "word" }),
      "selection.extendRight": () => extendSelection({ direction: "right", granularity: "word" }),
      "selection.extendUp": () => extendSelection({ lines: -1 }),
      "selection.extendDown": () => extendSelection({ lines: 1 }),
      "selection.extendStart": () => extendSelection({ direction: "backward", granularity: "lineboundary" }),
      "selection.extendEnd": () => extendSelection({ direction: "forward", granularity: "lineboundary" }),
      "harakat.toggle": () => setShowHarakat(!showHarakat),
      "scan.toggle": () => setShowScan(!showScan),
      "reader.dismiss": () => {
        setMenuOpen(false);
        if (find.open && !toolbar && !noteEditor && !menuOpen) closeFind();
        dismiss();
      },
    },
  });

  /** Keys while a letter is targeted. Returns false for keys it leaves to the page. */
  const letterKeys = ({ e, target, page }: { e: KeyboardEvent; target: LetterRef; page: StoredPage["page"] }) => {
    const mark = markFromKey(e);
    if (mark) typeMark(target, mark);
    else if (e.key === "Backspace" || e.key === "Delete") {
      editMarks(target, "");
    }
    // Right to left: the next letter is to the left.
    else if (e.key === "ArrowLeft") setTarget(moveTarget({ page, target, delta: 1 }));
    else if (e.key === "ArrowRight") setTarget(moveTarget({ page, target, delta: -1 }));
    else if (e.key === "Escape") setTarget(null);
    else return false;
    return true;
  };

  // A targeted letter takes the keys it types or moves with before the page does.
  useKeybindings({
    scope: "popover",
    enabled: target !== null && !!page.data,
    handlers: {},
    fallback: (e) => !(e.metaKey || e.ctrlKey || e.altKey) && target !== null && !!page.data && letterKeys({ e, target, page: page.data.page }),
  });


  if (book.isSuccess && book.data === null) {
    const elsewhere = waiting.data?.some((b) => b.bookId === bookId);
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-ink-2">
        {elsewhere ? "This book is in your library on another device. Import it from the Library to read it here." : "This book isn't in your library."}
        <Link to="/" viewTransition className="text-accent">
          Back to Library
        </Link>
      </div>
    );
  }


  const contentsSize = {
    width: contentsWidth,
    // The minimum wins over the share of the window, so the header always fits.
    onResize: (w: number) => setContentsWidth(Math.round(Math.max(Math.min(w, CONTENTS_MAX, window.innerWidth * 0.4), CONTENTS_MIN))),
    onResetSize: () => setContentsWidth(CONTENTS_WIDTH),
    onClose: () => setContentsOpen(false),
  };

  const sidePanel = (
    <AnnotationsPanel
      tab={panelTab}
      onTab={(tab) => {
        setPanelTab(tab);
        if (tab !== "ask") setAnnotationsTab(tab);
      }}
      annotations={annotations.data}
      onClose={() => setPanelOpen(false)}
      onGoTo={(span) => {
        if (!wide) setPanelOpen(false);
        revealSpans({ root: pageRoot.current, spans: [span] });
      }}
      onRemoveHighlight={removeHighlight}
      onDeleteNote={(id) => void noteWrites.remove(id)}
      onUpdateNote={(input) => void noteWrites.update(input)}
      onEditingNote={setPanelEditTint}
      pageLabel={arabicNumber(page.data?.number ?? position)}
      draft={noteDraft?.position === position ? noteDraft.draft : null}
      onDraft={(draft) => setNoteDraft(draft && { position, draft })}
      onAddNote={(input) => void noteWrites.create(input)}
      width={sideWidth}
      onResize={(w) => setSideWidth(Math.round(Math.max(Math.min(w, window.innerWidth * 0.6), PANEL_MIN)))}
      onResetSize={() => (asking ? setAskWidth(null) : setPanelWidth(PANEL_WIDTH))}
      askHeader={<AskHeader conversation={conversation} />}
      askPanel={
        <AskPanel
          bookId={bookId}
          conversation={conversation}
          position={position}
          pageNumber={page.data?.number ?? position}
          selection={askSelection}
          onClearSelection={() => setAskSelection(null)}
          onCite={citeLines}
          onSaveNote={(turn, body) => {
            void midad["notes.add"]({ bookId, position: turn.position, span: turn.selection.span, body }).then(() =>
              Promise.all([
                client.invalidateQueries({ queryKey: keys.annotations(bookId, turn.position) }),
                client.invalidateQueries({ queryKey: keys.bookMarks(bookId) }),
              ]),
            );
          }}
        />
      }
    />
  );

  return (
    // Clipped: the bars focus mode moves out of view would otherwise overflow the window and give the document a scrollbar of its own.
    <div className="relative flex h-full flex-col overflow-clip">
      <ZoomLevel scale={textScale} shown={zoomShown} />
      {focusOn && (
        <FocusTrace shown={focused} progress={total ? position / total : 0} />
      )}
      {removal && (
        <Toast key={removal.id} onDone={() => setRemoval(null)}>
          <span className="flex items-center gap-3">
            {removal.message}
            <ToastAction onClick={() => step("undo")}>Undo</ToastAction>
            <span className="text-xs opacity-60">{shortcutKeys("edit.undo")}</span>
          </span>
        </Toast>
      )}
      {/* z-20: the view-transition name makes the header its own stacking layer, and its display menu must sit above the page. */}
      <header
        {...chromeHover}
        data-focus={focused ? "hidden" : undefined}
        className="relative z-20 flex h-15 shrink-0 items-center gap-2 border-b border-line bg-bg px-4 transition-[translate,opacity] duration-panel ease-sheet [view-transition-name:reader-header] data-[focus=hidden]:pointer-events-none data-[focus=hidden]:-translate-y-full data-[focus=hidden]:opacity-0 motion-reduce:transition-opacity"
      >
        <Link to="/" viewTransition aria-label="Back to Library" onClick={() => markClosingBook(bookId)}>
          <IconButton icon={ArrowLeft} label="Back to Library" tabIndex={-1} />
        </Link>
        <IconButton
          icon={contentsOpen ? PanelLeftClose : PanelLeftOpen}
          label={withShortcut({ label: contentsOpen ? "Hide contents" : "Show contents", command: "contents.toggle" })}
          onClick={() => setContentsOpen(!contentsOpen)}
        />
        <div className="flex min-w-0 flex-col">
          {book.data ? (
            <>
              <span className="ar truncate text-ar-small font-bold leading-6">{book.data.title}</span>
              <span className="ar truncate text-xs text-ink-3">{[book.data.author, book.data.edition].filter(Boolean).join(" · ")}</span>
            </>
          ) : (
            <Skeleton className="h-4 w-48" />
          )}
        </div>
        <div className="absolute left-1/2 flex -translate-x-1/2 items-center gap-1">
          <IconButton icon={ChevronLeft} label="Next page" onClick={() => go(position + 1)} disabled={position >= total} />
          <span className="min-w-20 text-center text-sm font-medium tabular-nums [view-transition-name:page-counter]">
            {position} of {total || "–"}
          </span>
          <IconButton icon={ChevronRight} label="Previous page" onClick={() => go(position - 1)} disabled={position <= 1} />
        </div>
        <div className="flex-1" />
        <UpdateNotice placement="toolbar" />
        <DevicesIndicator
          placement="toolbar"
          bookReturn={() => (book.data ? { bookId, title: book.data.title, position, scrollTop: pageRoot.current?.scrollTop ?? 0 } : undefined)}
        />
        <IconButton
          icon={Bookmark}
          label={withShortcut({ label: pageBookmark ? "Remove bookmark" : "Bookmark page", command: "bookmark.toggle" })}
          selected={pageBookmark !== null}
          onClick={toggleBookmark}
          className={cx("[&_svg]:transition-[fill,scale] [&_svg]:duration-pop [&_svg]:ease-out motion-reduce:[&_svg]:transition-none", pageBookmark && "[&_svg]:fill-current")}
        />
        <IconButton
          icon={Search}
          label={find.open ? "Close find" : shortcutLabel("find.open")}
          selected={find.open}
          onClick={() => (find.open ? closeFind() : openFind())}
        />
        <DisplayMenu
          open={menuOpen}
          onOpenChange={setMenuOpen}
          textScale={textScale}
          onTextScale={(scale) => resize({ scale, pointer: null })}
          bookReturn={() => (book.data ? { bookId, title: book.data.title, position, scrollTop: pageRoot.current?.scrollTop ?? 0 } : undefined)}
        />
        <IconButton icon={FileImage} label={withShortcut({ label: showScan ? "Hide scan" : "Show scan", command: "scan.toggle" })} selected={showScan} onClick={() => setShowScan(!showScan)} />
        <div className="mx-2 h-6 w-px bg-line" />
        <IconButton
          icon={NotebookPen}
          label={withShortcut({ label: panelOpen && panelTab !== "ask" ? "Hide highlights and notes" : "Show highlights and notes", command: "panel.toggle" })}
          selected={panelOpen && panelTab !== "ask"}
          onClick={() => {
            if (panelOpen && panelTab !== "ask") setPanelOpen(false);
            else {
              if (panelTab === "ask") switchPanelTab(annotationsTab);
              setPanelOpen(true);
            }
          }}
        />
        <IconButton
          icon={Sparkles}
          label={panelOpen && panelTab === "ask" ? "Hide Ask AI" : "Ask AI"}
          selected={panelOpen && panelTab === "ask"}
          onClick={() => (panelOpen && panelTab === "ask" ? setPanelOpen(false) : openAsk(null))}
        />
      </header>

      <div className="flex min-h-0 flex-1">
        {wide ? (
          <InlinePanel side="left" open={contentsShown} width={contentsWidth}>
            <div
              {...chromeHover}
              data-region="contents"
              data-focus={focused ? "hidden" : undefined}
              className="flex transition-[translate,opacity] duration-panel ease-sheet data-[focus=hidden]:pointer-events-none data-[focus=hidden]:-translate-x-full data-[focus=hidden]:opacity-0 motion-reduce:transition-opacity"
            >
              <ContentsRail entries={toc} active={activeEntries} onGo={go} tab={sidebarTab} onTab={setSidebarTab} bookmarks={bookmarkList(go)} {...contentsSize} />
            </div>
          </InlinePanel>
        ) : (
          <SideSheet side="left" title="Contents" open={contentsOpen} onOpenChange={setContentsOpen}>
            <ContentsRail
              entries={toc}
              active={activeEntries}
              tab={sidebarTab}
              onTab={setSidebarTab}
              {...contentsSize}
              bookmarks={bookmarkList((at) => {
                setContentsOpen(false);
                go(at);
              })}
              onGo={(at) => {
                setContentsOpen(false);
                go(at);
              }}
            />
          </SideSheet>
        )}
        {/* The scan sits beside the text, or replaces it when there isn't room for both. */}
        <div className="@container flex min-w-0 flex-1">
        <div className={cx("relative flex min-w-0 flex-1 flex-col", showScan && page.data && "@max-2xl:hidden")}>
        <FindBar
          state={find}
          count={findMatches.length}
          focusKey={findFocus}
          onChange={(next) => setFind((f) => ({ ...f, ...next }))}
          onStep={stepMatch}
          onClose={closeFind}
        />
        <div
          ref={pageRoot}
          data-region="page"
          tabIndex={-1}
          className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden outline-hidden [scrollbar-gutter:stable_both-edges]"
          onMouseDown={onMouseDown}
          onMouseUp={onSelectionEnd}
          onCopy={() => {
            const root = pageRoot.current;
            const picked = root && spanFromSelection(root);
            if (picked) rememberCopy({ text: window.getSelection()?.toString() ?? "", span: picked.span, position });
          }}
          onMouseLeave={() => noteEditor && scheduleNoteClose()}
          onScroll={() => {
            measureOnScreen();
            schedulePlaceSave();
            rememberPlace();
            if (toolbar) setToolbar(null);
          }}
        >
          {/* Even padding keeps the page centred; it leaves room for the last-read marker in the right margin. The bottom padding lets the last line scroll clear of the scrubber, which overlays the page and slides away in focus mode. */}
          {/* While the bars are away the side panel folds up so the scrollbar meets the window edge; this margin keeps its room, so the page doesn't move. */}
          <div style={{ marginRight: panelRoom }} className="@container transition-[margin-right] duration-panel ease-sheet motion-reduce:transition-none">
          <div
            data-page-area
            data-balance={balance === null ? undefined : ""}
            style={{ "--balance": `${balance ?? 0}px` } as CSSProperties}
            className="px-6 pt-10 pb-34 [view-transition-name:reader-page] @3xl:px-30"
          >
          {page.isPending && (
            <div className="mx-auto flex w-full max-w-160 flex-col gap-4">
              <Skeleton className="h-4 w-full" />
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          )}
          {page.error && <p className="text-center text-sm text-danger">Couldn't open this page: {page.error.message}</p>}
          {page.data === null && book.data && <p className="text-center text-sm text-ink-3">This book has no pages yet. Sync it from the Library.</p>}
          {page.data && (
            <PageView
              stored={page.data}
              chapter={chapterTitle}
              width={pageWidth}
              highlightStyle={highlightStyle}
              freshHighlight={freshHighlight}
              annotations={annotations.data ?? { highlights: [], notes: [], pageNote: null, harakat: [] }}
              display={{ showHarakat, showMine, lineNumbers, textScale, target, glosses, hashiyaMarkers, noteIcons }}
              tinted={tinted}
              dimNoteMarks={focusOn}
              noteMarkHandlers={noteMarkHandlers}
              onAddLineNote={startLineNote}
              onPageNote={openPageNote}
              marker={marker.data?.position === position ? marker.data : null}
              onMark={markRow}
              onClearMark={() => void edits().setMarker({ before: markerAt(), after: null })}
              onWordHover={onWordHover}
              onWordClick={onWordClick}
              ribbon={
                book.data && (
                  <BookmarkRibbon
                    key={position}
                    bookmark={pageBookmark}
                    folio={bookmarkFolio({ position, pages: book.data.pages })}
                    onRename={(name) => pageBookmark && renameBookmark({ bookmark: pageBookmark, name })}
                    onRemove={() => pageBookmark && removeBookmark(pageBookmark)}
                  />
                )
              }
            />
          )}
          </div>
          </div>
        </div>
        {book.data && total > 0 && (
          <div
            {...chromeHover}
            data-focus={focused ? "hidden" : undefined}
            className="absolute inset-x-0 bottom-0 z-10 h-24 bg-bg px-6 transition-[translate,opacity] [view-transition-name:page-scrubber] duration-panel ease-sheet data-[focus=hidden]:pointer-events-none data-[focus=hidden]:translate-y-full data-[focus=hidden]:opacity-0 motion-reduce:transition-opacity"
          >
            <div className={cx("mx-auto h-full transition-[max-width] duration-slide ease-move motion-reduce:transition-none", pageWidth === "wide" ? "max-w-190" : "max-w-160")}>
              <PageScrubber
                bookId={bookId}
                pages={book.data.pages}
                entries={toc}
                marks={bookMarks.data}
                position={position}
                markerAt={marker.data?.position ?? null}
                bookmarks={bookmarks.data}
                onGo={go}
              />
            </div>
          </div>
        )}
        </div>
        <ScanSlot open={showScan && !!page.data}>
          {page.data && <ScanPane bookId={bookId} fileId={page.data.fileId} onClose={() => setShowScan(false)} />}
        </ScanSlot>
        </div>
        {wide ? (
          <InlinePanel side="right" open={panelShown && !focused} width={sideWidth}>
            <div
              {...chromeHover}
              data-region="side"
              data-focus={focused ? "hidden" : undefined}
              className="flex transition-[translate,opacity] duration-panel ease-sheet data-[focus=hidden]:pointer-events-none data-[focus=hidden]:translate-x-full data-[focus=hidden]:opacity-0 motion-reduce:transition-opacity"
            >
              {sidePanel}
            </div>
          </InlinePanel>
        ) : (
          <SideSheet side="right" title={panelTab === "ask" ? "Ask AI" : "Highlights and notes"} open={panelOpen} onOpenChange={setPanelOpen}>
            {sidePanel}
          </SideSheet>
        )}
      </div>


      {lastToolbar.current &&
        (() => {
          const shown = lastToolbar.current;
          return (
            <SelectionToolbar
              open={toolbar !== null}
              rect={shown.rect}
              mode={shown.mode}
              onDismiss={() => setToolbar(null)}
              onHighlight={(color) => {
                if (shown.mode === "selection") void edits().addHighlight({ span: shown.span, color }).then(drawIn);
                finishToolbar();
              }}
              onRemoveHighlight={() => {
                if (shown.mode === "highlight") removeHighlight(shown.highlight.id);
                finishToolbar();
              }}
              onNote={openNoteFromToolbar}
              onClearHighlights={(() => {
                if (shown.mode !== "selection") return undefined;
                const touched = (annotations.data?.highlights ?? []).filter((h) => !h.stale && spansOverlap(h.span, shown.span));
                if (touched.length === 0) return undefined;
                return () => {
                  void edits().clearHighlights(touched.map((h) => ({ id: h.id, span: h.span, color: h.color })));
                  announceRemoval(touched.length === 1 ? "Highlight removed" : `${touched.length} highlights removed`);
                  finishToolbar();
                };
              })()}
              onClearHarakat={
                shown.mode === "selection" && annotations.data?.harakat.some((h) => !h.stale && spanContains({ span: shown.span, part: h.part, ref: h }))
                  ? () => {
                      void edits().clearMarks(shown.span);
                      announceRemoval("Your harakat cleared");
                      finishToolbar();
                    }
                  : undefined
              }
              onCopy={() => {
                if (shown.mode === "selection") {
                  void navigator.clipboard.writeText(shown.text);
                  rememberCopy({ text: shown.text, span: shown.span, position });
                }
                finishToolbar();
              }}
              onAsk={() => {
                if (shown.mode === "selection") openAsk({ span: shown.span, text: page.data ? quoteSpan({ page: page.data.page, span: shown.span }) : shown.text, position });
                finishToolbar();
              }}
            />
          );
        })()}
      {lastNote.current && (
        <NoteLayer
          rect={lastNote.current.rect}
          open={noteEditor !== null}
          onClose={() => setNoteEditor(null)}
          onPointerInside={(inside) => {
            pointerInNote.current = inside;
            if (inside) {
              clearTimeout(closeTimer.current);
              leftNote.current = false;
            }
            // A note being written stays until it's saved, dismissed or clicked away from.
            else if (noteEditor?.mode !== "edit") scheduleNoteClose({ left: true });
          }}
        >
          {(() => {
            const shown = lastNote.current;
            const lineLabel = spanLabel(shown.span).toLowerCase();
            if (shown.mode === "row" && shown.row)
              return (
                <NoteRowPeek
                  notes={shown.row}
                  onTint={setEntryTint}
                  onEdit={(note) => {
                    setEntryTint(null);
                    setNoteEditor({ note, span: note.span, rect: shown.rect, mode: "edit" });
                  }}
                />
              );
            return shown.mode === "peek" && shown.note ? (
              <NotePeek key={shown.note.id} note={shown.note} lineLabel={lineLabel} onEdit={() => setNoteEditor({ ...shown, mode: "edit" })} />
            ) : (
              <NoteEditor
                key={shown.note?.id ?? "new"}
                note={shown.note}
                savedBody={shown.note ? annotations.data?.notes.find((n) => n.id === shown.note?.id)?.body : undefined}
                lineLabel={lineLabel}
                onCreate={(body) => noteWrites.create({ span: shown.span, body })}
                onUpdate={noteWrites.update}
                onDelete={noteWrites.remove}
                onClose={() => setNoteEditor(null)}
              />
            );
          })()}
        </NoteLayer>
      )}
    </div>
  );
};
