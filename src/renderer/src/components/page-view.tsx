import { MessageSquareText } from "lucide-react";
import type { ReactNode, MouseEvent as ReactMouseEvent } from "react";
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

const TARGET_LETTER =
  "pointer-events-none absolute inset-0 -z-20 select-none rounded-sm bg-accent-soft shadow-[-2px_0_0_var(--color-ink-added)]";

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
      <span key={letter} className="relative isolate">
        {/* The target's background sits on its own layer: on the letter itself it would cover the red copy. */}
        {letter === targetLetter && <span data-overlay aria-hidden className={TARGET_LETTER} />}
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

export const PageView = ({
  stored,
  annotations,
  display,
  onWordHover,
  onWordClick,
}: {
  stored: StoredPage;
  annotations: PageAnnotations;
  display: Display;
  onWordHover: LineProps["onWordHover"];
  onWordClick: LineProps["onWordClick"];
}) => {
  const { page } = stored;
  const lineProps = { annotations, display, onWordHover, onWordClick };
  const t = (s: string) => (display.showHarakat ? s : stripHarakat(s));
  return (
    <article className="mx-auto flex w-full max-w-160 flex-col pb-24">
      <div className="mb-4 flex items-baseline justify-between border-b border-line pb-4 text-ink-3" dir="rtl">
        <span className="ar text-ar-small">{t(page.header ?? "")}</span>
        <span className="ar text-ar-small">{arabicNumber(stored.number ?? stored.position)}</span>
      </div>
      {page.matn.length === 0 && <p className="py-12 text-center text-sm text-ink-3">This page has no main text.</p>}
      {page.matn.map((b) =>
        b.kind === "heading" ? (
          <h2
            key={b.line}
            data-line-block={`matn-${b.line}`}
            className={cx("ar my-3 text-center font-bold", b.level <= 2 ? "text-ar-display" : "text-ar-body")}
          >
            <Line part="matn" line={b.line} text={b.text} {...lineProps} />
          </h2>
        ) : (
          <p key={b.line} data-line-block={`matn-${b.line}`} className="ar whitespace-pre-line text-right text-ar-reading">
            <Line part="matn" line={b.line} text={b.text} {...lineProps} />
          </p>
        ),
      )}
      {page.hashiya.length > 0 && (
        <section className="mt-8 flex flex-col gap-2 border-t border-line pt-4" dir="rtl">
          <h3 className="ar text-ar-small font-bold text-ink-3">الحاشية</h3>
          {page.hashiya.map((f, i) => (
            <p key={`${f.marker ?? "u"}-${i}`} data-line-block={`hashiya-${i + 1}`} className="ar text-right text-ar-small text-ink-2">
              {f.marker && `(${f.marker}) `}
              <Line part="hashiya" line={i + 1} text={f.text} {...lineProps} />
            </p>
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
