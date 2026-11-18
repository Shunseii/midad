import { ArrowUp, Copy, Languages, Lightbulb, ListTree, NotebookPen, RotateCcw, Square, TextQuote, X } from "lucide-react";
import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import type { Part, Span } from "../../../shared/annotations";
import { parseCitations, type Segment } from "../../../shared/ask";
import { arabicNumber } from "../lib/format";
import { hamish } from "../lib/hamish";
import { Button, IconButton, cx } from "./ui";

export interface AskSelection {
  span: Span;
  text: string;
  position: number;
}

export interface Turn {
  id: string;
  question: string;
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

  const ask = ({ question, position, selection }: { question: string; position: number; selection: AskSelection | null }) => {
    const id = crypto.randomUUID();
    setTurns((all) => [...all, { id, question, position, selection, answer: "", status: "streaming", activity: "Starting Claude…", error: null }]);
    hamish["ai.ask"]({
      requestId: id,
      bookId,
      position,
      question,
      selection: selection && position === selection.position ? { span: selection.span, text: selection.text } : undefined,
      sessionId: sessionId.current,
    }).then(
      (result) => {
        sessionId.current = result.sessionId || sessionId.current;
        update(id, () => ({ answer: result.text, status: "done", activity: null }));
      },
      (err: unknown) => update(id, () => ({ status: "error", activity: null, error: err instanceof Error ? err.message : String(err) })),
    );
  };

  const busy = turns.some((t) => t.status === "streaming");
  const stop = () => {
    for (const t of turns) if (t.status === "streaming") void hamish["ai.cancel"]({ requestId: t.id });
  };
  const retry = (turn: Turn) => ask({ question: turn.question, position: turn.position, selection: turn.selection });
  return { turns, ask, busy, stop, retry };
};

const ARABIC_START = /^[^\p{L}]*\p{Script=Arabic}/u;

const citeLabel = (s: Extract<Segment, { kind: "cite" }>) => {
  const range = s.from === s.to ? `${s.from}` : `${s.from}–${s.to}`;
  return s.part === "matn" ? `line ${range}` : `ḥāshiya ${arabicNumber(s.from)}${s.to === s.from ? "" : `–${arabicNumber(s.to)}`}`;
};

/** An answer, one element per line so each line takes its own direction. Citations become chips. */
const Answer = ({ text, onCite }: { text: string; onCite: (cite: Extract<Segment, { kind: "cite" }>) => void }) => (
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
              {parseCitations(line).map((s, i) =>
                s.kind === "text" ? (
                  <span key={i}>{s.text}</span>
                ) : (
                  <button
                    key={i}
                    type="button"
                    onClick={() => onCite(s)}
                    className="mx-0.5 inline-flex translate-y-px items-center gap-1 rounded-md bg-accent-soft px-1.5 py-0.5 align-baseline font-sans text-xs text-accent hover:bg-accent hover:text-on-accent"
                  >
                    <ListTree aria-hidden className="size-3" />
                    {citeLabel(s)}
                  </button>
                ),
              )}
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

export const AskPanel = ({
  conversation,
  position,
  pageNumber,
  selection,
  onClearSelection,
  onCite,
  onSaveNote,
}: {
  conversation: ReturnType<typeof useAskConversation>;
  position: number;
  pageNumber: number;
  selection: AskSelection | null;
  onClearSelection: () => void;
  onCite: (cite: { part: Part; from: number; to: number; position: number }) => void;
  onSaveNote: (turn: Turn & { selection: AskSelection }, body: string) => void;
}) => {
  const { turns, ask, busy, stop, retry } = conversation;
  const [draft, setDraft] = useState("");
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const end = useRef<HTMLDivElement>(null);
  const activeSelection = selection && selection.position === position ? selection : null;

  const lastAnswer = turns.at(-1)?.answer;
  useEffect(() => {
    if (lastAnswer !== undefined || turns.length) end.current?.scrollIntoView({ block: "end" });
  }, [lastAnswer, turns.length]);

  const send = (question: string) => {
    if (!question.trim() || busy) return;
    ask({ question: question.trim(), position, selection: activeSelection });
    setDraft("");
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
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-5">
        {activeSelection && (
          <div className="flex flex-col gap-1 rounded-xl border-r-2 border-accent bg-surface-2 px-4 py-3">
            <div className="flex items-center gap-1.5 text-xs text-ink-3">
              <TextQuote aria-hidden className="size-3.5" />
              Selected on page {arabicNumber(pageNumber)}
              <span className="flex-1" />
              <IconButton icon={X} label="Clear selection" onClick={onClearSelection} />
            </div>
            <p className="ar text-right text-ar-body">{activeSelection.text}</p>
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
            <p dir="auto" className="max-w-[85%] self-end rounded-xl bg-accent-soft px-3.5 py-2.5 text-body [unicode-bidi:plaintext]">
              {turn.question}
            </p>
            {turn.answer && <Answer text={turn.answer} onCite={(c) => onCite({ ...c, position: turn.position })} />}
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
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            rows={2}
            dir="auto"
            placeholder={activeSelection ? "Ask about this passage…" : "Ask about this page…"}
            className="resize-none bg-transparent text-body outline-none placeholder:text-ink-3 [unicode-bidi:plaintext]"
          />
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1.5 rounded-full bg-accent-soft px-2 py-0.5 text-xs text-accent">
              <span className="size-1.5 rounded-full bg-accent" />
              Local Claude · page {arabicNumber(pageNumber)}
              {activeSelection && " + selection"}
            </span>
            <span className="flex-1" />
            {busy ? (
              <Button variant="secondary" size="sm" icon={Square} onClick={stop}>
                Stop
              </Button>
            ) : (
              <Button size="sm" icon={ArrowUp} disabled={!draft.trim()} onClick={() => send(draft)}>
                Ask
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
