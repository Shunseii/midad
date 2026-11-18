import { ArrowLeft, Bookmark, ChevronLeft, ChevronRight, NotebookPen, PanelLeftClose, PanelLeftOpen, Sparkles, Type } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { type Highlight, type LetterRef, lineText, type Note, type Part, quoteSpan, type Span, wordsOf } from "../../../shared/annotations";
import { lettersOf, markFromKey, mergeMarks } from "../../../shared/harakat";
import type { BookDetail, StoredPage } from "../../../shared/library";
import { NotePopover, SelectionToolbar } from "../components/annotation-popovers";
import { AnnotationsPanel, type PanelTab, spanLabel } from "../components/annotations-panel";
import { type AskSelection, AskPanel, useAskConversation } from "../components/ask-panel";
import { letterAtSelectionStart, PageView, selectionCoversWord, selectSpan, spanFromSelection, type WordTarget } from "../components/page-view";
import { IconButton, Kbd, Skeleton, Switch, Toast, cx } from "../components/ui";
import { arabicNumber } from "../lib/format";
import { EMPTY_HISTORY, type History, record, redo, undo } from "../lib/history";
import { hamish, keys, readPref, useAnnotationActions, useAnnotations, useBook, useMarker, usePage, useSetMarker, writePref } from "../lib/hamish";

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

interface NoteEditor {
  note: Note | null;
  span: Span;
  rect: DOMRect;
}

const focusInNoteEditor = () => document.activeElement?.closest('[role="dialog"][aria-label="Note"]') != null;

/** Scrolls a span into view and briefly tints its words, for jumping from the panel (and later, AI citations). */
const revealSpan = ({ root, span }: { root: HTMLElement | null; span: Span }) => {
  if (!root) return;
  const words = [...root.querySelectorAll<HTMLElement>(`[data-part="${span.part}"][data-w]`)].filter((el) => {
    const line = Number(el.dataset.line);
    const word = Number(el.dataset.w);
    const afterStart = line > span.start.line || (line === span.start.line && word >= span.start.word);
    const beforeEnd = line < span.end.line || (line === span.end.line && word <= span.end.word);
    return afterStart && beforeEnd;
  });
  words[0]?.scrollIntoView({ block: "center", behavior: "smooth" });
  for (const el of words) {
    el.animate(
      [{ boxShadow: "inset 0 -0.6em 0 var(--color-accent-soft)" }, { boxShadow: "inset 0 -0.6em 0 transparent" }],
      { duration: 1600, easing: "ease-out" },
    );
  }
};

interface LineRange {
  part: Part;
  from: number;
  to: number;
}

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

/** The contents entry a page falls under. */
const entryIndexFor = (entries: TocEntry[], position: number) => entries.reduce((found, e, i) => (e.position <= position ? i : found), -1);

