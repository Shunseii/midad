import { Bookmark, BookmarkPlus, MessageSquareText } from "lucide-react";
import { Fragment, type ReactNode, type MouseEvent as ReactMouseEvent, useLayoutEffect, useRef, useState } from "react";
import {
  type Highlight,
  type HighlightColor,
  type LetterRef,
  type Note,
  type PageAnnotations,
  type Part,
  type Span,
  spanContains,
  tokenize,
  type WordRef,
} from "../../../shared/annotations";
import { stripHarakat } from "../../../shared/arabic";
import { displayMarks, inContext, isMark, lettersOf } from "../../../shared/harakat";
import type { StoredPage } from "../../../shared/library";
import { arabicNumber } from "../lib/format";
import { cx } from "./ui";

export const MARK_BG: Record<HighlightColor, string> = {
  yellow: "bg-mark-1",
  green: "bg-mark-2",
  pink: "bg-mark-3",
  blue: "bg-mark-4",
};

export interface WordTarget {
  part: Part;
  ref: WordRef;
  element: HTMLElement;
  /** The letter under the pointer, when known. */
  letter: number | null;
}

export interface Display {
  showHarakat: boolean;
  showMine: boolean;
  lineNumbers: boolean;
  /** The letter the reader is typing harakat on. */
  target: LetterRef | null;
}

interface LineProps {
  part: Part;
  line: number;
  text: string;
  annotations: PageAnnotations;
  display: Display;
  onWordHover: (target: WordTarget, note: Note | null) => void;
  onWordClick: (target: WordTarget, highlight: Highlight | null) => void;
}

/** The newest highlight wins where two overlap. */
const highlightAt = (highlights: Highlight[], part: Part, ref: WordRef) =>
  highlights.reduce<Highlight | null>(
    (found, h) => (spanContains({ span: h.span, part, ref }) && (!found || h.createdAt > found.createdAt) ? h : found),
    null,
  );

const noteAt = (notes: Note[], part: Part, ref: WordRef) =>
  notes.find((n) => spanContains({ span: n.span, part, ref })) ?? null;

const isLastWord = (span: Span, ref: WordRef) => span.end.line === ref.line && span.end.word === ref.word;

/** A short tick under the targeted letter, below where a kasra sits. */
const TARGET_TICK = "pointer-events-none absolute inset-x-px bottom-1 h-0.5 select-none rounded-full bg-accent";

/**
 * A word's letters with the reader's marks drawn in their own colour. Letters
 * without anything special stay in one text run so the word shapes normally.
 */
const WordText = ({ text, mine, display, targetLetter }: { text: string; mine: Map<number, string>; display: Display; targetLetter: number | null }) => {
  const { showHarakat, showMine } = display;
  const showingMine = showHarakat && showMine && mine.size > 0;
  if (!showingMine && targetLetter === null) return showHarakat ? text : stripHarakat(text);

  const nodes: ReactNode[] = [];
  let run = "";
  const letters = lettersOf(text);
  letters.forEach((l, i) => {
    const letter = i + 1;
    const marks = displayMarks({ corpus: showHarakat ? l.marks : "", mine: showingMine ? (mine.get(letter) ?? "") : "" });
    if (!marks.mine && letter !== targetLetter) {
      run += l.base + marks.corpus;
      return;
    }
    if (run) nodes.push(run);
    run = "";
    // Chromium paints a mark in its letter's colour, so the reader's marks are drawn
    // on a red copy of the letter underneath; the letter itself covers the red base.
    const { before, after } = inContext({ letters, index: i });
    nodes.push(
      <span key={letter} className={cx("relative isolate", letter === targetLetter && "text-accent")}>
        {letter === targetLetter && <span data-overlay aria-hidden className={TARGET_TICK} />}
        {l.base}
        {marks.corpus}
        {marks.mine && (
          <span data-overlay aria-hidden className="pointer-events-none absolute right-0 top-0 -z-10 select-none leading-[normal] text-ink-added">
            {before}
            {l.base}
            {marks.corpus}
            {marks.mine}
            {after}
          </span>
        )}
      </span>,
    );
  });
  if (run) nodes.push(run);
  return nodes;
};

