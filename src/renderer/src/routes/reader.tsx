import { ArrowLeft, Bookmark, ChevronLeft, ChevronRight, FileImage, Minus, NotebookPen, PanelLeftClose, PanelLeftOpen, Plus, Sparkles, Type } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { type Highlight, type LetterRef, lineText, type Note, type Part, quoteSpan, type Span, spanContains, spansOverlap, wordsOf } from "../../../shared/annotations";
import { isArabicLetter, lettersOf, markFromKey, mergeMarks } from "../../../shared/harakat";
import type { BookDetail, StoredPage } from "../../../shared/library";
import { InlinePanel, SideSheet } from "../components/side-sheet";
import { useMediaQuery } from "../lib/media";
import { NoteEditor, NoteLayer, NotePeek, SelectionToolbar } from "../components/annotation-popovers";
import { AnnotationsPanel, type PanelTab, spanLabel } from "../components/annotations-panel";
import { type AskSelection, AskPanel, useAskConversation } from "../components/ask-panel";
import { ScanPane } from "../components/scan-pane";
import { caretNear, letterAtSelectionStart, PageView, rowOfWord, screenRows, selectionCoversWord, selectSpan, spanFromSelection, type WordTarget } from "../components/page-view";
import { IconButton, Kbd, Skeleton, Switch, Toast, cx } from "../components/ui";
import { rememberCopy } from "../lib/copied";
import { entryIndexFor, visibleEntries } from "../lib/contents";
import { arabicNumber } from "../lib/format";
import { createUndoStack, type MarkerAt, type UndoStack } from "../lib/undo";
import { midad, keys, readPref, useAnnotationActions, useAnnotations, useBook, useMarker, usePage, useSetMarker, writePref } from "../lib/midad";

interface TocEntry {
  /** The page number printed in the book, when the page has one. */
  number: number | null;
  text: string;
  level: number;
  position: number;
}

/** Chapter headings across the book; falls back to running headers for books without headings. */
const tableOfContents = (book: BookDetail): TocEntry[] => {
  const headings = book.pages.flatMap((p) =>
    p.headings.map((h) => ({ text: h.text, level: h.level, position: p.position, number: p.number })),
  );
  if (headings.length > 0) return headings;
  return book.pages
    .filter((p, i) => p.header && p.header !== book.pages[i - 1]?.header)
    .map((p) => ({ text: p.header ?? "", level: 2, position: p.position, number: p.number }));
};

/** Matches the contents rail's w-62. */
const CONTENTS_WIDTH = 248;
const PANEL_WIDTH = 400;
/** Ask AI opens wider than highlights and notes, until the reader sizes it themselves. */
const ASK_WIDTH = 560;
const ASK_EXTRA = 120;

const usePref = <T,>({ key, fallback }: { key: string; fallback: T }) => {
  const [value, setValue] = useState<T>(() => readPref({ key, fallback }));
  const update = useCallback(
    (next: T) => {
      setValue(next);
      writePref({ key, value: next });
    },
    [key],
  );
  return [value, update] as const;
};

type Toolbar =
  | { mode: "selection"; span: Span; rect: DOMRect; text: string }
  | { mode: "highlight"; highlight: Highlight; rect: DOMRect };

interface NoteState {
  note: Note | null;
  span: Span;
  rect: DOMRect;
  /** Hovering shows a read-only peek; clicking it (or adding a note) edits. */
  mode: "peek" | "edit";
}

const focusInNoteEditor = () => document.activeElement?.closest('[role="dialog"][aria-label="Note"]') != null;

/** Scrolls a span into view and briefly tints its words, for jumping from the panel (and later, AI citations). */
const REVEAL_TINT: Keyframe[] = [
  { backgroundColor: "var(--color-accent-soft)" },
  { backgroundColor: "var(--color-accent-soft)", offset: 0.6 },
  { backgroundColor: "transparent" },
];

/**
 * Tints words for a moment, along with the spaces between neighbouring words
 * so the tint reads as one band. Each word sits in a wrapper; a space is the
 * wrapper's next sibling.
 */
const tintWords = (words: HTMLElement[]) => {
  words.forEach((el, i) => {
    const gap = el.parentElement?.nextElementSibling;
    const nextWrapper = words[i + 1]?.parentElement;
    const tinted = gap && nextWrapper && gap.nextElementSibling === nextWrapper ? [el, gap] : [el];
    for (const target of tinted) target.animate(REVEAL_TINT, { duration: 3000, easing: "ease-out" });
  });
};

