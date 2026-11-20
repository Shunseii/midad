import { ArrowUp, Copy, Languages, Lightbulb, ListTree, NotebookPen, Quote as QuoteIcon, RotateCcw, Square, SquarePen, TextQuote, X } from "lucide-react";
import { type ClipboardEvent, type ReactNode, type KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import { quoteSpan, type Span } from "../../../shared/annotations";
import { citeSpan, parseCitations, type Segment } from "../../../shared/ask";
import { copiedPassage } from "../lib/copied";
import { arabicNumber } from "../lib/format";
import { hamish, usePage } from "../lib/hamish";
import { Button, IconButton, cx } from "./ui";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

export interface AskSelection {
  span: Span;
  text: string;
  position: number;
}

/** A passage pasted into the question. `span` is set when it was copied from the page. */
export interface Quote {
  id: string;
  text: string;
  span: Span | null;
  position: number;
}

export interface Turn {
  id: string;
  question: string;
  quotes: Quote[];
  position: number;
  selection: AskSelection | null;
  answer: string;
  status: "streaming" | "done" | "error";
  /** While streaming: what Claude is doing, e.g. reading the page. */
  activity: string | null;
  error: string | null;
}

/** One Ask AI conversation for a book: a Claude session continued across questions. */
export const useAskConversation = (bookId: string) => {
  const [turns, setTurns] = useState<Turn[]>([]);
  const sessionId = useRef<string | null>(null);
  // Bumped by a new conversation, so a late answer from the old one can't revive its session.
  const generation = useRef(0);
  const update = useCallback((id: string, change: (t: Turn) => Partial<Turn>) => {
    setTurns((all) => all.map((t) => (t.id === id ? { ...t, ...change(t) } : t)));
  }, []);

  useEffect(() => {
    setTurns([]);
    sessionId.current = null;
  }, [bookId]);

  useEffect(
    () =>
      window.hamishEvents.onAskEvent((requestId, event) => {
        if (event.kind === "delta") update(requestId, (t) => ({ answer: t.answer + event.text, activity: null }));
        if (event.kind === "tool") update(requestId, (t) => ({ activity: "Reading the page…", answer: t.answer && !t.answer.endsWith("\n\n") ? `${t.answer}\n\n` : t.answer }));
      }),
    [update],
  );

  const ask = ({ question, position, selection, quotes = [] }: { question: string; position: number; selection: AskSelection | null; quotes?: Quote[] }) => {
    const id = crypto.randomUUID();
    const started = generation.current;
    setTurns((all) => [...all, { id, question, quotes, position, selection, answer: "", status: "streaming", activity: "Starting Claude…", error: null }]);
    hamish["ai.ask"]({
      requestId: id,
      bookId,
      position,
      question,
      selection: selection && position === selection.position ? { span: selection.span, text: selection.text } : undefined,
      quotes: quotes.map((q) => ({ text: q.text, span: q.position === position ? q.span : null })),
      sessionId: sessionId.current,
    }).then(
      (result) => {
        if (started === generation.current) sessionId.current = result.sessionId || sessionId.current;
        update(id, () => ({ answer: result.text, status: "done", activity: null }));
      },
      (err: unknown) => update(id, () => ({ status: "error", activity: null, error: err instanceof Error ? err.message : String(err) })),
    );
  };

  const busy = turns.some((t) => t.status === "streaming");
  const stop = () => {
    for (const t of turns) if (t.status === "streaming") void hamish["ai.cancel"]({ requestId: t.id });
  };
  const retry = (turn: Turn) => ask({ question: turn.question, position: turn.position, selection: turn.selection, quotes: turn.quotes });
  /** Drops the conversation; the next question starts a fresh Claude session. */
  const reset = () => {
    stop();
    generation.current += 1;
    setTurns([]);
    sessionId.current = null;
  };
  return { turns, ask, busy, stop, retry, reset };
};

const ARABIC_START = /^[^\p{L}]*\p{Script=Arabic}/u;

type Cite = Extract<Segment, { kind: "cite" }>;

/** Where a citation or quote points, for jumping to it on the page. */
export type Citation = Omit<Cite, "kind"> & { position: number };

const citeLabel = (c: Omit<Cite, "kind">) => {
  if (c.part === "hashiya") return `ḥāshiya ${arabicNumber(c.from)}${c.to === c.from ? "" : `–${arabicNumber(c.to)}`}`;
  return c.from === c.to ? `line ${c.from}` : `lines ${c.from}–${c.to}`;
};

/** A pasted span as a citation: part of one line keeps its words, more than one line cites the lines. */
const quoteCitation = (span: Span): Omit<Cite, "kind"> => ({
  part: span.part,
  from: span.start.line,
  to: span.end.line,
  words: span.start.line === span.end.line ? { from: span.start.word, to: span.end.word } : null,
});

/**
 * A citation or quote: a small label that shows the exact words on hover and
 * jumps to them on click. The words show in a portalled tooltip so the
 * panel's scrolling doesn't clip them.
 */
const CiteChip = ({
  label,
  text,
  onClick,
  onRemove,
  onBubble = false,
}: {
  label: string;
  text: string | null;
  onClick?: () => void;
  onRemove?: () => void;
  /** Inside a sent question, which already has the accent tint. */
  onBubble?: boolean;
}) => (
  <Tooltip disabled={!text} disableHoverablePopup>
    <TooltipTrigger
      render={<span />}
      className={cx(
        "mx-0.5 inline-flex translate-y-px items-center gap-1 rounded-md align-baseline font-sans text-xs text-accent",
        onBubble ? "bg-surface" : "bg-accent-soft",
      )}
    >
      <button
        type="button"
        disabled={!onClick}
        onClick={onClick}
        className={cx("inline-flex items-center gap-1 rounded-md py-0.5 pl-1.5", onRemove ? "pr-0.5" : "pr-1.5", onClick && "hover:underline")}
      >
        <QuoteIcon aria-hidden className="size-3" />
        {label}
      </button>
      {onRemove && (
        <button type="button" aria-label={`Remove ${label}`} onClick={onRemove} className="rounded-sm py-0.5 pr-1 hover:text-ink">
          <X aria-hidden className="size-3" />
        </button>
      )}
    </TooltipTrigger>
    <TooltipContent
      sideOffset={6}
      // Keeps the surface look of the reader's other floating layers; the dark arrow doesn't fit it.
      arrow={false}
      className="block w-max max-w-80 rounded-lg border border-line bg-surface px-3 py-2 text-ink shadow-md"
    >
      <span dir="rtl" className="ar line-clamp-4 block text-right text-ar-body text-ink">
        {text}
      </span>
    </TooltipContent>
  </Tooltip>
);

/** An answer's citation: its words come from the page the question was asked on. */
const AnswerCite = ({ bookId, cite, position, onCite }: { bookId: string; cite: Cite; position: number; onCite: (c: Citation) => void }) => {
  const page = usePage({ bookId, position });
  const span = page.data ? citeSpan({ cite, page: page.data.page }) : null;
  const { kind: _, ...where } = cite;
  return <CiteChip label={citeLabel(cite)} text={span && page.data ? quoteSpan({ page: page.data.page, span }) : null} onClick={() => onCite({ ...where, position })} />;
};

/** An answer, one element per line so each line takes its own direction. Citations become chips. */
const Answer = ({ text, cite }: { text: string; cite: (c: Cite, key: number) => ReactNode }) => (
  <div className="flex flex-col gap-3">
    {text
      .trim()
      .split(/\n{2,}/)
      .map((paragraph, p) => (
        <div key={p} className="flex flex-col gap-1">
          {paragraph.split("\n").map((line, l) => (
            <p
              key={l}
              dir="auto"
              className={cx("[unicode-bidi:plaintext]", ARABIC_START.test(line) ? "ar text-ar-body" : "text-body leading-relaxed")}
            >
              {parseCitations(line).map((s, i) => (s.kind === "text" ? <span key={i}>{s.text}</span> : cite(s, i)))}
            </p>
          ))}
        </div>
      ))}
  </div>
);

const plainAnswer = (text: string) =>
  parseCitations(text)
    .map((s) => (s.kind === "text" ? s.text : citeLabel(s)))
    .join("")
    .trim();

const quoteLabel = (q: Quote) => (q.span ? citeLabel(quoteCitation(q.span)) : "Pasted");

/** Pasted passages, as chips like the answer's citations: hover for the words, click to jump to them. */
const QuoteChips = ({
  quotes,
  onCite,
  onRemove,
  onBubble,
}: {
  quotes: Quote[];
  onCite: (c: Citation) => void;
  onRemove?: (id: string) => void;
  onBubble?: boolean;
}) => (
  <div className="-mx-0.5 flex flex-wrap gap-y-1">
    {quotes.map((q) => {
      const { span } = q;
      return (
        <CiteChip
          key={q.id}
          label={quoteLabel(q)}
          text={q.text}
          onBubble={onBubble}
          onClick={span ? () => onCite({ ...quoteCitation(span), position: q.position }) : undefined}
          onRemove={onRemove && (() => onRemove(q.id))}
        />
      );
    })}
  </div>
);

export const AskPanel = ({
  bookId,
  conversation,
  position,
  pageNumber,
  selection,
  onClearSelection,
  onCite,
  onSaveNote,
}: {
  bookId: string;
  conversation: ReturnType<typeof useAskConversation>;
  position: number;
  pageNumber: number;
  selection: AskSelection | null;
  onClearSelection: () => void;
  onCite: (cite: Citation) => void;
  onSaveNote: (turn: Turn & { selection: AskSelection }, body: string) => void;
}) => {
  const { turns, ask, busy, stop, retry, reset } = conversation;
  const [draft, setDraft] = useState("");
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const end = useRef<HTMLDivElement>(null);
  const activeSelection = selection && selection.position === position ? selection : null;

  const lastAnswer = turns.at(-1)?.answer;
  useEffect(() => {
    if (lastAnswer !== undefined || turns.length) end.current?.scrollIntoView({ block: "end" });
  }, [lastAnswer, turns.length]);

  const send = (question: string) => {
    if ((!question.trim() && quotes.length === 0) || busy) return;
    ask({ question: question.trim() || "Explain this passage.", position, selection: activeSelection, quotes });
    setDraft("");
    setQuotes([]);
  };

  // Text copied from the page becomes a quote with its lines; Arabic from elsewhere becomes a plain quote.
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const text = e.clipboardData.getData("text/plain");
    const fromPage = copiedPassage(text);
    const arabicOnly = /\p{Script=Arabic}/u.test(text) && !/[A-Za-z]/.test(text);
    if (!fromPage && !arabicOnly) return;
    e.preventDefault();
    setQuotes((all) => [
      ...all,
      { id: crypto.randomUUID(), text: fromPage?.text ?? text.trim(), span: fromPage?.span ?? null, position: fromPage?.position ?? position },
    ]);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(draft);
    }
  };

  const firstWord = activeSelection?.text.split(/\s+/)[0];
  const suggestions = activeSelection
    ? [
        { icon: Languages, label: "Translate", question: "Translate the selected words into English." },
        { icon: ListTree, label: "Parse it (iʿrāb)", question: "Give the iʿrāb of the selected words." },
        { icon: Lightbulb, label: `Explain ${firstWord}`, question: `What does ${firstWord} mean here?` },
      ]
    : [
        { icon: TextQuote, label: "Summarise this page", question: "Summarise this page in a few sentences." },
        { icon: Languages, label: "Translate the first lines", question: "Translate the first few lines of this page." },
        { icon: Lightbulb, label: "Explain the hardest line", question: "Which line on this page is hardest, and what does it mean?" },
      ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {turns.length > 0 && (
        <div className="flex shrink-0 items-center border-b border-line px-5 py-2">
          <span className="text-xs text-ink-3">
            {turns.length} {turns.length === 1 ? "question" : "questions"}
          </span>
          <span className="flex-1" />
          <Button variant="ghost" size="sm" icon={SquarePen} onClick={reset}>
            New conversation
          </Button>
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-5">
        {activeSelection && (
          <div className="flex flex-col gap-2 rounded-xl bg-surface-2 px-4 py-3">
            <div className="flex items-center gap-1.5 text-xs text-ink-3">
              <TextQuote aria-hidden className="size-3.5" />
              Selected on page {arabicNumber(pageNumber)}
              <span className="flex-1" />
              <IconButton icon={X} label="Clear selection" onClick={onClearSelection} />
            </div>
            <p className="ar border-r-2 border-accent pr-3 text-right text-ar-body">{activeSelection.text}</p>
          </div>
        )}

        {turns.length === 0 && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <h2 className="font-display text-title font-semibold">{activeSelection ? "Ask about this passage" : "Ask about this page"}</h2>
              <p className="text-sm text-ink-3">Claude answers from this page and links to the lines it uses.</p>
            </div>
            <div className="flex flex-col items-start gap-2">
              {suggestions.map((s) => (
                <Button key={s.label} variant="secondary" icon={s.icon} onClick={() => send(s.question)}>
                  <span dir="auto">{s.label}</span>
                </Button>
              ))}
            </div>
          </div>
        )}

        {turns.map((turn) => (
          <div key={turn.id} className="flex flex-col gap-3">
            <div className="flex max-w-[85%] flex-col gap-2 self-end rounded-xl bg-accent-soft px-3.5 py-2.5">
              {turn.quotes.length > 0 && <QuoteChips quotes={turn.quotes} onCite={onCite} onBubble />}
              <p dir="auto" className="text-body [unicode-bidi:plaintext]">
                {turn.question}
              </p>
            </div>
            {turn.answer && (
              <Answer text={turn.answer} cite={(c, key) => <AnswerCite key={key} bookId={bookId} cite={c} position={turn.position} onCite={onCite} />} />
            )}
            {turn.status === "streaming" && (
              <p className="flex items-center gap-2 text-xs text-ink-3">
                <span className="size-1.5 animate-pulse rounded-full bg-accent" />
                {turn.activity ?? "Writing…"}
              </p>
            )}
            {turn.status === "error" && <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{turn.error}</p>}
            {turn.status !== "streaming" && (
              <div className="flex items-center gap-1">
                {turn.status === "done" && turn.selection && (
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={NotebookPen}
                    disabled={saved.has(turn.id)}
                    onClick={() => {
                      if (!turn.selection) return;
                      onSaveNote({ ...turn, selection: turn.selection }, plainAnswer(turn.answer));
                      setSaved((s) => new Set(s).add(turn.id));
                    }}
                  >
                    {saved.has(turn.id) ? "Saved as note" : "Save as note"}
                  </Button>
                )}
                {turn.status === "done" && <IconButton icon={Copy} label="Copy answer" onClick={() => void navigator.clipboard.writeText(plainAnswer(turn.answer))} />}
                <IconButton icon={RotateCcw} label="Ask again" onClick={() => retry(turn)} />
              </div>
            )}
          </div>
        ))}
        <div ref={end} />
      </div>

      <div className="shrink-0 p-4 pt-0">
        <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-3 focus-within:border-ink-3">
          {quotes.length > 0 && <QuoteChips quotes={quotes} onCite={onCite} onRemove={(id) => setQuotes((all) => all.filter((x) => x.id !== id))} />}
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            rows={2}
            dir="auto"
            placeholder={activeSelection ? "Ask about this passage…" : "Ask about this page…"}
            className="resize-none bg-transparent text-body outline-none placeholder:text-ink-3 [unicode-bidi:plaintext]"
          />
          <div className="flex items-center gap-2">
            <span className="flex-1" />
            {busy ? (
              <Button variant="secondary" size="sm" icon={Square} onClick={stop}>
                Stop
              </Button>
            ) : (
              <Button size="sm" icon={ArrowUp} disabled={!draft.trim() && quotes.length === 0} onClick={() => send(draft)}>
                Ask
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