const Line = ({ part, line, text, annotations, display, onWordHover, onWordClick }: LineProps) => {
  const tokens = tokenize(text);
  const wordAt = (i: number) => {
    const t = tokens[i];
    return t?.kind === "word" ? { line, word: t.word } : null;
  };

  return tokens.map((token, i) => {
    if (token.kind === "space") {
      const before = wordAt(i - 1);
      const after = wordAt(i + 1);
      const shared =
        before && after ? highlightAt(annotations.highlights, part, before) : null;
      const joins = shared && after && spanContains({ span: shared.span, part, ref: after });
      return (
        <span key={i} className={cx(joins && MARK_BG[shared.color])}>
          {token.text}
        </span>
      );
    }
    const ref = { line, word: token.word };
    const highlight = highlightAt(annotations.highlights, part, ref);
    const note = noteAt(annotations.notes, part, ref);
    const target = (e: ReactMouseEvent<HTMLElement>): WordTarget => ({
      part,
      ref,
      element: e.currentTarget,
      letter: letterAtPoint({ element: e.currentTarget, x: e.clientX }),
    });
    const mine = new Map(
      annotations.harakat
        .filter((h) => !h.stale && h.part === part && h.line === line && h.word === token.word)
        .map((h) => [h.letter, h.marks]),
    );
    const { target: t } = display;
    const targetLetter = t && t.part === part && t.line === line && t.word === token.word ? t.letter : null;
    return (
      <span key={i}>
        <span
          data-part={part}
          data-line={line}
          data-w={token.word}
          onMouseEnter={(e) => onWordHover(target(e), note)}
          onMouseLeave={(e) => note && onWordHover(target(e), null)}
          onClick={(e) => onWordClick(target(e), highlight)}
          className={cx(
            highlight && MARK_BG[highlight.color],
            highlight && "cursor-pointer",
            note && "underline decoration-accent decoration-dotted decoration-2 underline-offset-8",
          )}
        >
          <WordText text={token.text} mine={mine} display={display} targetLetter={targetLetter} />
        </span>
        {note && isLastWord(note.span, ref) && (
          <MessageSquareText aria-label="Note" className="mx-0.5 inline size-3.5 -translate-y-3 text-accent" />
        )}
      </span>
    );
  });
};

/** One row of a matn line as laid out on screen, relative to its paragraph. `word` is the row's first word. */
export interface ScreenRow {
  top: number;
  height: number;
  word: number;
}

export const screenRows = (block: HTMLElement): ScreenRow[] => {
  const base = block.getBoundingClientRect();
  const rows: ScreenRow[] = [];
  for (const el of block.querySelectorAll<HTMLElement>("[data-w]")) {
    const r = el.getBoundingClientRect();
    const top = r.top - base.top;
    const word = Number(el.dataset.w);
    const row = rows.find((x) => Math.abs(x.top - top) < r.height / 2);
    if (row) {
      row.word = Math.min(row.word, word);
      row.height = Math.max(row.height, r.height);
    } else rows.push({ top, height: r.height, word });
  }
  return rows.sort((x, y) => x.top - y.top);
};

/** The row a word sits on: words run down the rows in order. */
export const rowOfWord = (rows: ScreenRow[], word: number): ScreenRow | null =>
  rows.reduce<ScreenRow | null>((found, row) => (row.word <= word ? row : found), null);

const rowStyle = (row: ScreenRow) => ({ top: row.top, height: row.height });

/** The matn line's number, in the left margin beside its first row. */
const LineNumber = ({ line }: { line: number }) => (
  // The wrapper keeps the line's font so 1lh is one row of text; the number itself is small.
  <span aria-hidden data-overlay className="pointer-events-none absolute -left-6 top-0 flex h-[1lh] w-5 select-none items-center @3xl:-left-10 @3xl:w-7">
    <span className="font-sans text-xs font-normal tabular-nums text-ink-3">{line}</span>
  </span>
);