const revealSpan = ({ root, span }: { root: HTMLElement | null; span: Span }) => {
  if (!root) return;
  const words = [...root.querySelectorAll<HTMLElement>(`[data-part="${span.part}"][data-w]`)].filter((el) => {
    const line = Number(el.dataset.line);
    const word = Number(el.dataset.w);
    const afterStart = line > span.start.line || (line === span.start.line && word >= span.start.word);
    const beforeEnd = line < span.end.line || (line === span.end.line && word <= span.end.word);
    return afterStart && beforeEnd;
  });
  words[0]?.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  tintWords(words);
};

interface LineRange {
  part: Part;
  from: number;
  to: number;
}

/** An Ask AI citation or pasted quote: whole lines, or with `words`, part of one line. */
type Citation = LineRange & { words: { from: number; to: number } | null };

const revealCitation = ({ root, cite }: { root: HTMLElement | null; cite: Citation }) => {
  if (!cite.words) return revealLines({ root, ...cite });
  revealSpan({ root, span: { part: cite.part, start: { line: cite.from, word: cite.words.from }, end: { line: cite.from, word: cite.words.to } } });
};

/** Scrolls to some lines and tints them for a moment. */
const revealLines = ({ root, part, from, to }: LineRange & { root: HTMLElement | null }) => {
  const blocks: HTMLElement[] = [];
  for (let line = from; line <= to; line += 1) {
    const el = root?.querySelector<HTMLElement>(`[data-line-block="${part}-${line}"]`);
    if (el) blocks.push(el);
  }
  blocks[0]?.scrollIntoView({ block: "center" });
  for (const el of blocks) {
    el.animate(
      [
        { backgroundColor: "var(--color-accent-soft)", boxShadow: "0 0 0 0.75rem var(--color-accent-soft)" },
        { backgroundColor: "var(--color-accent-soft)", boxShadow: "0 0 0 0.75rem var(--color-accent-soft)", offset: 0.6 },
        { backgroundColor: "transparent", boxShadow: "0 0 0 0.75rem transparent" },
      ],
      { duration: 3000, easing: "ease-out" },
    );
  }
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

const ContentsRail = ({
  entries,
  active,
  markerAt,
  onGo,
}: {
  entries: TocEntry[];
  /** The entries whose text is on screen. */
  active: number[];
  markerAt: number | null;
  onGo: (position: number) => void;
}) => {
  const markerIndex = markerAt === null ? -1 : entryIndexFor(entries, markerAt);
  return (
    <nav aria-label="Contents" className="flex w-62 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-line bg-surface-2 px-4 py-6">
      <h2 className="mb-2 px-2.5 text-overline font-semibold uppercase tracking-widest text-ink-3">Contents</h2>
      {entries.length === 0 && <p className="px-2.5 text-xs text-ink-3">This book has no chapter headings.</p>}
      {entries.map((e, i) => (
        <button
          key={`${e.position}-${i}`}
          type="button"
          aria-current={active.includes(i) ? "location" : undefined}
          onClick={() => onGo(e.position)}
          className={cx(
            "flex items-center gap-2 rounded-lg px-2.5 py-1 text-left transition-colors",
            active.includes(i) ? "bg-accent-soft text-accent" : "text-ink-2 hover:bg-surface hover:text-ink",
            e.level > 2 && "pl-5",
          )}
        >
          <span className="ar text-ar-small text-ink-3">{arabicNumber(e.number ?? e.position)}</span>
          {i === markerIndex && <Bookmark aria-label="Last read" className="size-3.5 text-accent" />}
          <span className="ar flex-1 text-right text-ar-small">{e.text}</span>
        </button>
      ))}
    </nav>
  );
};

/** The text sizes the reader steps through, as multiples of the normal size. */
const TEXT_SCALES = [0.875, 1, 1.125, 1.25, 1.5, 1.75, 2];
const SMALLEST = 0.875;
const LARGEST = 2;
/** Wheel distance per text size step; one mouse notch is usually 100. */
const WHEEL_STEP = 100;
const ZOOM_SHOWN_MS = 1200;

/** The text size, shown for a moment under the top bar after a shortcut changes it. */
const ZoomLevel = ({ scale, shown }: { scale: number; shown: boolean }) => (
  <div
    role="status"
    data-state={shown ? "open" : "closed"}
    className="pointer-events-none fixed top-18 right-4 z-30 flex items-center gap-2 rounded-xl bg-surface-3 px-3 py-1.5 text-sm shadow-float transition-[opacity,translate] duration-pop ease-out data-[state=closed]:-translate-y-1 data-[state=closed]:opacity-0 data-[state=closed]:duration-pop-exit motion-reduce:transition-opacity"
  >
    <Type aria-hidden className="size-4 text-ink-3" />
    <span className="text-ink-2">Text size</span>
    <span className="font-medium tabular-nums">{Math.round(scale * 100)}%</span>
  </div>
);

const stepScale = ({ scale, by }: { scale: number; by: 1 | -1 }) => {
  const at = TEXT_SCALES.findIndex((s) => s >= scale);
  const index = Math.min(Math.max((at === -1 ? TEXT_SCALES.length - 1 : at) + by, 0), TEXT_SCALES.length - 1);
  return TEXT_SCALES[index] ?? 1;
};

const TextSize = ({ scale, onScale }: { scale: number; onScale: (v: number) => void }) => (
  <div className="flex items-center gap-3">
    <div className="flex flex-1 flex-col gap-0.5">
      <span className="text-sm font-medium">Text size</span>
      <span className="text-xs text-ink-3">The page's Arabic text</span>
    </div>
    <div className="flex items-center gap-1">
      <IconButton icon={Minus} label="Smaller text (Ctrl+−)" disabled={scale <= SMALLEST} onClick={() => onScale(stepScale({ scale, by: -1 }))} />
      <button
        type="button"
        title="Reset to normal size (Ctrl+0)"
        onClick={() => onScale(1)}
        className="w-12 rounded-md py-1 text-center text-sm tabular-nums text-ink-2 hover:bg-ink/6"
      >
        {Math.round(scale * 100)}%
      </button>
      <IconButton icon={Plus} label="Larger text (Ctrl+=)" disabled={scale >= LARGEST} onClick={() => onScale(stepScale({ scale, by: 1 }))} />
    </div>
  </div>
);

const DisplayMenu = ({
  textScale,
  onTextScale,
  lineNumbers,
  onLineNumbers,
  showHarakat,
  onShowHarakat,
  showMine,
  onShowMine,
}: {
  textScale: number;
  onTextScale: (v: number) => void;
  lineNumbers: boolean;
  onLineNumbers: (v: boolean) => void;
  showHarakat: boolean;
  onShowHarakat: (v: boolean) => void;
  showMine: boolean;
  onShowMine: (v: boolean) => void;
}) => (
  <div className="absolute right-0 top-11 z-40 flex w-80 flex-col gap-3.5 rounded-xl bg-surface-3 p-4 shadow-float">
    <span className="text-sm font-medium">Text display</span>
    <TextSize scale={textScale} onScale={onTextScale} />
    <div className="flex items-center gap-3">
      <div className="flex flex-1 flex-col gap-0.5">
        <span className="text-sm font-medium">Harakat</span>
        <span className="text-xs text-ink-3">The corpus's marks and yours</span>
      </div>
      <Kbd>H</Kbd>
      <Switch label="Show harakat" checked={showHarakat} onChange={onShowHarakat} />
    </div>
    <div className={cx("ml-1 flex items-center gap-3 border-l-2 border-line pl-3", !showHarakat && "opacity-45")}>
      <div className="flex flex-1 flex-col gap-0.5">
        <span className="text-sm font-medium">My harakat</span>
        <span className="text-xs text-ink-3">
          Marks you added, in <span className="text-ink-added">red</span>
        </span>
      </div>
      <Switch label="Show my harakat" checked={showMine} onChange={onShowMine} disabled={!showHarakat} />
    </div>
    <div className="flex items-center gap-3">
      <div className="flex flex-1 flex-col gap-0.5">
        <span className="text-sm font-medium">Line numbers</span>
        <span className="text-xs text-ink-3">The numbers notes and Ask AI use</span>
      </div>
      <Switch label="Show line numbers" checked={lineNumbers} onChange={onLineNumbers} />
    </div>
    <div className="h-px bg-line" />
    <p className="text-xs text-ink-3">
      Click a letter and type a haraka with the Arabic keyboard layout. Your marks are stored separately; the corpus text is never changed.
    </p>
  </div>
);

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

export const ReaderRoute = () => {
  const { bookId = "" } = useParams();
  const [search, setSearch] = useSearchParams();
  const book = useBook(bookId);
  // Wide windows show contents and the side panel beside the text (remembered);
  // narrower ones slide them over the page, closed until asked for.
  const wide = useMediaQuery("(min-width: 80rem)");
  const [contentsPref, setContentsPref] = usePref({ key: "reader.contentsOpen", fallback: true });
  const [contentsSheet, setContentsSheet] = useState(false);
  const contentsOpen = wide ? contentsPref : contentsSheet;
  const setContentsOpen = wide ? setContentsPref : setContentsSheet;
  const [showHarakat, setShowHarakat] = usePref({ key: "reader.showHarakat", fallback: true });
  const [showMine, setShowMine] = usePref({ key: "reader.showMine", fallback: true });
  const [lineNumbers, setLineNumbers] = usePref({ key: "reader.lineNumbers", fallback: true });
  const [textScale, setTextScale] = usePref({ key: "reader.textScale", fallback: 1 });
  const [showScan, setShowScan] = usePref({ key: "reader.showScan", fallback: false });
  const [target, setTarget] = useState<LetterRef | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [panelPref, setPanelPref] = usePref({ key: "reader.panelOpen", fallback: false });
  const [panelSheet, setPanelSheet] = useState(false);
  const panelOpen = wide ? panelPref : panelSheet;
  const setPanelOpen = wide ? setPanelPref : setPanelSheet;
  const [panelWidth, setPanelWidth] = usePref({ key: "reader.panelWidth", fallback: PANEL_WIDTH });
  const [panelTab, setPanelTab] = usePref<PanelTab>({ key: "reader.panelTab", fallback: "highlights" });
  const [annotationsTab, setAnnotationsTab] = usePref<Exclude<PanelTab, "ask">>({ key: "reader.annotationsTab", fallback: "highlights" });
  const [askWidth, setAskWidth] = usePref<number | null>({ key: "reader.askWidth", fallback: null });
  const asking = panelTab === "ask";
  const sideWidth = asking ? (askWidth ?? Math.max(ASK_WIDTH, panelWidth + ASK_EXTRA)) : panelWidth;
  const setSideWidth = asking ? setAskWidth : setPanelWidth;
  const [toolbar, setToolbar] = useState<Toolbar | null>(null);
  const [removal, setRemoval] = useState<{ id: number; message: string } | null>(null);
  // Kept after closing so the toolbar can animate out with its content.
  const lastToolbar = useRef<Toolbar | null>(null);
  if (toolbar) lastToolbar.current = toolbar;
  const [noteEditor, setNoteEditor] = useState<NoteState | null>(null);
  // Kept after closing so the popover can animate out with its content.
  const lastNote = useRef<NoteState | null>(null);
  if (noteEditor) lastNote.current = noteEditor;
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
  const pendingReveal = useRef<(Citation & { position: number }) | null>(null);
  const pendingRow = useRef<{ position: number; part: Part; line: number; word: number } | null>(null);
  const conversation = useAskConversation(bookId);
  const [askSelection, setAskSelection] = useState<AskSelection | null>(null);
  const client = useQueryClient();

  const total = book.data?.pageCount ?? 0;
  const fromUrl = Number(search.get("p"));
  // Opening a book returns to its last-read marker; without one, to the last page viewed.
  const position = fromUrl >= 1 ? fromUrl : (marker.data?.position ?? book.data?.progress?.position ?? 1);
  const page = usePage({ bookId, position });
  const annotations = useAnnotations({ bookId, position });
  const actions = useAnnotationActions({ bookId, position });
  const toc = useMemo(() => (book.data ? tableOfContents(book.data) : []), [book.data]);
  const [onScreen, setOnScreen] = useState<{ position: number; lines: number[] }>({ position, lines: [] });
  const measureFrame = useRef(0);
  const measureOnScreen = useCallback(() => {
    cancelAnimationFrame(measureFrame.current);
    measureFrame.current = requestAnimationFrame(() => {
      const root = pageRoot.current;
      if (!root) return;
      setOnScreen({ position, lines: linesOnScreen(root) });
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

  useEffect(() => {
    const reveal = pendingReveal.current;
    if (reveal && page.data?.position === reveal.position) {
      pendingReveal.current = null;
      requestAnimationFrame(() => revealCitation({ root: pageRoot.current, cite: reveal }));
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
    if (at === position) revealCitation({ root: pageRoot.current, cite });
    else {
      pendingReveal.current = { position: at, ...cite };
      go(at);
    }
  };

  const openAsk = (selection: AskSelection | null) => {
    if (selection) setAskSelection(selection);
    setPanelTab("ask");
    setPanelOpen(true);
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
    closeTimer.current = setTimeout(() => {
      if (pointerInNote.current) return;
      if (leftNote.current || !focusInNoteEditor()) setNoteEditor(null);
    }, 300);
  };

  const onWordHover = (target: WordTarget, note: Note | null) => {
    if (!note) {
      if (noteEditor) scheduleNoteClose();
      return;
    }
    clearTimeout(closeTimer.current);
    if (toolbar || focusInNoteEditor() || noteEditor?.note?.id === note.id) return;
    if (noteEditor?.mode === "edit" && pointerInNote.current) return;
    setNoteEditor({ note, span: note.span, rect: target.element.getBoundingClientRect(), mode: "peek" });
  };

  const onWordClick = (word: WordTarget, highlight: Highlight | null) => {
    if (!window.getSelection()?.isCollapsed) return;
    if (word.letter !== null) {
      const ref = { part: word.part, line: word.ref.line, word: word.ref.word, letter: word.letter };
      setTarget(page.data && takesHarakat({ page: page.data.page, ref }) ? ref : null);
    }
    if (!highlight) return;
    setNoteEditor(null);
    setToolbar({ mode: "highlight", highlight, rect: word.element.getBoundingClientRect() });
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

  const onMouseDown = (e: React.MouseEvent<HTMLElement>) => {
    setMenuOpen(false);
    dismiss();
    const offText = e.target instanceof Element && !e.target.closest("[data-w], button, a, input, textarea");
    if (e.button === 0 && e.detail === 1 && offText) return startDragSelection(e);
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

  const onSelectionEnd = () => {
    const root = pageRoot.current;
    const picked = root && spanFromSelection(root);
    if (!picked) {
      if (toolbar?.mode === "selection") setToolbar(null);
      return;
    }
    setNoteEditor(null);
    setToolbar({ mode: "selection", ...picked, text: window.getSelection()?.toString() ?? "" });
    const { start, end, part } = picked.span;
    const range = window.getSelection()?.getRangeAt(0);
    const word = root.querySelector<HTMLElement>(`[data-part="${part}"][data-line="${start.line}"][data-w="${start.word}"]`);
    const insideOneWord = start.line === end.line && start.word === end.word && range && word && !selectionCoversWord({ range, word });
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
        }),
      };
    }
    return undoStack.current.stack;
  };

  const editMarks = (ref: LetterRef, after: string) => void edits().setMarks({ ref, before: mineAt(ref), after });

  const typeMark = (ref: LetterRef, typed: string) => editMarks(ref, mergeMarks({ existing: mineAt(ref), typed }));

  const announceRemoval = (message: string) => setRemoval({ id: Date.now(), message });

  const removeHighlight = (id: string) => {
    const h = annotations.data?.highlights.find((x) => x.id === id);
    if (!h) return;
    void edits().removeHighlight({ id, span: h.span, color: h.color });
    announceRemoval("Highlight removed");
  };

  const noteWrites = {
    create: async ({ span, body }: { span: Span; body: string }) => {
      return { id: await edits().addNote({ span, body }) };
    },
    update: async ({ id, body }: { id: string; body: string }) => {
      const before = annotations.data?.notes.find((n) => n.id === id)?.body ?? "";
      await edits().updateNote({ id, before, after: body });
    },
    remove: async (id: string) => {
      const n = annotations.data?.notes.find((x) => x.id === id);
      if (!n) return;
      await edits().deleteNote({ id, span: n.span, body: n.body });
      announceRemoval("Note deleted");
    },
  };

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

  useEffect(() => {
    if (book.data && position >= 1 && position <= total) {
      void midad["library.setProgress"]({ bookId, position });
    }
  }, [book.data, bookId, position, total]);

  const latestScale = useRef(textScale);
  latestScale.current = textScale;
  const [zoomShown, setZoomShown] = useState(false);
  const zoomTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(zoomTimer.current), []);
  /** Sets the text size from a shortcut and briefly shows the new size. */
  const zoomTo = (scale: number) => {
    setTextScale(scale);
    setZoomShown(true);
    clearTimeout(zoomTimer.current);
    zoomTimer.current = setTimeout(() => setZoomShown(false), ZOOM_SHOWN_MS);
  };
  const zoomBy = (by: 1 | -1) => zoomTo(stepScale({ scale: latestScale.current, by }));

  /** Ctrl with =, - or 0 sizes the page's text instead of zooming the whole window. */
  const zoomKeys = (e: KeyboardEvent) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return false;
    if (e.code === "Equal" || e.code === "NumpadAdd") zoomBy(1);
    else if (e.code === "Minus" || e.code === "NumpadSubtract") zoomBy(-1);
    else if (e.code === "Digit0" || e.code === "Numpad0") zoomTo(1);
    else return false;
    e.preventDefault();
    return true;
  };

  // Ctrl+wheel (and trackpad pinch, which arrives as one) steps the text size too.
  const wheelZoom = useRef({ zoomBy, owed: 0 });
  wheelZoom.current.zoomBy = zoomBy;
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const z = wheelZoom.current;
      z.owed += e.deltaY;
      if (Math.abs(z.owed) < WHEEL_STEP) return;
      z.zoomBy(z.owed < 0 ? 1 : -1);
      z.owed = 0;
    };
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => window.removeEventListener("wheel", onWheel);
  }, []);

  const keyHandler = useRef<(e: KeyboardEvent) => void>(() => {});
  keyHandler.current = (e: KeyboardEvent) => {
    if (zoomKeys(e)) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.target instanceof Element && e.target.closest(".sheet")) return;
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.code === "KeyZ" || e.code === "KeyY")) {
      e.preventDefault();
      step(e.code === "KeyY" || e.shiftKey ? "redo" : "undo");
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (target && page.data && letterKeys({ e, target, page: page.data.page })) {
      e.preventDefault();
      return;
    }
    pageKeys(e);
  };

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

  const pageKeys = (e: KeyboardEvent) => {
    // Right-to-left book: the next page is to the left.
    if (e.key === "ArrowLeft" || e.key === "PageDown") go(position + 1);
    else if (e.key === "ArrowRight" || e.key === "PageUp") go(position - 1);
    else if (e.code === "KeyH" && !e.shiftKey) setShowHarakat(!showHarakat);
    else if (e.code === "KeyS" && !e.shiftKey) setShowScan(!showScan);
    else if (e.key === "Escape") {
      setMenuOpen(false);
      dismiss();
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keyHandler.current(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);


  if (book.isSuccess && book.data === null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-ink-2">
        This book isn't in your library.
        <Link to="/" viewTransition className="text-accent">
          Back to Library
        </Link>
      </div>
    );
  }

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
        revealSpan({ root: pageRoot.current, span });
      }}
      onRemoveHighlight={removeHighlight}
      onDeleteNote={(id) => void noteWrites.remove(id)}
      width={sideWidth}
      onResize={(w) => setSideWidth(Math.round(Math.min(Math.max(w, 320), window.innerWidth * 0.6)))}
      onResetSize={() => (asking ? setAskWidth(null) : setPanelWidth(PANEL_WIDTH))}
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
              client.invalidateQueries({ queryKey: keys.annotations(bookId, turn.position) }),
            );
          }}
        />
      }
    />
  );

  return (
    <div className="flex h-full flex-col">
      <ZoomLevel scale={textScale} shown={zoomShown} />
      {removal && (
        <Toast key={removal.id} onDone={() => setRemoval(null)}>
          <span className="flex items-center gap-3">
            {removal.message}
            <button type="button" onClick={() => step("undo")} className="-my-1 rounded-md px-2 py-1 font-semibold hover:bg-bg/15">
              Undo
            </button>
            <span className="text-xs opacity-60">Ctrl+Z</span>
          </span>
        </Toast>
      )}
      {/* z-20: the view-transition name makes the header its own stacking layer, and its display menu must sit above the page. */}
      <header className="relative z-20 flex h-15 shrink-0 items-center gap-2 border-b border-line bg-bg px-4 [view-transition-name:reader-header]">
        <Link to="/" viewTransition aria-label="Back to Library">
          <IconButton icon={ArrowLeft} label="Back to Library" tabIndex={-1} />
        </Link>
        <IconButton
          icon={contentsOpen ? PanelLeftClose : PanelLeftOpen}
          label={contentsOpen ? "Hide contents" : "Show contents"}
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
          <span className="min-w-16 text-center text-sm font-medium tabular-nums">
            {position} / {total || "–"}
          </span>
          <IconButton icon={ChevronRight} label="Previous page" onClick={() => go(position - 1)} disabled={position <= 1} />
        </div>
        <div className="flex-1" />
        <div className="relative">
          <IconButton icon={Type} label="Text display" selected={menuOpen} onClick={() => setMenuOpen(!menuOpen)} />
          {menuOpen && (
            <DisplayMenu textScale={textScale} onTextScale={setTextScale} lineNumbers={lineNumbers} onLineNumbers={setLineNumbers} showHarakat={showHarakat} onShowHarakat={setShowHarakat} showMine={showMine} onShowMine={setShowMine} />
          )}
        </div>
        <IconButton icon={FileImage} label={showScan ? "Hide scan (S)" : "Show scan (S)"} selected={showScan} onClick={() => setShowScan(!showScan)} />
        <div className="mx-2 h-6 w-px bg-line" />
        <IconButton
          icon={NotebookPen}
          label={panelOpen && panelTab !== "ask" ? "Hide highlights and notes" : "Show highlights and notes"}
          selected={panelOpen && panelTab !== "ask"}
          onClick={() => {
            if (panelOpen && panelTab !== "ask") setPanelOpen(false);
            else {
              if (panelTab === "ask") setPanelTab(annotationsTab);
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
          <InlinePanel side="left" open={contentsOpen} width={CONTENTS_WIDTH}>
            <ContentsRail entries={toc} active={activeEntries} markerAt={marker.data?.position ?? null} onGo={go} />
          </InlinePanel>
        ) : (
          <SideSheet side="left" title="Contents" open={contentsOpen} onOpenChange={setContentsOpen}>
            <ContentsRail
              entries={toc}
              active={activeEntries}
              markerAt={marker.data?.position ?? null}
              onGo={(at) => {
                setContentsOpen(false);
                go(at);
              }}
            />
          </SideSheet>
        )}
        {/* The scan sits beside the text, or replaces it when there isn't room for both. */}
        <div className="@container flex min-w-0 flex-1">
        <div
          ref={pageRoot}
          className={cx("@container min-w-0 flex-1 overflow-y-auto overflow-x-hidden", showScan && page.data && "@max-2xl:hidden")}
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
            if (toolbar) setToolbar(null);
          }}
        >
          {/* The wide right padding leaves room for the last-read marker in the margin. */}
          <div className="px-6 py-10 [view-transition-name:reader-page] @3xl:pl-12 @3xl:pr-40">
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
              annotations={annotations.data ?? { highlights: [], notes: [], harakat: [] }}
              display={{ showHarakat, showMine, lineNumbers, textScale, target }}
              marker={marker.data?.position === position ? marker.data : null}
              onMark={markRow}
              onClearMark={() => void edits().setMarker({ before: markerAt(), after: null })}
              onWordHover={onWordHover}
              onWordClick={onWordClick}
            />
          )}
          </div>
        </div>
        {showScan && page.data && <ScanPane bookId={bookId} fileId={page.data.fileId} onClose={() => setShowScan(false)} />}
        </div>
        {wide ? (
          <InlinePanel side="right" open={panelOpen} width={sideWidth}>
            {sidePanel}
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
                if (shown.mode === "selection") void edits().addHighlight({ span: shown.span, color });
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
            else scheduleNoteClose({ left: true });
          }}
        >
          {(() => {
            const shown = lastNote.current;
            const lineLabel = spanLabel(shown.span).toLowerCase();
            return shown.mode === "peek" && shown.note ? (
              <NotePeek key={shown.note.id} note={shown.note} lineLabel={lineLabel} onEdit={() => setNoteEditor({ ...shown, mode: "edit" })} />
            ) : (
              <NoteEditor
                key={shown.note?.id ?? "new"}
                note={shown.note}
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
