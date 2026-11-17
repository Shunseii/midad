import { ArrowLeft, ChevronLeft, ChevronRight, PanelLeftClose, PanelLeftOpen, Type } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { stripHarakat } from "../../../shared/arabic";
import type { BookDetail, StoredPage } from "../../../shared/library";
import { IconButton, Kbd, Skeleton, Switch, cx } from "../components/ui";
import { arabicNumber } from "../lib/format";
import { hamish, readPref, useBook, usePage, writePref } from "../lib/hamish";

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

const PageView = ({ stored, showHarakat }: { stored: StoredPage; showHarakat: boolean }) => {
  const t = (s: string) => (showHarakat ? s : stripHarakat(s));
  const { page } = stored;
  return (
    <article className="mx-auto flex w-160 flex-col gap-4 pb-24">
      <div className="flex items-baseline justify-between border-b border-line pb-4 text-ink-3" dir="rtl">
        <span className="ar text-ar-small">{t(page.header ?? "")}</span>
        <span className="ar text-ar-small">{arabicNumber(stored.number ?? stored.position)}</span>
      </div>
      {page.matn.length === 0 && <p className="py-12 text-center text-sm text-ink-3">This page has no main text.</p>}
      {page.matn.map((b) =>
        b.kind === "heading" ? (
          <h2 key={b.line} data-line={b.line} className={cx("ar mt-2 text-center font-bold", b.level <= 2 ? "text-ar-display" : "text-ar-body")}>
            {t(b.text)}
          </h2>
        ) : (
          <p key={b.line} data-line={b.line} className="ar whitespace-pre-line text-right text-ar-reading">
            {t(b.text)}
          </p>
        ),
      )}
      {page.hashiya.length > 0 && (
        <section className="mt-4 flex flex-col gap-2 border-t border-line pt-4" dir="rtl">
          <h3 className="ar text-ar-small font-bold text-ink-3">الحاشية</h3>
          {page.hashiya.map((f, i) => (
            <p key={`${f.marker ?? "u"}-${i}`} data-footnote={f.marker ?? ""} className="ar text-right text-ar-small text-ink-2">
              {f.marker && `(${f.marker}) `}
              {t(f.text)}
            </p>
          ))}
        </section>
      )}
    </article>
  );
};

export const ReaderRoute = () => {
  const { bookId = "" } = useParams();
  const [search, setSearch] = useSearchParams();
  const book = useBook(bookId);
  const [contentsOpen, setContentsOpen] = usePref({ key: "reader.contentsOpen", fallback: true });
  const [showHarakat, setShowHarakat] = usePref({ key: "reader.showHarakat", fallback: true });
  const [menuOpen, setMenuOpen] = useState(false);

  const total = book.data?.pageCount ?? 0;
  const fromUrl = Number(search.get("p"));
  const position = fromUrl >= 1 ? fromUrl : (book.data?.progress?.position ?? 1);
  const page = usePage({ bookId, position });
  const toc = useMemo(() => (book.data ? tableOfContents(book.data) : []), [book.data]);

  const go = useCallback(
    (next: number) => {
      if (next < 1 || next > total) return;
      setSearch({ p: String(next) }, { replace: true });
    },
    [total, setSearch],
  );

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
      else if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, position, showHarakat, setShowHarakat]);

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
      </header>

      <div className="flex min-h-0 flex-1">
        {contentsOpen && <ContentsRail entries={toc} current={position} onGo={go} />}
        <div className="min-w-0 flex-1 overflow-y-auto px-12 py-10" onMouseDown={() => setMenuOpen(false)}>
          {page.isPending && (
            <div className="mx-auto flex w-160 flex-col gap-4">
              <Skeleton className="h-4 w-full" />
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          )}
          {page.error && <p className="text-center text-sm text-danger">Couldn't open this page: {page.error.message}</p>}
          {page.data === null && book.data && <p className="text-center text-sm text-ink-3">This book has no pages yet. Sync it from the Library.</p>}
          {page.data && <PageView stored={page.data} showHarakat={showHarakat} />}
        </div>
      </div>
    </div>
  );
};