/** A line of text with its margin: the last-read marker on one screen row, or on hover a button beside the row. */
const MarkableLine = ({
  as: Tag,
  part,
  line,
  className,
  markerWord,
  fresh,
  layoutKey,
  onMark,
  onClearMark,
  children,
}: {
  as: "p" | "h2";
  part: Part;
  line: number;
  className: string;
  markerWord: number | null;
  /** The marker was just placed here, so it animates in. */
  fresh: boolean;
  /** Changes when the text may have reflowed (e.g. harakat shown or hidden). */
  layoutKey: string;
  onMark: (word: number) => void;
  onClearMark: () => void;
  children: ReactNode;
}) => {
  const ref = useRef<HTMLParagraphElement>(null);
  const [hover, setHover] = useState<ScreenRow | null>(null);
  const [marked, setMarked] = useState<ScreenRow | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || markerWord === null) {
      setMarked(null);
      return;
    }
    const measure = () => setMarked(rowOfWord(screenRows(el), markerWord));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [markerWord, layoutKey]);

  const rowAt = (clientY: number) => {
    const el = ref.current;
    if (!el) return null;
    const y = clientY - el.getBoundingClientRect().top;
    const rows = screenRows(el);
    return rows.find((r) => y < r.top + r.height) ?? rows.at(-1) ?? null;
  };

  return (
    <Tag ref={ref} data-line-block={`${part}-${line}`} className={cx("relative", className)}>
      {children}
      {/* The margin beside the line: the mark button shows only while the pointer is here. */}
      <span
        aria-hidden
        onMouseMove={(e) => {
          const row = rowAt(e.clientY);
          if (row?.word !== hover?.word) setHover(row);
        }}
        onMouseLeave={() => setHover(null)}
        className="absolute inset-y-0 left-full hidden w-36 @3xl:block"
      />
      {marked && (
        <Fragment key={fresh ? `${markerWord}` : "settled"}>
          <button
            type="button"
            onClick={onClearMark}
            onMouseDown={(e) => e.stopPropagation()}
            aria-label="Clear the last-read marker"
            style={rowStyle(marked)}
            className="absolute left-full ml-6 hidden select-none items-start gap-3 font-sans @3xl:flex"
          >
            <span className={cx("w-0.5 origin-top self-stretch rounded-full bg-accent", fresh && "motion-safe:animate-mark-bar")} />
            <span className={cx("flex flex-col items-center gap-1 text-accent", fresh && "motion-safe:animate-mark-drop")}>
              <Bookmark aria-hidden className="size-5 fill-current" />
              <span className="whitespace-nowrap text-overline font-semibold uppercase tracking-widest">Last read</span>
            </span>
          </button>
          {/* Without room for the margin, the marked row gets a bar beside it. */}
          <span
            aria-hidden
            style={rowStyle(marked)}
            className={cx("absolute -right-3 w-0.5 origin-top rounded-full bg-accent @3xl:hidden", fresh && "motion-safe:animate-mark-bar")}
          />
        </Fragment>
      )}
      {hover && hover.word !== marked?.word && (
        <span
          style={rowStyle(hover)}
          onMouseEnter={() => setHover(hover)}
          className="absolute left-full ml-6 hidden select-none items-center gap-3 font-sans @3xl:flex"
        >
          <span className="w-px self-stretch bg-line" />
          <button
            type="button"
            onClick={() => onMark(hover.word)}
            onMouseDown={(e) => e.stopPropagation()}
            aria-label="Mark as last read"
            className="flex size-8 items-center justify-center rounded-md border border-line bg-surface text-ink-2 transition-colors hover:text-accent"
          >
            <BookmarkPlus aria-hidden className="size-4" />
          </button>
        </span>
      )}
    </Tag>
  );
};

