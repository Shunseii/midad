import { MessageSquareText } from "lucide-react";
import type { MouseEvent as ReactMouseEvent } from "react";
import {
  type Highlight,
  type HighlightColor,
  type Note,
  type PageAnnotations,
  type Part,
  type Span,
  spanContains,
  tokenize,
  type WordRef,
} from "../../../shared/annotations";
import { stripHarakat } from "../../../shared/arabic";
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
}

interface LineProps {
  part: Part;
  line: number;
  text: string;
  annotations: PageAnnotations;
  showHarakat: boolean;
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

const Line = ({ part, line, text, annotations, showHarakat, onWordHover, onWordClick }: LineProps) => {
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
    const target = (e: ReactMouseEvent<HTMLElement>): WordTarget => ({ part, ref, element: e.currentTarget });
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
          {showHarakat ? token.text : stripHarakat(token.text)}
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
  showHarakat,
  onWordHover,
  onWordClick,
}: {
  stored: StoredPage;
  annotations: PageAnnotations;
  showHarakat: boolean;
  onWordHover: LineProps["onWordHover"];
  onWordClick: LineProps["onWordClick"];
}) => {
  const { page } = stored;
  const lineProps = { annotations, showHarakat, onWordHover, onWordClick };
  const t = (s: string) => (showHarakat ? s : stripHarakat(s));
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