const ContentsRail = ({
  entries,
  current,
  markerAt,
  onGo,
}: {
  entries: TocEntry[];
  current: number;
  markerAt: number | null;
  onGo: (position: number) => void;
}) => {
  const activeIndex = entryIndexFor(entries, current);
  const markerIndex = markerAt === null ? -1 : entryIndexFor(entries, markerAt);
  return (
    <nav aria-label="Contents" className="flex w-62 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-line bg-surface-2 px-4 py-6">
      <h2 className="mb-2 px-2.5 text-overline font-semibold uppercase tracking-widest text-ink-3">Contents</h2>
      {entries.length === 0 && <p className="px-2.5 text-xs text-ink-3">This book has no chapter headings.</p>}
      {entries.map((e, i) => (
        <button
          key={`${e.position}-${i}`}
          type="button"
          onClick={() => onGo(e.position)}
          className={cx(
            "flex items-center gap-2 rounded-lg px-2.5 py-1 text-left transition-colors",
            i === activeIndex ? "bg-accent-soft text-accent" : "text-ink-2 hover:bg-surface hover:text-ink",
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

const DisplayMenu = ({
  showHarakat,
  onShowHarakat,
  showMine,
  onShowMine,
}: {
  showHarakat: boolean;
  onShowHarakat: (v: boolean) => void;
  showMine: boolean;
  onShowMine: (v: boolean) => void;
}) => (
  <div className="absolute right-0 top-11 z-40 flex w-80 flex-col gap-3.5 rounded-xl border border-line bg-surface p-4 shadow-lg">
    <span className="text-sm font-medium">Text display</span>
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
    <div className="h-px bg-line" />
    <p className="text-xs text-ink-3">
      Click a letter and type a haraka with the Arabic keyboard layout. Your marks are stored separately; the corpus text is never changed.
    </p>
  </div>
);

/** Moves the typing target by `delta` letters, crossing into neighbouring words on the same line. */
const moveTarget = ({ page, target, delta }: { page: StoredPage["page"]; target: LetterRef; delta: number }): LetterRef => {
  const text = lineText({ page, part: target.part, line: target.line }) ?? "";
  const counts = wordsOf(text).map((w) => lettersOf(w).length);
  const letter = target.letter + delta;
  if (letter >= 1 && letter <= (counts[target.word - 1] ?? 0)) return { ...target, letter };
  const word = target.word + delta;
  const size = counts[word - 1];
  if (!size) return target;
  return { ...target, word, letter: delta > 0 ? 1 : size };
};

interface HarakatEdit {
  ref: LetterRef;
  before: string;
  after: string;
}

export const ReaderRoute = () => {
  const { bookId = "" } = useParams();
  const [search, setSearch] = useSearchParams();
  const book = useBook(bookId);
  const [contentsOpen, setContentsOpen] = usePref({ key: "reader.contentsOpen", fallback: true });
  const [showHarakat, setShowHarakat] = usePref({ key: "reader.showHarakat", fallback: true });
  const [showMine, setShowMine] = usePref({ key: "reader.showMine", fallback: true });
  const [target, setTarget] = useState<LetterRef | null>(null);
  const [edits, setEdits] = useState<{ position: number; history: History<HarakatEdit> }>({ position: 0, history: EMPTY_HISTORY });
  const [menuOpen, setMenuOpen] = useState(false);
  const [panelOpen, setPanelOpen] = usePref({ key: "reader.panelOpen", fallback: false });
  const [panelTab, setPanelTab] = usePref<PanelTab>({ key: "reader.panelTab", fallback: "highlights" });
  const [toolbar, setToolbar] = useState<Toolbar | null>(null);
  const [noteEditor, setNoteEditor] = useState<NoteEditor | null>(null);
  const pageRoot = useRef<HTMLDivElement>(null);
  const pointerInNote = useRef(false);
  const reselect = useRef<Span | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const marker = useMarker(bookId);
  const setMarker = useSetMarker(bookId);
  const [markerToast, setMarkerToast] = useState<{ id: number; page: number; undo: () => void } | null>(null);
  const pendingReveal = useRef<(LineRange & { position: number }) | null>(null);
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

  const go = useCallback(
    (next: number) => {
      if (next < 1 || next > total) return;
      setSearch({ p: String(next) }, { replace: true });
    },
    [total, setSearch],
  );

  const dismiss = useCallback(() => {
    setToolbar(null);
    setNoteEditor(null);
    setTarget(null);
  }, []);

  useEffect(dismiss, [position, dismiss]);

  const resumed = useRef(false);
  useEffect(() => {
    if (resumed.current || !marker.isSuccess) return;
    resumed.current = true;
    if (!fromUrl && marker.data) pendingReveal.current = { position: marker.data.position, part: "matn", from: marker.data.line, to: marker.data.line };
  }, [marker.isSuccess, marker.data, fromUrl]);

  useEffect(() => {
    const reveal = pendingReveal.current;
    if (!reveal || page.data?.position !== reveal.position) return;
    pendingReveal.current = null;
    requestAnimationFrame(() => revealLines({ root: pageRoot.current, ...reveal }));
  });

  const citeLines = ({ position: at, ...range }: LineRange & { position: number }) => {
    if (at === position) revealLines({ root: pageRoot.current, ...range });
    else {
      pendingReveal.current = { position: at, ...range };
      go(at);
    }
  };

  const openAsk = (selection: AskSelection | null) => {
    if (selection) setAskSelection(selection);
    setPanelTab("ask");
    setPanelOpen(true);
  };

  const dismissMarkerToast = useCallback(() => setMarkerToast(null), []);

  const markLine = (line: number) => {
    const previous = marker.data;
    void setMarker({ position, line });
    setMarkerToast({ id: Date.now(), page: page.data?.number ?? position, undo: () => void setMarker(previous ? { position: previous.position, line: previous.line } : null) });
  };

  /** M marks the line under the pointer, or else the first line in view. */
  const markFromKeyboard = () => {
    const root = pageRoot.current;
    if (!root) return;
    const lines = [...root.querySelectorAll<HTMLElement>('[data-line-block^="matn-"]')].filter((el) => el.tagName === "P");
    const top = root.getBoundingClientRect().top;
    const el = lines.find((l) => l.matches(":hover")) ?? lines.find((l) => l.getBoundingClientRect().bottom > top);
    if (el) markLine(Number(el.dataset.lineBlock?.replace("matn-", "")));
  };

  const scheduleNoteClose = () => {
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => {
      if (!pointerInNote.current && !focusInNoteEditor()) setNoteEditor(null);
    }, 300);
  };

  const onWordHover = (target: WordTarget, note: Note | null) => {
    if (!note) {
      if (noteEditor) scheduleNoteClose();
      return;
    }
    clearTimeout(closeTimer.current);
    if (toolbar || focusInNoteEditor() || noteEditor?.note?.id === note.id) return;
    setNoteEditor({ note, span: note.span, rect: target.element.getBoundingClientRect() });
  };

  const onWordClick = (word: WordTarget, highlight: Highlight | null) => {
    if (!window.getSelection()?.isCollapsed) return;
    if (word.letter !== null) setTarget({ part: word.part, line: word.ref.line, word: word.ref.word, letter: word.letter });
    if (!highlight) return;
    setNoteEditor(null);
    setToolbar({ mode: "highlight", highlight, rect: word.element.getBoundingClientRect() });
  };

  /**
   * The first click redraws the word with the letter cursor, so the browser
   * neither fires dblclick nor selects the word. Select it on the second press.
   */
  const onMouseDown = (e: React.MouseEvent<HTMLElement>) => {
    setMenuOpen(false);
    dismiss();
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

  /** Undo and redo cover harakat typed on the current page. */
  const pageHistory = edits.position === position ? edits.history : EMPTY_HISTORY;

  const applyMarks = (ref: LetterRef, marks: string) =>
    void (marks ? actions.setHarakat({ ...ref, marks }) : actions.removeHarakat(ref));

  const editMarks = (ref: LetterRef, after: string) => {
    const before = mineAt(ref);
    if (before === after) return;
    applyMarks(ref, after);
    setEdits({ position, history: record(pageHistory, { ref, before, after }) });
  };

  const typeMark = (ref: LetterRef, typed: string) => editMarks(ref, mergeMarks({ existing: mineAt(ref), typed }));

  const step = (direction: "undo" | "redo") => {
    const { history, entry } = (direction === "undo" ? undo : redo)(pageHistory);
    if (!entry) return;
    applyMarks(entry.ref, direction === "undo" ? entry.before : entry.after);
    setEdits({ position, history });
    setTarget(entry.ref);
  };

  const finishToolbar = () => {
    setToolbar(null);
    window.getSelection()?.removeAllRanges();
  };

  const openNoteFromToolbar = () => {
    if (!toolbar) return;
    const span = toolbar.mode === "selection" ? toolbar.span : toolbar.highlight.span;
    setNoteEditor({ note: null, span, rect: toolbar.rect });
    finishToolbar();
  };

  useEffect(() => {
    if (book.data && position >= 1 && position <= total) {
      void hamish["library.setProgress"]({ bookId, position });
    }
  }, [book.data, bookId, position, total]);

  const keyHandler = useRef<(e: KeyboardEvent) => void>(() => {});
  keyHandler.current = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
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
    else if (e.code === "KeyM" && !e.shiftKey) markFromKeyboard();
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
        <Link to="/" className="text-accent">
          Back to Library
        </Link>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="relative flex h-15 shrink-0 items-center gap-2 border-b border-line bg-bg px-4">
        <Link to="/" aria-label="Back to Library">
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
            <DisplayMenu showHarakat={showHarakat} onShowHarakat={setShowHarakat} showMine={showMine} onShowMine={setShowMine} />
          )}
        </div>
        <div className="mx-2 h-6 w-px bg-line" />
        <IconButton
          icon={NotebookPen}
          label={panelOpen && panelTab !== "ask" ? "Hide highlights and notes" : "Show highlights and notes"}
          selected={panelOpen && panelTab !== "ask"}
          onClick={() => {
            if (panelOpen && panelTab !== "ask") setPanelOpen(false);
            else {
              if (panelTab === "ask") setPanelTab("highlights");
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
        {contentsOpen && <ContentsRail entries={toc} current={position} markerAt={marker.data?.position ?? null} onGo={go} />}
        <div
          ref={pageRoot}
          className="@container min-w-0 flex-1 overflow-y-auto overflow-x-hidden"
          onMouseDown={onMouseDown}
          onMouseUp={onSelectionEnd}
          onMouseLeave={() => noteEditor && scheduleNoteClose()}
          onScroll={() => toolbar && setToolbar(null)}
        >
          {/* The wide right padding leaves room for the last-read marker in the margin. */}
          <div className="px-6 py-10 @3xl:pl-12 @3xl:pr-40">
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
              display={{ showHarakat, showMine, target }}
              markerLine={marker.data?.position === position ? marker.data.line : null}
              onMark={markLine}
              onClearMark={() => void setMarker(null)}
              onWordHover={onWordHover}
              onWordClick={onWordClick}
            />
          )}
          </div>
        </div>
        {panelOpen && (
          <AnnotationsPanel
            tab={panelTab}
            onTab={setPanelTab}
            annotations={annotations.data}
            onClose={() => setPanelOpen(false)}
            onGoTo={(span) => revealSpan({ root: pageRoot.current, span })}
            onRemoveHighlight={(id) => void actions.removeHighlight(id)}
            onDeleteNote={(id) => void actions.deleteNote(id)}
            askPanel={
              <AskPanel
                conversation={conversation}
                position={position}
                pageNumber={page.data?.number ?? position}
                selection={askSelection}
                onClearSelection={() => setAskSelection(null)}
                onCite={citeLines}
                onSaveNote={(turn, body) => {
                  void hamish["notes.add"]({ bookId, position: turn.position, span: turn.selection.span, body }).then(() =>
                    client.invalidateQueries({ queryKey: keys.annotations(bookId, turn.position) }),
                  );
                }}
              />
            }
          />
        )}
      </div>

      {markerToast && (
        <Toast key={markerToast.id} onDone={dismissMarkerToast}>
          <span className="flex items-center gap-3">
            <span>Marked as last read · page {arabicNumber(markerToast.page)}</span>
            <button
              type="button"
              className="font-semibold"
              onClick={() => {
                markerToast.undo();
                setMarkerToast(null);
              }}
            >
              Undo
            </button>
          </span>
        </Toast>
      )}

      {toolbar && (
        <SelectionToolbar
          rect={toolbar.rect}
          mode={toolbar.mode}
          onHighlight={(color) => {
            if (toolbar.mode === "selection") void actions.addHighlight({ span: toolbar.span, color });
            finishToolbar();
          }}
          onRemoveHighlight={() => {
            if (toolbar.mode === "highlight") void actions.removeHighlight(toolbar.highlight.id);
            finishToolbar();
          }}
          onNote={openNoteFromToolbar}
          onCopy={() => {
            if (toolbar.mode === "selection") void navigator.clipboard.writeText(toolbar.text);
            finishToolbar();
          }}
          onAsk={() => {
            if (toolbar.mode === "selection") openAsk({ span: toolbar.span, text: page.data ? quoteSpan({ page: page.data.page, span: toolbar.span }) : toolbar.text, position });
            finishToolbar();
          }}
        />
      )}
      {noteEditor && (
        <NotePopover
          key={noteEditor.note?.id ?? "new"}
          rect={noteEditor.rect}
          note={noteEditor.note}
          lineLabel={spanLabel(noteEditor.span).toLowerCase()}
          onCreate={(body) => actions.addNote({ span: noteEditor.span, body })}
          onUpdate={actions.updateNote}
          onDelete={actions.deleteNote}
          onClose={() => setNoteEditor(null)}
          onPointerInside={(inside) => {
            pointerInNote.current = inside;
            if (inside) clearTimeout(closeTimer.current);
            else scheduleNoteClose();
          }}
        />
      )}
    </div>
  );
};
