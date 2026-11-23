import { ArrowDown, ArrowLeft, ArrowUp, BookA, Copy, History, LoaderCircle, Sparkles, Lightbulb, MessageCircleQuestion, NotebookPen, Pencil, PenLine, Quote as QuoteIcon, RotateCcw, SendHorizontal, Square, SquarePen, Star, TextQuote, Trash2, X } from "lucide-react";
import { type ClipboardEvent, type KeyboardEvent, type MouseEvent, type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { quoteSpan, type Span } from "../../../shared/annotations";
import { citedGloss, citeSpan, isArabicLine, parseCitations, type Segment } from "../../../shared/ask";
import { type ComposerPart, parseComposer, questionWithQuoteMarks, serializeComposer } from "../../../shared/composer";
import type { AskSelection, Conversation, ConversationSummary, Quote, StoredTurn } from "../../../shared/conversations";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { afterAnswer, type AnswerEnd, type AskQueue, dequeue, emptyQueue, enqueue, sendFirst } from "../lib/ask-queue";
import { copiedPassage } from "../lib/copied";
import { arabicNumber, timeAgo } from "../lib/format";
import { keys, midad, usePage } from "../lib/midad";
import { handleKeys } from "../lib/use-keybindings";
import { Button, IconButton, Toast, ToastAction, cx } from "./ui";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

export type { AskSelection, Quote };

export interface Turn extends Omit<StoredTurn, "createdAt"> {
  /** While streaming: what Claude is doing, e.g. reading the page. */
  activity: string | null;
  /** Answered in a new Claude session because the old one was gone. Only known for answers given since the panel opened. */
  restarted?: boolean;
}

/** How long a deleted conversation can be brought back; a little longer than its toast shows. */
const UNDO_DELETE_MS = 4500;

/** The composer's line height in px (`text-body`). */
const COMPOSER_LINE = 24;
const COMPOSER_ROWS = 3;

const fromStored = ({ createdAt: _, ...turn }: StoredTurn): Turn => ({ ...turn, activity: null });

/** The error of an answer the reader stopped: shown as a note, not a failure. */
const STOPPED = "Stopped.";

/** A question typed while Claude was answering, waiting its turn. It keeps the page and selection it was typed on. */
export interface QueuedMessage {
  id: string;
  question: string;
  quotes: Quote[];
  position: number;
  selection: AskSelection | null;
}

/**
 * One Ask AI conversation for a book: a Claude session continued across questions.
 * A new one lives only in memory until it's saved; once saved, each question is saved as it's asked.
 * Opening the book brings back its most recently used saved one.
 */
export const useAskConversation = ({ bookId, onNew }: { bookId: string; /** A new conversation starts: the reader's selection goes with the old one. */ onNew?: () => void }) => {
  const client = useQueryClient();
  const [turns, setTurns] = useState<Turn[]>([]);
  // The turns as last drawn, for a question asked from a callback (the queue, Send now).
  const turnsNow = useRef(turns);
  turnsNow.current = turns;
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const isSaved = useRef(false);
  const current = useRef<string | null>(null);
  const sessionId = useRef<string | null>(null);
  // Bumped whenever another conversation is shown, so a late load or answer can't revive the old one.
  const generation = useRef(0);
  const update = useCallback((id: string, change: (t: Turn) => Partial<Turn>) => {
    setTurns((all) => all.map((t) => (t.id === id ? { ...t, ...change(t) } : t)));
  }, []);
  const history = useQuery({ queryKey: keys.conversations(bookId), queryFn: () => midad["conversations.list"]({ bookId }) });
  const [deleted, setDeleted] = useState<{ id: string; wasOpen: boolean } | null>(null);
  const deleting = useRef<{ id: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  const refreshHistory = () => client.invalidateQueries({ queryKey: keys.conversations(bookId) });
  // Read by an answer as it ends, so it's kept in a ref as well as in state.
  const queueRef = useRef<AskQueue<QueuedMessage>>(emptyQueue());
  const [queue, setQueueState] = useState(queueRef.current);
  const setQueue = useCallback((next: AskQueue<QueuedMessage>) => {
    queueRef.current = next;
    setQueueState(next);
  }, []);
  // Answers the reader stopped, so their end pauses the queue rather than counting as a failure.
  const stopped = useRef(new Set<string>());

  const show = useCallback((conversation: Conversation | null) => {
    generation.current += 1;
    current.current = conversation?.id ?? null;
    setConversationId(current.current);
    isSaved.current = conversation !== null;
    setSaved(isSaved.current);
    sessionId.current = conversation?.sessionId ?? null;
    setTurns(conversation?.turns.map(fromStored) ?? []);
    setQueue(emptyQueue());
  }, [setQueue]);

  const load = useCallback(
    (fetch: () => Promise<Conversation | null>) => {
      show(null);
      const started = generation.current;
      void fetch().then((conversation) => {
        if (started === generation.current) show(conversation);
      });
    },
    [show],
  );

  useEffect(() => load(() => midad["conversations.latest"]({ bookId })), [bookId, load]);

  useEffect(
    () =>
      window.midadEvents.onAskEvent((requestId, event) => {
        if (event.kind === "delta") update(requestId, (t) => ({ answer: t.answer + event.text, activity: null }));
        if (event.kind === "tool") update(requestId, (t) => ({ activity: "Reading the page…", answer: t.answer && !t.answer.endsWith("\n\n") ? `${t.answer}\n\n` : t.answer }));
      }),
    [update],
  );

  const ask = async ({ question, position, selection, quotes = [] }: { question: string; position: number; selection: AskSelection | null; quotes?: Quote[] }) => {
    const id = crypto.randomUUID();
    if (!current.current) {
      current.current = crypto.randomUUID();
      setConversationId(current.current);
    }
    const conversation = current.current;
    const started = generation.current;
    // Claude's session only keeps answers that finished; the stopped ones since go along with this question.
    const earlier = turnsNow.current;
    const cutOff = earlier.slice(earlier.findLastIndex((t) => t.status === "done") + 1).map((t) => ({ question: t.question, answer: t.answer, status: t.status, quotes: t.quotes.map((q) => ({ text: q.text })) }));
    const ended = (end: AnswerEnd) => {
      stopped.current.delete(id);
      if (started !== generation.current) return;
      const { next, queue: after } = afterAnswer({ queue: queueRef.current, end });
      setQueue(after);
      if (next) void ask(next);
    };
    setTurns((all) => [...all, { id, question, quotes, position, selection, answer: "", status: "streaming", activity: "Starting Claude…", error: null }]);
    if (isSaved.current) {
      try {
        await midad["conversations.addTurn"]({ conversationId: conversation, bookId, turn: { id, question, quotes, position, selection } });
      } catch (err) {
        update(id, () => ({ status: "error", activity: null, error: err instanceof Error ? err.message : String(err) }));
        ended("error");
        return;
      }
      void refreshHistory();
    }
    midad["ai.ask"]({
      requestId: id,
      bookId,
      position,
      question: questionWithQuoteMarks({ question, quotes }) || "Explain this passage.",
      selection: selection && position === selection.position ? { span: selection.span, text: selection.text } : undefined,
      quotes: quotes.map((q) => ({ text: q.text, span: q.position === position ? q.span : null })),
      sessionId: sessionId.current,
      cutOff,
    })
      .then(
        (result) => {
          if (started === generation.current) sessionId.current = result.sessionId || sessionId.current;
          update(id, () => ({ answer: result.text, status: "done", activity: null, restarted: result.restarted }));
          ended("done");
        },
        (err: unknown) => {
          update(id, () => ({ status: "error", activity: null, error: err instanceof Error ? err.message : String(err) }));
          ended(stopped.current.has(id) ? "stopped" : "error");
        },
      )
      .finally(() => {
        if (isSaved.current) void refreshHistory();
      });
  };

  const busy = turns.some((t) => t.status === "streaming");
  const stop = () => {
    for (const t of turns) {
      if (t.status !== "streaming") continue;
      stopped.current.add(t.id);
      void midad["ai.cancel"]({ requestId: t.id });
    }
  };
  const queueMessage = (message: Omit<QueuedMessage, "id">) => setQueue(enqueue({ queue: queueRef.current, item: { id: crypto.randomUUID(), ...message } }));
  /** Sends a message at once: an answer in progress is stopped first, keeping what it wrote so far. */
  const sendNow = (message: QueuedMessage) => {
    if (!busy) {
      setQueue(dequeue({ queue: { ...queueRef.current, paused: false }, id: message.id }));
      void ask(message);
      return;
    }
    setQueue(sendFirst({ queue: queueRef.current, item: message }));
    stop();
  };
  const sendQueuedNow = (id: string) => {
    const message = queueRef.current.items.find((m) => m.id === id);
    if (message) sendNow(message);
  };
  const sendDraftNow = (message: Omit<QueuedMessage, "id">) => sendNow({ id: crypto.randomUUID(), ...message });
  /** Takes a message out of the queue, to edit it in the composer. */
  const takeQueued = (id: string): QueuedMessage | null => {
    const message = queueRef.current.items.find((m) => m.id === id) ?? null;
    setQueue(dequeue({ queue: queueRef.current, id }));
    return message;
  };
  const removeQueued = (id: string) => setQueue(dequeue({ queue: queueRef.current, id }));
  const retry = (turn: Turn) => {
    const message = { question: turn.question, position: turn.position, selection: turn.selection, quotes: turn.quotes };
    if (busy) queueMessage(message);
    else void ask(message);
  };
  /** Starts a fresh conversation and Claude session; the old one stays in the history. */
  const reset = () => {
    stop();
    show(null);
  };
  /** Shows a saved conversation; the next question continues its Claude session. */
  const open = (id: string) => {
    if (id === current.current) return;
    stop();
    load(() => midad["conversations.get"]({ id }));
  };
  /** Saves the open conversation with everything asked so far; later questions save as they're asked. */
  const save = async () => {
    const id = current.current;
    if (!id || isSaved.current || turns.length === 0) return;
    isSaved.current = true;
    setSaved(true);
    try {
      await midad["conversations.save"]({ id, bookId, sessionId: sessionId.current, turns: turns.map(({ activity: _, restarted: __, ...turn }) => turn) });
    } catch {
      if (current.current === id) {
        isSaved.current = false;
        setSaved(false);
      }
    } finally {
      void refreshHistory();
    }
  };
  const rename = async ({ id, title }: { id: string; title: string }) => {
    await midad["conversations.rename"]({ id, title });
    void refreshHistory();
  };
  const nameWithClaude = async (id: string) => {
    try {
      await midad["conversations.nameWithClaude"]({ id });
    } finally {
      void refreshHistory();
    }
  };

  /** Deletes the conversation for good once the chance to undo has passed. */
  const commitDelete = useCallback(() => {
    const pending = deleting.current;
    if (!pending) return;
    deleting.current = null;
    clearTimeout(pending.timer);
    setDeleted(null);
    void midad["conversations.remove"]({ id: pending.id }).finally(() => void client.invalidateQueries({ queryKey: keys.conversations(bookId) }));
  }, [client, bookId]);
  useEffect(() => commitDelete, [commitDelete]);

  const remove = (id: string) => {
    commitDelete();
    const wasOpen = id === current.current;
    if (wasOpen) reset();
    deleting.current = { id, timer: setTimeout(commitDelete, UNDO_DELETE_MS) };
    setDeleted({ id, wasOpen });
  };
  const undoDelete = () => {
    const pending = deleting.current;
    if (!pending) return;
    clearTimeout(pending.timer);
    deleting.current = null;
    if (deleted?.wasOpen) load(() => midad["conversations.get"]({ id: pending.id }));
    setDeleted(null);
  };

  // `moved` stays false until the first switch, so the panel doesn't slide in when it opens.
  const [screen, setScreen] = useState<{ name: "chat" | "history"; moved: boolean }>({ name: "chat", moved: false });
  const showScreen = (name: "chat" | "history") => setScreen({ name, moved: true });
  // Bumped to put the caret in the composer once a new conversation is showing.
  const [composeRequest, setComposeRequest] = useState(0);
  const startNew = () => {
    reset();
    onNew?.();
    if (screen.name !== "chat") showScreen("chat");
    setComposeRequest((n) => n + 1);
  };

  return {
    screen,
    showScreen,
    startNew,
    nameWithClaude,
    composeRequest,
    turns,
    ask,
    busy,
    stop,
    retry,
    queue,
    queueMessage,
    sendQueuedNow,
    sendDraftNow,
    takeQueued,
    removeQueued,
    reset,
    open,
    conversationId,
    saved,
    save,
    rename,
    history: (history.data ?? []).filter((c) => c.id !== deleted?.id),
    remove,
    undoDelete,
    commitDelete,
    deleted: deleted !== null,
  };
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
  phrase: null,
});

/**
 * A citation or quote: a small pill that reads the quoted words, shows them
 * in full with their line on hover, and jumps to them on click. The words show
 * in a portalled tooltip so the panel's scrolling doesn't clip them.
 */
const CiteChip = ({
  label,
  text,
  pillText = text,
  quoted = false,
  onClick,
  onRemove,
  onBubble = false,
  missing = false,
}: {
  label: string;
  text: string | null;
  /** What a quoted pill reads, when it differs from the tooltip's `text`. */
  pillText?: string | null;
  /** The pill shows `pillText` (cut short) instead of `label`; the tooltip names the label above the full text. */
  quoted?: boolean;
  /** The citation's words aren't on the page: shown muted, with `text` saying so, and it goes nowhere. */
  missing?: boolean;
  onClick?: () => void;
  onRemove?: () => void;
  /** Inside a sent question, which already has the accent tint. */
  onBubble?: boolean;
}) => (
  <Tooltip disabled={!text} disableHoverablePopup>
    <TooltipTrigger
      // The label is English: keep its icon first inside right-to-left text too.
      render={<span dir="ltr" />}
      className={cx(
        "mx-0.5 inline-flex max-w-full translate-y-px items-center gap-1 rounded-md align-baseline font-sans text-xs text-accent [unicode-bidi:isolate]",
        // In a sent question the chips flow with its words, centred on the line.
        onBubble ? "translate-y-0 bg-surface align-middle" : "bg-accent-soft",
        onRemove && "translate-y-0 align-top",
        missing && "bg-ink/6 text-ink-3",
      )}
    >
      <button
        type="button"
        disabled={!onClick}
        onClick={onClick}
        aria-label={quoted ? `${label}: ${pillText}` : undefined}
        // In the composer a pill fits its 24px line exactly, so a line holding one doesn't grow or scroll.
        className={cx("inline-flex min-w-0 items-center gap-1 rounded-md pl-1.5", onRemove ? "py-0 pr-0.5" : "py-0.5 pr-1.5", onClick && "hover:underline")}
      >
        <QuoteIcon aria-hidden className="size-3 shrink-0" />
        {quoted ? (
          <span dir="rtl" className="ar max-w-56 truncate text-ar-small leading-6">
            {pillText}
          </span>
        ) : (
          label
        )}
      </button>
      {onRemove && (
        <button type="button" aria-label={quoted ? "Remove quote" : `Remove ${label}`} onClick={onRemove} className="rounded-sm pr-1 hover:text-ink">
          <X aria-hidden className="size-3" />
        </button>
      )}
    </TooltipTrigger>
    <TooltipContent
      sideOffset={6}
      // Keeps the surface look of the reader's other floating layers; the dark arrow doesn't fit it.
      arrow={false}
      className="block w-max max-w-80 rounded-xl bg-surface-3 px-3 py-2 text-ink shadow-float"
    >
      {quoted && !missing && <span className="mb-1 block text-xs text-ink-3">{label}</span>}
      {missing ? (
        <span className="block text-xs text-ink-2">{text}</span>
      ) : (
          <span dir="rtl" className="ar line-clamp-4 block text-right text-ar-body text-ink">
            {text}
          </span>
        )}
      </TooltipContent>
    </Tooltip>
  );

  /** An answer's citation: its words come from the page the question was asked on. */
  const AnswerCite = ({ bookId, cite, position, onCite }: { bookId: string; cite: Cite; position: number; onCite: (c: Citation) => void }) => {
    const page = usePage({ bookId, position });
    const span = page.data ? citeSpan({ cite, page: page.data.page }) : null;
    const { kind: _, ...where } = cite;
    const label = citeLabel(cite);
    if (page.data && !span) return <CiteChip label={label} text={`Couldn't find this on ${label}`} pillText={cite.phrase ?? label} quoted missing />;
    // The page's own words, with its harakat, rather than the AI's spelling of them.
    const words = span && page.data ? quoteSpan({ page: page.data.page, span }) : null;
    // A quoted gloss shows the gloss, with the words it explains in the tooltip.
    const gloss = page.data ? citedGloss({ cite, page: page.data.page }) : null;
    if (gloss) return <CiteChip label={`gloss on ${label}${words ? `: ${words}` : ""}`} text={gloss.text} pillText={gloss.text} quoted onClick={() => onCite({ ...where, position })} />;
    return <CiteChip label={label} text={words} pillText={words ?? cite.phrase ?? label} quoted onClick={() => onCite({ ...where, position })} />;
  };

  /** An answer, one element per line so each line takes its own direction. Citations become quote pills. */
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
                className={cx("[unicode-bidi:plaintext]", isArabicLine(line) ? "ar text-ar-body" : "text-body leading-relaxed")}
              >
                {parseCitations(line).map((s, i) => (s.kind === "text" ? <span key={i}>{s.text}</span> : cite(s, i)))}
              </p>
            ))}
          </div>
        ))}
    </div>
  );

  /**
   * Text that arrives in bursts, revealed at a steady pace: each frame shows a share of what's still hidden,
   * so it keeps up with a fast stream without jumping. Text that's already complete shows at once.
   */
  const useSmoothText = (text: string, streaming: boolean) => {
    const [shown, setShown] = useState(streaming ? 0 : text.length);
    const length = useRef(text.length);
    length.current = text.length;
    useEffect(() => {
      if (shown >= text.length) return;
      if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
        setShown(text.length);
        return;
      }
      const frame = requestAnimationFrame(() => setShown((n) => Math.min(length.current, n + Math.max(2, Math.ceil((length.current - n) / 12)))));
      return () => cancelAnimationFrame(frame);
    }, [shown, text.length]);
    return text.slice(0, shown);
  };

  /** Drops a citation still being written, so `[[line 2: …` never shows as raw brackets. */
  const withoutOpenCite = (text: string) => {
    const open = text.lastIndexOf("[[");
    return open !== -1 && !text.includes("]]", open) ? text.slice(0, open) : text;
  };

  const StreamedAnswer = ({ text, streaming, cite }: { text: string; streaming: boolean; cite: (c: Cite, key: number) => ReactNode }) => {
    const shown = withoutOpenCite(useSmoothText(text, streaming));
    return shown.trim() ? <Answer text={shown} cite={cite} /> : null;
  };

  const plainAnswer = (text: string) =>
    parseCitations(text)
      .map((s) => (s.kind === "text" ? s.text : citeLabel(s)))
      .join("")
      .trim();

  const quoteLabel = (q: Quote) => (q.span ? citeLabel(quoteCitation(q.span)) : "Pasted");

  const QuoteChip = ({ quote, onCite, onRemove, onBubble }: { quote: Quote; onCite: (c: Citation) => void; onRemove?: () => void; onBubble?: boolean }) => {
    const { span } = quote;
    return (
      <CiteChip
        label={quoteLabel(quote)}
        text={quote.text}
        quoted
        onBubble={onBubble}
        onClick={span ? () => onCite({ ...quoteCitation(span), position: quote.position }) : undefined}
        onRemove={onRemove}
      />
    );
  };

  const PILL_ATTR = "data-quote-id";

  /** The composer's text and pills, in order. A pill's own label isn't part of the text. */
  const readComposer = ({ root, quotes }: { root: HTMLElement; quotes: Map<string, Quote> }): ComposerPart[] => {
    const parts: ComposerPart[] = [];
    const walk = (node: Node) => {
      for (const child of node.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) parts.push({ kind: "text", text: child.textContent ?? "" });
        if (!(child instanceof HTMLElement)) continue;
        const id = child.getAttribute(PILL_ATTR);
        const quote = id ? quotes.get(id) : undefined;
        if (quote) parts.push({ kind: "quote", quote });
        else if (child.tagName === "BR") parts.push({ kind: "text", text: "\n" });
        else if (!id) walk(child);
      }
    };
    walk(root);
    return parts;
  };

  const caretAtEnd = (root: HTMLElement) => {
    const range = document.createRange();
    range.selectNodeContents(root);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  };

  /** The node just before a collapsed caret, if the caret sits right after it. */
  const nodeBeforeCaret = (range: Range): Node | null => {
    const { startContainer, startOffset } = range;
    if (startContainer.nodeType === Node.TEXT_NODE) return startOffset === 0 ? startContainer.previousSibling : null;
    return startOffset > 0 ? startContainer.childNodes[startOffset - 1] ?? null : null;
  };

  /** The page a conversation started on: its printed number when it has one, else its place in the book. */
  const conversationPage = (c: ConversationSummary): string | null => {
    if (c.pageNumber !== null) return `ص ${arabicNumber(c.pageNumber)}`;
    return c.position === null ? null : `Page ${c.position}`;
  };

  /** A conversation's title edited in place: Enter or leaving the field saves, Esc cancels. */
  const TitleField = ({ title, onDone }: { title: string; onDone: (title: string | null) => void }) => {
    const cancelled = useRef(false);
    return (
      <input
        autoFocus
        defaultValue={title}
        aria-label="Conversation title"
        dir="auto"
        maxLength={80}
        onFocus={(e) => e.currentTarget.select()}
        onKeyDown={(e) =>
          handleKeys({
            event: e,
            handlers: {
              "field.commit": () => e.currentTarget.blur(),
              "field.cancel": () => {
                cancelled.current = true;
                e.currentTarget.blur();
              },
            },
          })
        }
        onBlur={(e) => onDone(cancelled.current ? null : e.currentTarget.value)}
        className="-mx-1.5 rounded-md border border-ink-3 bg-surface px-1.5 text-sm outline-hidden [unicode-bidi:plaintext]"
      />
    );
  };

  /** The book's saved conversations, most recent first; opening one continues its Claude session. */
  const ConversationList = ({
    history,
    currentId,
    onOpen,
    onRename,
    onNameWithClaude,
    onDelete,
  }: {
    history: ConversationSummary[];
    currentId: string | null;
    onOpen: (id: string) => void;
    onRename: (input: { id: string; title: string }) => void;
    onNameWithClaude: (id: string) => Promise<void>;
    onDelete: (id: string) => void;
  }) => {
    const [editing, setEditing] = useState<string | null>(null);
    const [naming, setNaming] = useState<Set<string>>(new Set());
    const [failed, setFailed] = useState<{ id: string; message: string } | null>(null);
    const nameIt = (id: string) => {
      setFailed(null);
      setNaming((all) => new Set(all).add(id));
      onNameWithClaude(id)
        .catch((err: unknown) => setFailed({ id, message: err instanceof Error ? err.message : String(err) }))
        .finally(() =>
          setNaming((all) => {
            const next = new Set(all);
            next.delete(id);
            return next;
          }),
        );
    };
    // A deleted row folds away before it leaves the list.
    const [leaving, setLeaving] = useState<string | null>(null);
    return (
      <>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-2">
          {history.length === 0 && (
            <div className="flex flex-col items-center gap-1 px-6 py-16 text-center">
              <Star aria-hidden className="mb-2 size-5 text-ink-3" />
              <p className="text-sm font-medium">No saved conversations</p>
              <p className="text-sm text-ink-3">Save a conversation to come back to it here.</p>
            </div>
          )}
          {history.map((c) => {
            const page = conversationPage(c);
            const meta = failed?.id === c.id ? (
              <span className="truncate text-xs text-danger">Couldn't name it: {failed.message}</span>
            ) : (
              <span className="text-xs text-ink-3">
                {page && (
                  <>
                    <span dir="auto" className="[unicode-bidi:isolate]">
                      {page}
                    </span>
                    {" · "}
                  </>
                )}
                {timeAgo(c.updatedAt)}
              </span>
            );
            return (
              <div
                key={c.id}
                data-state={leaving === c.id ? "leaving" : undefined}
                onTransitionEnd={(e) => {
                  if (e.target !== e.currentTarget || e.propertyName !== "grid-template-rows" || leaving !== c.id) return;
                  setLeaving(null);
                  onDelete(c.id);
                }}
                className="grid shrink-0 grid-rows-[1fr] transition-[grid-template-rows,opacity] duration-pop ease-out data-[state=leaving]:grid-rows-[0fr] data-[state=leaving]:opacity-0 motion-reduce:transition-none"
              >
                <div className="group/row relative min-h-0 overflow-hidden">
                  {editing === c.id ? (
                    <div className="flex flex-col gap-0.5 rounded-lg bg-ink/6 py-2 pr-2.5 pl-2.5">
                      <TitleField
                        title={c.title}
                        onDone={(title) => {
                          setEditing(null);
                          if (title !== null && title.trim() && title.trim() !== c.title) onRename({ id: c.id, title });
                        }}
                      />
                      {meta}
                    </div>
                  ) : (
                    <>
                      <button
                        type="button"
                        aria-current={c.id === currentId || undefined}
                        onClick={() => onOpen(c.id)}
                        className="flex w-full flex-col gap-0.5 rounded-lg py-2 pr-28 pl-2.5 text-left transition-colors duration-press hover:bg-ink/6 aria-[current]:bg-accent-soft"
                      >
                        <span
                          key={c.title}
                          dir="auto"
                          className={cx(
                            "truncate text-sm [unicode-bidi:plaintext] animate-in fade-in duration-pop",
                            naming.has(c.id) && "animate-pulse motion-reduce:animate-none motion-reduce:opacity-60",
                          )}
                        >
                          {c.title || "Untitled"}
                        </span>
                        {meta}
                      </button>
                      <div
                        className={cx(
                          "absolute top-1/2 right-1 flex -translate-y-1/2 items-center opacity-0 transition-opacity duration-press group-hover/row:opacity-100 has-focus-visible:opacity-100",
                          naming.has(c.id) && "opacity-100",
                        )}
                      >
                        <IconButton
                          icon={naming.has(c.id) ? LoaderCircle : Sparkles}
                          label={naming.has(c.id) ? "Naming…" : "Name with Claude"}
                          disabled={naming.has(c.id)}
                          className={naming.has(c.id) ? "[&_svg]:animate-spin" : undefined}
                          onClick={() => nameIt(c.id)}
                        />
                        <IconButton icon={Pencil} label="Rename" onClick={() => setEditing(c.id)} />
                        <IconButton icon={Trash2} label="Delete conversation" onClick={() => (reduceMotion() ? onDelete(c.id) : setLeaving(c.id))} />
                      </div>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </>
    );
  };

  const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

  /**
   * The list as it's drawn: items taken out stay, marked leaving, until they've folded away.
   * Each leaving item keeps its place among the others.
   */
  const useLeavingList = <T extends { id: string }>(items: T[]) => {
    const [shown, setShown] = useState(() => items.map((item) => ({ item, leaving: false })));
    const [from, setFrom] = useState(items);
    if (from !== items) {
      setFrom(items);
      const next = items.map((item) => ({ item, leaving: false }));
      if (!reduceMotion())
        shown.forEach((entry, index) => {
          if (!items.some((item) => item.id === entry.item.id)) next.splice(Math.min(index, next.length), 0, { item: entry.item, leaving: true });
        });
      setShown(next);
    }
    const gone = (id: string) => setShown((all) => all.filter((entry) => !(entry.leaving && entry.item.id === id)));
    // An item that leaves before it has finished coming in may never fire transitionend.
    useEffect(() => {
      if (!shown.some((entry) => entry.leaving)) return;
      const timer = setTimeout(() => setShown((all) => all.filter((entry) => !entry.leaving)), 400);
      return () => clearTimeout(timer);
    }, [shown]);
    return { shown, gone };
  };

  const FOLD = "grid grid-rows-[1fr] transition-[grid-template-rows,opacity] duration-pop ease-out starting:grid-rows-[0fr] starting:opacity-0 data-[state=leaving]:grid-rows-[0fr] data-[state=leaving]:opacity-0 data-[state=leaving]:duration-pop-exit motion-reduce:transition-none";

  /** Questions waiting for the answer in progress, oldest first. Each can be sent now, edited or removed. */
  const QueuedMessages = ({
    queue,
    onSendNow,
    onEdit,
    onRemove,
    onCite,
  }: {
    queue: AskQueue<QueuedMessage>;
    onSendNow: (id: string) => void;
    onEdit: (id: string) => void;
    onRemove: (id: string) => void;
    onCite: (c: Citation) => void;
  }) => {
    // A question being sent now has left the queue already, as far as the reader is concerned.
    const waiting = useMemo(() => (queue.sendingNow ? queue.items.slice(1) : queue.items), [queue]);
    const { shown, gone } = useLeavingList(waiting);
    // While the last one folds away the count keeps its old number.
    const count = useRef(0);
    if (waiting.length) count.current = waiting.length;
    const first = waiting[0];
    if (shown.length === 0) return null;
    return (
      <div data-state={waiting.length ? undefined : "leaving"} className={cx(FOLD, "mb-2")}>
        <div className="min-h-0 overflow-hidden">
          <div role="list" aria-label="Queued questions" className="flex flex-col rounded-xl bg-surface-2 p-1">
            <div className="flex min-h-7 items-center gap-2 pr-1 pl-2 text-xs text-ink-3">
              {queue.paused && "Paused · "}
              {count.current} queued
              <span className="flex-1" />
              {queue.paused && first && (
                <Button variant="ghost" size="sm" onClick={() => onSendNow(first.id)}>
                  Resume
                </Button>
              )}
            </div>
            {shown.map(({ item, leaving }) => (
              <div
                key={item.id}
                role="listitem"
                data-state={leaving ? "leaving" : undefined}
                inert={leaving || undefined}
                onTransitionEnd={(e) => {
                  if (leaving && e.target === e.currentTarget && e.propertyName === "grid-template-rows") gone(item.id);
                }}
                className={FOLD}
              >
                <div className="flex min-h-0 items-center gap-0.5 overflow-hidden rounded-lg pl-2">
                  <p dir="auto" className="min-w-0 flex-1 truncate text-sm text-ink-2 [unicode-bidi:plaintext]">
                    {parseComposer(item).map((part, i) =>
                      part.kind === "quote" ? <QuoteChip key={part.quote.id} quote={part.quote} onCite={onCite} /> : <span key={i}>{part.text}</span>,
                    )}
                  </p>
                  <IconButton icon={SendHorizontal} label="Send now" onClick={() => onSendNow(item.id)} />
                  <IconButton icon={Pencil} label="Edit" onClick={() => onEdit(item.id)} />
                  <IconButton icon={X} label="Remove" onClick={() => onRemove(item.id)} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  /** The Ask AI panel's header: the title and the conversation buttons, or the way back from saved conversations. */
  export const AskHeader = ({ conversation }: { conversation: ReturnType<typeof useAskConversation> }) => {
    const { screen, showScreen, startNew, turns, saved, save } = conversation;
    if (screen.name === "history")
      return (
        <>
          <IconButton icon={ArrowLeft} label="Back to conversation" onClick={() => showScreen("chat")} />
          <h2 className="truncate text-sm font-semibold">Saved conversations</h2>
          <span className="flex-1" />
          <IconButton icon={SquarePen} label="New conversation" onClick={startNew} />
        </>
      );
    return (
      <>
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="size-4 text-accent" /> Ask AI
        </h2>
        <span className="flex-1" />
        <IconButton icon={History} label="Saved conversations" onClick={() => showScreen("history")} />
        {turns.length > 0 && (
          <IconButton
            icon={Star}
            label={saved ? "Saved" : "Save conversation"}
            selected={saved}
            className={saved ? "[&_svg]:fill-current" : undefined}
            onClick={() => void save()}
          />
        )}
        {turns.length > 0 && <IconButton icon={SquarePen} label="New conversation" onClick={startNew} />}
      </>
    );
  };

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
    const { screen, showScreen, composeRequest, turns, ask, busy, stop, retry, open, conversationId, rename, nameWithClaude, history, remove, undoDelete, commitDelete, deleted } = conversation;
    const { queue, queueMessage, sendQueuedNow, sendDraftNow, takeQueued, removeQueued } = conversation;
    const [draft, setDraft] = useState<{ question: string; quotes: Quote[]; empty: boolean }>({ question: "", quotes: [], empty: true });
    const editor = useRef<HTMLDivElement>(null);
    // Each pill's quote and the span it renders into, kept in the editor's text flow.
    const pills = useRef(new Map<string, { quote: Quote; host: HTMLElement }>());
    const [saved, setSaved] = useState<Set<string>>(new Set());
    const scroller = useRef<HTMLDivElement>(null);
    const content = useRef<HTMLDivElement>(null);
    // Follows new text while the reader is at the bottom; scrolling up lets go until they're back at the bottom.
    const pinned = useRef(true);
    const [atBottom, setAtBottom] = useState(true);
    const activeSelection = selection && selection.position === position ? selection : null;

    useEffect(() => {
      const root = editor.current;
      if (!composeRequest || !root) return;
      root.focus();
      caretAtEnd(root);
    }, [composeRequest]);

    const toBottom = useCallback(() => {
      const el = scroller.current;
      if (el) el.scrollTop = el.scrollHeight;
    }, []);
    // Set while Jump to latest scrolls down: its own scroll events aren't the reader scrolling away.
    const jumping = useRef(false);
    const onScroll = () => {
      const el = scroller.current;
      if (!el) return;
      const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
      if (jumping.current) {
        if (!bottom) return;
        jumping.current = false;
      }
      pinned.current = bottom;
      setAtBottom(bottom);
    };
    // The reader's own wheel or press takes over from a jump in progress.
    const stopJump = () => {
      jumping.current = false;
    };
    // Every new question, typed or sent from the queue, follows its answer.
    const latestTurn = turns.at(-1);
    useLayoutEffect(() => {
      if (latestTurn?.status === "streaming") pinned.current = true;
    }, [latestTurn?.id]);
    // A conversation opens at its latest message.
    useLayoutEffect(() => {
      if (screen.name !== "chat") return;
      pinned.current = true;
      setAtBottom(true);
      toBottom();
    }, [conversationId, screen.name, toBottom]);
    useEffect(() => {
      const box = content.current;
      if (screen.name !== "chat" || !box) return;
      const observer = new ResizeObserver(() => {
        if (pinned.current) toBottom();
      });
      observer.observe(box);
      return () => observer.disconnect();
    }, [screen.name, toBottom]);

    // The composer grows a line at a time up to COMPOSER_ROWS, then scrolls; each step's height change animates.
    const [rows, setRows] = useState(1);
    const measureRows = useCallback(() => {
      const root = editor.current;
      if (!root) return;
      const text = document.createRange();
      text.selectNodeContents(root);
      const drawn = Math.max(Math.ceil(text.getBoundingClientRect().height / COMPOSER_LINE - 0.25), 1);
      // A new line with nothing on it yet has no height to measure; it shows as an extra newline at the end.
      const trailing = root.innerText.match(/\n+$/)?.[0].length ?? 0;
      setRows(Math.min(drawn + Math.max(trailing - 1, 0), COMPOSER_ROWS));
    }, []);
    useEffect(() => {
      const root = editor.current;
      if (!root) return;
      const observer = new ResizeObserver(measureRows);
      observer.observe(root);
      return () => observer.disconnect();
    }, [measureRows]);

    const sync = () => {
      const root = editor.current;
      if (!root) return;
      measureRows();
      for (const [id, pill] of pills.current) if (!root.contains(pill.host)) pills.current.delete(id);
      const parts = readComposer({ root, quotes: new Map([...pills.current].map(([id, p]) => [id, p.quote])) });
      const empty = parts.every((p) => p.kind === "text" && p.text.trim() === "");
      setDraft({ ...serializeComposer(parts), empty });
    };

    const clear = () => {
      if (editor.current) editor.current.textContent = "";
      pills.current.clear();
      setDraft({ question: "", quotes: [], empty: true });
      setRows(1);
    };

    /** Asks now, or queues the question while Claude is answering. */
    const send = ({ question, quotes }: { question: string; quotes: Quote[] }) => {
      if (!question && quotes.length === 0) return;
      if (busy) queueMessage({ question, quotes, position, selection: activeSelection });
      else {
        pinned.current = true;
        void ask({ question, position, selection: activeSelection, quotes });
      }
      clear();
    };

    const sendNow = ({ question, quotes }: { question: string; quotes: Quote[] }) => {
      if (!question && quotes.length === 0) return;
      if (!busy) return send({ question, quotes });
      sendDraftNow({ question, quotes, position, selection: activeSelection });
      clear();
    };

    /** Puts a queued question back in the composer, after anything already typed there. */
    const editQueued = (id: string) => {
      const root = editor.current;
      const message = takeQueued(id);
      if (!root || !message) return;
      if (!draft.empty) root.append("\n");
      for (const part of parseComposer(message)) {
        if (part.kind === "text") {
          root.append(part.text);
          continue;
        }
        const host = document.createElement("span");
        host.contentEditable = "false";
        host.setAttribute(PILL_ATTR, part.quote.id);
        root.append(host);
        pills.current.set(part.quote.id, { quote: part.quote, host });
      }
      sync();
      root.focus();
      caretAtEnd(root);
    };

    const insertQuote = (quote: Quote) => {
      const root = editor.current;
      if (!root) return;
      const host = document.createElement("span");
      host.contentEditable = "false";
      host.setAttribute(PILL_ATTR, quote.id);
      const selection = window.getSelection();
      const atCaret = document.activeElement === root && selection?.rangeCount && root.contains(selection.getRangeAt(0).startContainer);
      if (!atCaret) caretAtEnd(root);
      const range = window.getSelection()?.getRangeAt(0);
      if (!range) return;
      range.deleteContents();
      range.insertNode(host);
      range.setStartAfter(host);
      range.collapse(true);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
      pills.current.set(quote.id, { quote, host });
      sync();
    };

    const removeQuote = (id: string) => {
      pills.current.get(id)?.host.remove();
      sync();
    };

    // Text copied from the page becomes a quote with its lines; Arabic from elsewhere becomes a plain quote.
    // Anything else goes in as plain text.
    const onPaste = (e: ClipboardEvent<HTMLDivElement>) => {
      e.preventDefault();
      const text = e.clipboardData.getData("text/plain");
      const fromPage = copiedPassage(text);
      const arabicOnly = /\p{Script=Arabic}/u.test(text) && !/[A-Za-z]/.test(text);
      if (!fromPage && !arabicOnly) {
        document.execCommand("insertText", false, text);
        return;
      }
      insertQuote({ id: crypto.randomUUID(), text: fromPage?.text ?? text.trim(), span: fromPage?.span ?? null, position: fromPage?.position ?? position });
    };

    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
      if (handleKeys({ event: e, handlers: { "ask.send": () => send(draft), "ask.sendNow": () => sendNow(draft), "ask.leave": () => editor.current?.blur() } })) return;
      const range = window.getSelection()?.rangeCount ? window.getSelection()?.getRangeAt(0) : null;
      if (e.key !== "Backspace" || !range?.collapsed) return;
      const before = nodeBeforeCaret(range);
      if (before instanceof HTMLElement && before.hasAttribute(PILL_ATTR)) {
        e.preventDefault();
        before.remove();
        sync();
      }
    };

    // A click anywhere in the composer box, outside its buttons and pills, types into it.
    const focusComposer = (e: MouseEvent<HTMLDivElement>) => {
      const root = editor.current;
      if (!root || !(e.target instanceof Element) || e.target.closest("button, [contenteditable]")) return;
      e.preventDefault();
      root.focus();
      caretAtEnd(root);
    };

    /** Starts a message for the reader to finish with their own attempt. */
    const startDraft = (text: string) => {
      const root = editor.current;
      if (!root) return;
      if (!draft.empty) root.append("\n");
      root.append(text);
      sync();
      root.focus();
      caretAtEnd(root);
    };

    // Starters make the reader do the work: they try and Claude checks, or Claude hints and quizzes.
    const suggestions: { icon: typeof Lightbulb; label: string; question?: string; draft?: string }[] = activeSelection
      ? [
          { icon: Lightbulb, label: "Explain this", question: "Explain this passage." },
          { icon: MessageCircleQuestion, label: "Quiz me on this", question: "Quiz me on this passage. Ask one question at a time and wait for my answer before the next. Don't give answers unless I ask." },
        ]
      : [
          { icon: MessageCircleQuestion, label: "Quiz me on this page", question: "Quiz me on this page. Ask one question at a time and wait for my answer before the next. Don't give answers unless I ask." },
          { icon: PenLine, label: "Check my understanding", draft: "My understanding of this page: " },
          { icon: BookA, label: "Key terms on this page", question: "List the key technical terms on this page for me to look up. Don't define them." },
        ];

    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {deleted && (
          <Toast onDone={commitDelete}>
            <span className="flex items-center gap-3">
              Conversation deleted
              <ToastAction onClick={undoDelete}>Undo</ToastAction>
            </span>
          </Toast>
        )}
        {screen.name === "history" ? (
          <div
            key="history"
            className={cx("flex min-h-0 flex-1 flex-col", screen.moved && "animate-in fade-in slide-in-from-right-6 duration-slide ease-move motion-reduce:slide-in-from-right-0")}
          >
            <ConversationList
              history={history}
              currentId={conversationId}
              onOpen={(id) => {
                open(id);
                showScreen("chat");
              }}
              onRename={(input) => void rename(input)}
              onNameWithClaude={nameWithClaude}
              onDelete={remove}
            />
          </div>
        ) : (
        <div
          key="chat"
          className={cx("flex min-h-0 flex-1 flex-col", screen.moved && "animate-in fade-in slide-in-from-left-6 duration-slide ease-move motion-reduce:slide-in-from-left-0")}
        >
        <div className="relative flex min-h-0 flex-1 flex-col">
        <div ref={scroller} onScroll={onScroll} onWheel={stopJump} onPointerDown={stopJump} className="min-h-0 flex-1 overflow-y-auto">
        <div ref={content} className="flex flex-col gap-5 p-5">
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
                <h2 className="text-heading font-semibold">{activeSelection ? "Ask about this passage" : "Ask about this page"}</h2>
                <p className="text-sm text-ink-3">Claude answers from this page and links to the lines it uses.</p>
              </div>
              <div className="flex flex-col items-start gap-2">
                {suggestions.map((s) => (
                  <Button key={s.label} variant="secondary" icon={s.icon} onClick={() => (s.draft ? startDraft(s.draft) : send({ question: s.question ?? "", quotes: draft.quotes.map(({ offset: _, ...q }) => q) }))}>
                    <span dir="auto">{s.label}</span>
                  </Button>
                ))}
              </div>
            </div>
          )}

          {turns.map((turn) => (
            <div key={turn.id} className="flex flex-col gap-3">
              <p
                dir={turn.question ? (ARABIC_START.test(turn.question) ? "rtl" : "ltr") : "auto"}
                className={cx("max-w-[85%] self-end rounded-xl bg-accent-soft px-3.5 py-2.5", ARABIC_START.test(turn.question) ? "ar text-ar-body" : "text-body")}
              >
                {parseComposer(turn).map((part, i) =>
                  part.kind === "quote" ? (
                    <QuoteChip key={part.quote.id} quote={part.quote} onCite={onCite} onBubble />
                  ) : (
                    <span key={i}>{part.text}</span>
                  ),
                )}
              </p>
              {turn.answer && (
                <StreamedAnswer
                  text={turn.answer}
                  streaming={turn.status === "streaming"}
                  cite={(c, key) => <AnswerCite key={key} bookId={bookId} cite={c} position={turn.position} onCite={onCite} />}
                />
              )}
              {turn.status === "streaming" && (
                <p className="flex items-center gap-2 text-xs text-ink-3">
                  <span className="size-1.5 animate-pulse rounded-full bg-accent" />
                  {turn.activity ?? "Writing…"}
                </p>
              )}
              {turn.status === "error" &&
                (turn.error === STOPPED ? (
                  <p className="text-xs text-ink-3">{STOPPED}</p>
                ) : (
                  <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{turn.error}</p>
                ))}
              {turn.status === "interrupted" && <p className="text-xs text-ink-3">Interrupted when Midad closed.</p>}
              {turn.restarted && <p className="text-xs text-ink-3">Claude no longer had this conversation, so it picked up in a new session from what was said so far.</p>}
              {turn.status !== "streaming" && (
                <div className="flex items-center gap-1">
                  {turn.status === "done" && turn.selection && (
                    <IconButton
                      icon={NotebookPen}
                      label={saved.has(turn.id) ? "Saved as note" : "Save as note"}
                      disabled={saved.has(turn.id)}
                      onClick={() => {
                        if (!turn.selection) return;
                        onSaveNote({ ...turn, selection: turn.selection }, plainAnswer(turn.answer));
                        setSaved((s) => new Set(s).add(turn.id));
                      }}
                    />
                  )}
                  {turn.status === "done" && <IconButton icon={Copy} label="Copy answer" onClick={() => void navigator.clipboard.writeText(plainAnswer(turn.answer))} />}
                  <IconButton icon={RotateCcw} label="Ask again" onClick={() => retry(turn)} />
                </div>
              )}
            </div>
          ))}
        </div>
        </div>
          <Button
            variant="secondary"
            size="sm"
            icon={ArrowDown}
            tooltip="Jump to latest"
            aria-label="Jump to latest"
            data-state={atBottom || turns.length === 0 ? "hidden" : "shown"}
            aria-hidden={atBottom || turns.length === 0 || undefined}
            tabIndex={atBottom || turns.length === 0 ? -1 : undefined}
            className="absolute bottom-3 left-1/2 size-8 -translate-x-1/2 rounded-full p-0 shadow-md transition-[opacity,translate] duration-pop ease-out data-[state=hidden]:pointer-events-none data-[state=hidden]:translate-y-2 data-[state=hidden]:opacity-0 motion-reduce:transition-none"
            onClick={() => {
              pinned.current = true;
              jumping.current = true;
              scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
            }}
          />
        </div>

        <div className="shrink-0 p-4 pt-0">
          <QueuedMessages queue={queue} onSendNow={sendQueuedNow} onEdit={editQueued} onRemove={removeQueued} onCite={onCite} />
          <div
            onMouseDown={focusComposer}
            className="flex cursor-text items-end gap-2 rounded-xl border border-line bg-surface py-2 pr-2 pl-3 focus-within:border-ink-3"
          >
            <div className="relative min-w-0 flex-1 py-1">
              {draft.empty && (
                <span aria-hidden className="pointer-events-none absolute inset-x-0 top-1 truncate text-body text-ink-3">
                  {activeSelection ? "Ask about this passage…" : "Ask about this page…"}
                </span>
              )}
              <div
                ref={editor}
                role="textbox"
                aria-multiline
                aria-label={activeSelection ? "Ask about this passage" : "Ask about this page"}
                contentEditable="plaintext-only"
                suppressContentEditableWarning
                dir="auto"
                onInput={sync}
                onKeyDown={onKeyDown}
                onPaste={onPaste}
                data-rows={rows}
                className="h-6 overflow-y-auto transition-[height] duration-pop ease-out data-[rows=2]:h-12 data-[rows=3]:h-18 motion-reduce:transition-none break-words whitespace-pre-wrap text-body outline-hidden [scrollbar-color:auto] [scrollbar-width:auto] [unicode-bidi:plaintext] [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-button]:hidden [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-ink/20"
              />
              {[...pills.current.values()].map(({ quote, host }) =>
                createPortal(<QuoteChip quote={quote} onCite={onCite} onRemove={() => removeQuote(quote.id)} />, host, quote.id),
              )}
            </div>
            {busy && <Button variant="secondary" size="sm" icon={Square} tooltip="Stop" aria-label="Stop" className="size-8 shrink-0 p-0" onClick={stop} />}
            {busy && !draft.empty && (
              <Button
                size="sm"
                icon={ArrowUp}
                tooltip="Queue"
                aria-label="Queue"
                className="size-8 shrink-0 p-0 transition-[opacity,scale] duration-pop ease-out starting:scale-80 starting:opacity-0 motion-reduce:starting:scale-100"
                onClick={() => send(draft)}
              />
            )}
            {!busy && (
              <Button
                size="sm"
                icon={ArrowUp}
                tooltip="Ask"
                aria-label="Ask"
                className="size-8 shrink-0 p-0"
                disabled={!draft.question && draft.quotes.length === 0}
                onClick={() => send(draft)}
              />
            )}
          </div>
        </div>
        </div>
      )}
    </div>
  );
};