export const PageView = ({
  stored,
  annotations,
  display,
  marker,
  onMark,
  onClearMark,
  onWordHover,
  onWordClick,
}: {
  stored: StoredPage;
  annotations: PageAnnotations;
  display: Display;
  /** The word on this page holding the last-read marker, if any. */
  marker: { part: Part; line: number; word: number; setAt: number } | null;
  onMark: (at: { part: Part; line: number; word: number }) => void;
  onClearMark: () => void;
  onWordHover: LineProps["onWordHover"];
  onWordClick: LineProps["onWordClick"];
}) => {
  const { page } = stored;
  const lineProps = { annotations, display, onWordHover, onWordClick };
  const t = (s: string) => (display.showHarakat ? s : stripHarakat(s));
  const fresh = marker !== null && Date.now() - marker.setAt < 2000;
  const markable = (part: Part, line: number) => ({
    part,
    line,
    markerWord: marker?.part === part && marker.line === line ? marker.word : null,
    fresh,
    layoutKey: `${display.showHarakat}-${display.showMine}`,
    onMark: (word: number) => onMark({ part, line, word }),
    onClearMark,
  });
  return (
    <article className="mx-auto flex w-full max-w-160 flex-col pb-24">
      <div className="mb-4 flex items-baseline justify-between border-b border-line pb-4 text-ink-3" dir="rtl">
        <span className="ar text-ar-small">{t(page.header ?? "")}</span>
        <span className="ar text-ar-small">{arabicNumber(stored.number ?? stored.position)}</span>
      </div>
      {page.matn.length === 0 && <p className="py-12 text-center text-sm text-ink-3">This page has no main text.</p>}
      {page.matn.map((b) =>
        b.kind === "heading" ? (
          <MarkableLine
            key={b.line}
            as="h2"
            {...markable("matn", b.line)}
            className={cx("ar my-3 text-center font-bold", b.level <= 2 ? "text-ar-display" : "text-ar-body")}
          >
            {display.lineNumbers && <LineNumber line={b.line} />}
            <Line part="matn" line={b.line} text={b.text} {...lineProps} />
          </MarkableLine>
        ) : (
          <MarkableLine key={b.line} as="p" {...markable("matn", b.line)} className="ar whitespace-pre-line rounded-lg text-right text-ar-reading">
            {display.lineNumbers && <LineNumber line={b.line} />}
            <Line part="matn" line={b.line} text={b.text} {...lineProps} />
          </MarkableLine>
        ),
      )}
      {page.hashiya.length > 0 && (
        <section className="mt-8 flex flex-col gap-2 border-t border-line pt-4" dir="rtl">
          <h3 className="ar text-ar-small font-bold text-ink-3">الحاشية</h3>
          {page.hashiya.map((f, i) => (
            <MarkableLine key={`${f.marker ?? "u"}-${i}`} as="p" {...markable("hashiya", i + 1)} className="ar text-right text-ar-small text-ink-2">
              {f.marker && `(${f.marker}) `}
              <Line part="hashiya" line={i + 1} text={f.text} {...lineProps} />
            </MarkableLine>
          ))}
        </section>
      )}
    </article>
  );
};

/** The word's own text nodes, skipping the red copies drawn under the reader's harakat. */
const readingText = (element: HTMLElement) =>
  document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => (node.parentElement?.closest("[data-overlay]") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });

/** The base letter of a word element nearest to the pointer's x position (1-based). */
export const letterAtPoint = ({ element, x }: { element: HTMLElement; x: number }): number | null => {
  const walker = readingText(element);
  let letter = 0;
  let best: { letter: number; distance: number } | null = null;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent ?? "";
    let i = 0;
    while (i < text.length) {
      if (isMark(text[i] ?? "")) {
        i += 1;
        continue;
      }
      letter += 1;
      let end = i + 1;
      while (end < text.length && isMark(text[end] ?? "")) end += 1;
      const range = document.createRange();
      range.setStart(node, i);
      range.setEnd(node, end);
      const box = range.getBoundingClientRect();
      const distance = x < box.left ? box.left - x : x > box.right ? x - box.right : 0;
      if (!best || distance < best.distance) best = { letter, distance };
      i = end;
    }
  }
  return best?.letter ?? null;
};

