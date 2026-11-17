import { ArrowLeft, ChevronLeft, ChevronRight, NotebookPen, PanelLeftClose, PanelLeftOpen, Type } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import type { Highlight, Note, Span } from "../../../shared/annotations";
import type { BookDetail } from "../../../shared/library";
import { NotePopover, SelectionToolbar } from "../components/annotation-popovers";
import { AnnotationsPanel, type PanelTab, spanLabel } from "../components/annotations-panel";
import { PageView, spanFromSelection, type WordTarget } from "../components/page-view";
import { IconButton, Kbd, Skeleton, Switch, cx } from "../components/ui";
import { hamish, readPref, useAnnotationActions, useAnnotations, useBook, usePage, writePref } from "../lib/hamish";

interface TocEntry {
  text: string;
  level: number;
  position: number;
}

/** Chapter headings across the book; falls back to running headers for books without headings. */
const tableOfContents = (book: BookDetail): TocEntry[] => {
  const headings = book.pages.flatMap((p) => p.headings.map((h) => ({ text: h.text, level: h.level, position: p.position })));
  if (headings.length > 0) return headings;
  return book.pages
    .filter((p, i) => p.header && p.header !== book.pages[i - 1]?.header)
    .map((p) => ({ text: p.header ?? "", level: 2, position: p.position }));
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

const ContentsRail = ({ entries, current, onGo }: { entries: TocEntry[]; current: number; onGo: (position: number) => void }) => {
  const activeIndex = entries.reduce((found, e, i) => (e.position <= current ? i : found), -1);
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
          <span className="text-xs tabular-nums">{e.position}</span>
          <span className="ar flex-1 text-right text-ar-small">{e.text}</span>
        </button>
      ))}
    </nav>
  );
};

const DisplayMenu = ({ showHarakat, onShowHarakat }: { showHarakat: boolean; onShowHarakat: (v: boolean) => void }) => (
  <div className="absolute right-0 top-11 z-40 flex w-76 flex-col gap-3.5 rounded-xl border border-line bg-surface p-4 shadow-lg">
    <span className="text-sm font-medium">Text display</span>
    <div className="flex items-center gap-3">
      <div className="flex flex-1 flex-col gap-0.5">
        <span className="text-sm font-medium">Harakat</span>
        <span className="text-xs text-ink-3">Vowel marks in the text</span>
      </div>
      <Kbd>H</Kbd>
      <Switch label="Show harakat" checked={showHarakat} onChange={onShowHarakat} />
    </div>
    <div className="h-px bg-line" />
    <p className="text-xs text-ink-3">The corpus text is never changed.</p>
  </div>
);

export const ReaderRoute = () => {
  const { bookId = "" } = useParams();
  const [search, setSearch] = useSearchParams();
  const book = useBook(bookId);
  const [contentsOpen, setContentsOpen] = usePref({ key: "reader.contentsOpen", fallback: true });
  const [showHarakat, setShowHarakat] = usePref({ key: "reader.showHarakat", fallback: true });
  const [menuOpen, setMenuOpen] = useState(false);
  const [panelOpen, setPanelOpen] = usePref({ key: "reader.panelOpen", fallback: false });
  const [panelTab, setPanelTab] = usePref<PanelTab>({ key: "reader.panelTab", fallback: "highlights" });
  const [toolbar, setToolbar] = useState<Toolbar | null>(null);
  const [noteEditor, setNoteEditor] = useState<NoteEditor | null>(null);
  const pageRoot = useRef<HTMLDivElement>(null);
  const pointerInNote = useRef(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const total = book.data?.pageCount ?? 0;
  const fromUrl = Number(search.get("p"));
  const position = fromUrl >= 1 ? fromUrl : (book.data?.progress?.position ?? 1);
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
  }, []);

  useEffect(dismiss, [position, dismiss]);

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

  const onWordClick = (target: WordTarget, highlight: Highlight | null) => {
    if (!highlight || !window.getSelection()?.isCollapsed) return;
    setNoteEditor(null);
    setToolbar({ mode: "highlight", highlight, rect: target.element.getBoundingClientRect() });
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      // Right-to-left book: the next page is to the left.
      if (e.key === "ArrowLeft" || e.key === "PageDown") go(position + 1);
      else if (e.key === "ArrowRight" || e.key === "PageUp") go(position - 1);
      else if (e.key.toLowerCase() === "h" && !e.metaKey && !e.ctrlKey) setShowHarakat(!showHarakat);
      else if (e.key === "Escape") {
        setMenuOpen(false);
        dismiss();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, position, showHarakat, setShowHarakat, dismiss]);

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
          <IconButton icon={ChevronRight} label="Previous page" onClick={() => go(position - 1)} disabled={position <= 1} />
          <span className="min-w-16 text-center text-sm font-medium tabular-nums">
            {position} / {total || "–"}
          </span>
          <IconButton icon={ChevronLeft} label="Next page" onClick={() => go(position + 1)} disabled={position >= total} />
        </div>
        <div className="flex-1" />
        <div className="relative">
          <IconButton icon={Type} label="Text display" selected={menuOpen} onClick={() => setMenuOpen(!menuOpen)} />
          {menuOpen && <DisplayMenu showHarakat={showHarakat} onShowHarakat={setShowHarakat} />}
        </div>
        <div className="mx-2 h-6 w-px bg-line" />
        <IconButton
          icon={NotebookPen}
          label={panelOpen ? "Hide highlights and notes" : "Show highlights and notes"}
          selected={panelOpen}
          onClick={() => setPanelOpen(!panelOpen)}
        />
      </header>

      <div className="flex min-h-0 flex-1">
        {contentsOpen && <ContentsRail entries={toc} current={position} onGo={go} />}
        <div
          ref={pageRoot}
          className="min-w-0 flex-1 overflow-y-auto px-12 py-10"
          onMouseDown={() => {
            setMenuOpen(false);
            dismiss();
          }}
          onMouseUp={onSelectionEnd}
          onMouseLeave={() => noteEditor && scheduleNoteClose()}
          onScroll={() => toolbar && setToolbar(null)}
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
              annotations={annotations.data ?? { highlights: [], notes: [], harakat: [] }}
              showHarakat={showHarakat}
              onWordHover={onWordHover}
              onWordClick={onWordClick}
            />
          )}
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
          />
        )}
      </div>

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