/** The base letter where the selection starts, counted within its word (1-based). */
export const letterAtSelectionStart = (root: HTMLElement): number | null => {
  const range = window.getSelection()?.getRangeAt(0);
  const word = range && (range.startContainer.parentElement?.closest<HTMLElement>("[data-w]") ?? null);
  if (!range || !word || !root.contains(word)) return null;
  let letters = 0;
  const walker = readingText(word);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node === range.startContainer ? (node.textContent ?? "").slice(0, range.startOffset) : (node.textContent ?? "");
    letters += [...text].filter((ch) => !isMark(ch)).length;
    if (node === range.startContainer) break;
  }
  return letters + 1;
};

/** True when the selection covers every letter of the word element. */
export const selectionCoversWord = ({ range, word }: { range: Range; word: HTMLElement }): boolean => {
  const walker = readingText(word);
  const first = walker.nextNode();
  let last = first;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) last = node;
  if (!first || !last) return false;
  return range.comparePoint(first, 0) === 0 && range.comparePoint(last, last.textContent?.length ?? 0) === 0;
};

/** Selects the words a span covers, as a double-click or drag would. */
export const selectSpan = ({ root, span }: { root: HTMLElement; span: Span }) => {
  const at = (ref: WordRef) => root.querySelector<HTMLElement>(`[data-part="${span.part}"][data-line="${ref.line}"][data-w="${ref.word}"]`);
  const first = at(span.start);
  const last = at(span.end);
  if (!first || !last) return;
  const range = document.createRange();
  range.setStartBefore(first);
  range.setEndAfter(last);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
};

/** Snaps the current text selection inside `root` to whole words. Null when nothing is selected. */
export const spanFromSelection = (root: HTMLElement): { span: Span; rect: DOMRect } | null => {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;

  const touches = (el: Element) => {
    if (!range.intersectsNode(el)) return false;
    // A range that starts at the very end of a word or ends at the very start of one doesn't select it.
    if (el.contains(range.endContainer) && range.endOffset === 0 && range.startContainer !== range.endContainer) return false;
    if (el.contains(range.startContainer) && range.startOffset === (range.startContainer.textContent ?? "").length) return false;
    return true;
  };

  const words = [...root.querySelectorAll<HTMLElement>("[data-w]")].filter(touches);
  const first = words[0];
  if (!first) return null;
  const part = first.dataset.part as Part;
  const inPart = words.filter((w) => w.dataset.part === part);
  const last = inPart[inPart.length - 1] ?? first;
  const ref = (el: HTMLElement): WordRef => ({ line: Number(el.dataset.line), word: Number(el.dataset.w) });
  return { span: { part, start: ref(first), end: ref(last) }, rect: range.getBoundingClientRect() };
};

const inWord = (node: Node) => {
  const el = node instanceof Element ? node : node.parentElement;
  return !!el?.closest("[data-w]") && !el.closest("[data-overlay]");
};

/**
 * The text position nearest a point, for selections that start or run off the
 * text: in the margins, between lines, past the end of a line.
 */
export const caretNear = ({ root, x, y }: { root: HTMLElement; x: number; y: number }): { node: Node; offset: number } | null => {
  const at = (px: number, py: number) => {
    const pos = document.caretPositionFromPoint(px, py);
    return pos && inWord(pos.offsetNode) ? { node: pos.offsetNode, offset: pos.offset } : null;
  };
  const direct = at(x, y);
  if (direct) return direct;
  // Nearest word: the closest row first, then the closest word along it.
  let best: { rect: DOMRect; score: number } | null = null;
  for (const el of root.querySelectorAll<HTMLElement>("[data-w]")) {
    const r = el.getBoundingClientRect();
    const dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
    const dx = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
    const score = dy * 10_000 + dx;
    if (!best || score < best.score) best = { rect: r, score };
  }
  if (!best) return null;
  const { rect } = best;
  return at(Math.min(Math.max(x, rect.left + 1), rect.right - 1), rect.top + rect.height / 2);
};
