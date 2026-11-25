import { FilePlus, FileText, Highlighter, type LucideIcon, NotebookPen, Text, Trash2, X } from "lucide-react";
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Highlight, LineRef, Note, NoteTarget, PageAnnotations, PageNote, Span } from "../../../shared/annotations";
import { shortcutKeys } from "../lib/keymap";
import { timeAgo } from "../lib/format";
import { noteEditOutcome, refreshedDraft } from "../lib/note-edit";
import { handleKeys } from "../lib/use-keybindings";
import { switchListInTransition } from "../lib/view-transition";
import { MARK_BG } from "./page-view";
import { Badge, Button, IconButton, Kbd, Segmented, cx } from "./ui";
import { Textarea } from "./ui/textarea";
import { SidePanel, SidePanelBody } from "./side-panel";

export type PanelTab = "highlights" | "notes" | "ask";

const ANNOTATION_TABS: { value: Exclude<PanelTab, "ask">; label: string }[] = [
  { value: "highlights", label: "Highlights" },
  { value: "notes", label: "Notes" },
];

export const spanLabel = (span: Span) =>
  span.part === "matn" ? `Line ${span.start.line}` : `Ḥāshiya ${span.start.line}`;

export type NoteDraft = { kind: "page" } | { kind: "line"; line: LineRef; text: string };

const CardMeta = ({
  item,
  label,
  icon: Icon,
  onDelete,
  deleteLabel,
}: {
  item: Highlight | Note | PageNote;
  label: string;
  icon?: LucideIcon;
  onDelete: () => void;
  deleteLabel: string;
}) => (
  <div className="flex items-center gap-2 text-xs text-ink-3">
    {item.author === "agent" && (
      <Badge tone="accent" dot>
        Claude
      </Badge>
    )}
    <span className="flex items-center gap-1.5">
      {Icon && <Icon aria-hidden className="size-3.5" />}
      {label} · {timeAgo("updatedAt" in item ? item.updatedAt : item.createdAt)}
    </span>
    {"stale" in item && item.stale && (
      <span title="A sync changed the text under this since it was made.">
        <Badge tone="warn">Text changed</Badge>
      </span>
    )}
    <span className="flex-1" />
    <IconButton icon={Trash2} label={deleteLabel} onClick={(e) => {
        e.stopPropagation();
        onDelete();
      }} />
  </div>
);

const Card = ({ children, onClick }: { children: ReactNode; onClick: () => void }) => (
  <div
    role="button"
    tabIndex={0}
    onClick={onClick}
    onKeyDown={(e) => e.key === "Enter" && onClick()}
    className="flex cursor-pointer flex-col gap-3 rounded-2xl border border-line bg-surface p-4 transition-colors hover:border-ink-3 starting:opacity-0"
  >
    {children}
  </div>
);

/**
 * A note's text in the panel. Clicking it edits it in place: Ctrl/Cmd+Enter or
 * clicking away saves, Esc cancels, and a blank or unchanged note stays as it was.
 */
const NoteBody = ({
  note,
  onSave,
  onEditing,
  clamp = false,
}: {
  note: { id: string; body: string };
  onSave: (input: { id: string; body: string }) => void;
  onEditing: (id: string | null) => void;
  /** Long notes show their first lines until expanded. */
  clamp?: boolean;
}) => {
  const [draft, setDraft] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const shown = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    const el = shown.current;
    if (!clamp || !el || expanded) return;
    setOverflows(el.scrollHeight > el.clientHeight + 1);
  });
  // Shows a saved edit until the refetched note catches up with it.
  const [saved, setSaved] = useState<string | null>(null);
  useEffect(() => setSaved(null), [note.body]);
  const finished = useRef(false);
  // The saved text the open draft started from, to tell unsaved typing from a stale copy.
  const base = useRef<string | null>(null);
  useEffect(() => {
    if (draft === null || base.current === null || note.body === base.current) return;
    const next = refreshedDraft({ draft, base: base.current, incoming: note.body });
    base.current = next.base;
    if (next.draft !== draft) setDraft(next.draft);
    // Only a new saved text (a merge, or this editor's own save landing) refreshes the draft, not typing.
  }, [note.body]);

  const start = () => {
    finished.current = false;
    base.current = saved ?? note.body;
    setDraft(saved ?? note.body);
    onEditing(note.id);
  };
  const finish = (save: boolean) => {
    if (finished.current || draft === null) return;
    finished.current = true;
    const outcome = noteEditOutcome({ before: saved ?? note.body, draft });
    if (save && outcome.kind === "save") {
      setSaved(outcome.body);
      onSave({ id: note.id, body: outcome.body });
    }
    setDraft(null);
    onEditing(null);
  };

  const enter = "transition-opacity duration-pop ease-out starting:opacity-0";
  if (draft === null)
    return (
      <div className="flex flex-col items-start gap-1">
      <button
        ref={shown}
        type="button"
        dir="auto"
        aria-label="Edit note"
        onClick={(e) => {
          e.stopPropagation();
          start();
        }}
        onKeyDown={(e) => e.stopPropagation()}
        className={cx(
          "-mx-1.5 -my-1 cursor-text rounded-md px-1.5 py-1 text-left text-body whitespace-pre-wrap text-ink-2 [unicode-bidi:plaintext] hover:bg-ink/4 focus-visible:outline-2 focus-visible:outline-accent",
          enter,
          clamp && !expanded && "line-clamp-3",
          clamp && overflows && !expanded && "mask-b-from-60%",
        )}
      >
        {saved ?? note.body}
      </button>
      {clamp && (overflows || expanded) && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(!expanded);
          }}
          className="text-xs font-medium text-accent outline-none hover:underline focus-visible:underline"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
      </div>
    );
  return (
    <Textarea
      autoFocus
      dir="auto"
      aria-label="Note"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => e.currentTarget.setSelectionRange(e.currentTarget.value.length, e.currentTarget.value.length)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        handleKeys({ event: e, handlers: { "field.cancel": () => finish(false), "note.save": () => finish(true) } });
      }}
      onBlur={() => finish(true)}
      className={cx("min-h-20 resize-none text-body", enter)}
    />
  );
};

/** A new page or line note, written in place in the list. Ctrl/Cmd+Enter or Save adds it; Esc or Cancel drops it. */
const NewNote = ({ label, icon: Icon, quote, tinted, onAdd, onCancel }: { label: string; icon: LucideIcon; quote?: string; tinted: boolean; onAdd: (body: string) => void; onCancel: () => void }) => {
  const [body, setBody] = useState("");
  const add = () => (body.trim() ? onAdd(body) : onCancel());
  return (
    <div
      data-new-note
      className={cx(
        "flex flex-col gap-3 rounded-2xl border p-4 transition-[opacity,scale] duration-panel ease-out starting:scale-98 starting:opacity-0 motion-reduce:starting:scale-100",
        tinted ? "border-accent/40 bg-accent-soft" : "border-accent/40 bg-surface",
      )}
    >
      <span className="flex items-center gap-1.5 text-xs text-ink-3">
        <Icon aria-hidden className="size-3.5" />
        {label} · new note
      </span>
      {quote && <p className="ar truncate border-r-2 border-line pr-3 text-right text-ar-body text-ink-2">{quote}</p>}
      <Textarea
        autoFocus
        dir="auto"
        aria-label={`${label} note`}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          handleKeys({ event: e, handlers: { "field.cancel": onCancel, "note.save": add } });
        }}
        className="min-h-20 resize-none bg-surface text-body [unicode-bidi:plaintext]"
      />
      <div className="flex items-center gap-2 text-xs text-ink-3">
        <Kbd>{shortcutKeys("note.save")}</Kbd> to save
        <span className="flex-1" />
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" disabled={!body.trim()} onClick={add}>
          Save
        </Button>
      </div>
    </div>
  );
};

export const AnnotationsPanel = ({
  tab,
  onTab,
  annotations,
  onClose,
  onGoTo,
  onRemoveHighlight,
  onDeleteNote,
  onUpdateNote,
  onEditingNote,
  pageLabel,
  draft,
  onDraft,
  onAddNote,
  askPanel,
  askHeader,
  width,
  onResize,
  onResetSize,
}: {
  askPanel: ReactNode;
  askHeader: ReactNode;
  width: number;
  /** Called while the reader drags the panel's left edge. */
  onResize: (width: number) => void;
  onResetSize: () => void;
  tab: PanelTab;
  onTab: (tab: PanelTab) => void;
  annotations: PageAnnotations | undefined;
  onClose: () => void;
  onGoTo: (span: Span) => void;
  onRemoveHighlight: (id: string) => void;
  onDeleteNote: (id: string) => void;
  onUpdateNote: (input: { id: string; body: string }) => void;
  /** The note being edited in the panel, so the page can keep its words tinted. */
  onEditingNote: (id: string | null) => void;
  /** The page's printed number, as page notes are labelled. */
  pageLabel: string;
  /** A page or line note being written. */
  draft: NoteDraft | null;
  onDraft: (draft: NoteDraft | null) => void;
  onAddNote: (input: NoteTarget & { body: string }) => void;
}) => {
  const pageNote = annotations?.pageNote ?? null;
  const lineNotes = annotations?.notes.filter((n) => n.kind === "line") ?? [];
  const wordNotes = annotations?.notes.filter((n) => n.kind === "words") ?? [];
  const items = tab === "highlights" ? (annotations?.highlights ?? []) : [...(pageNote ? [pageNote] : []), ...lineNotes, ...wordNotes];
  const lineDraft = draft?.kind === "line" && !lineNotes.some((n) => n.span.part === draft.line.part && n.span.start.line === draft.line.line) ? draft : null;
  const lineLabel = ({ part, line }: LineRef) => (part === "matn" ? `Line ${line}` : `Ḥāshiya ${line}`);
  return (
    <SidePanel
      side="right"
      label={tab === "ask" ? "Ask AI" : "Annotations"}
      width={width}
      onResize={onResize}
      onResetSize={onResetSize}
      switchList="panel"
      header={
        <>
          {tab === "ask" ? (
            askHeader
          ) : (
            <Segmented
              label="Annotations"
              value={tab}
              onChange={(next) => switchListInTransition({ list: "annotations", order: ANNOTATION_TABS.map((t) => t.value), from: tab, to: next, apply: onTab })}
              options={ANNOTATION_TABS}
            />
          )}
          {tab !== "ask" && <span className="flex-1" />}
          <IconButton icon={X} label="Close panel" onClick={onClose} />
        </>
      }
    >
      {tab === "ask" ? (
        askPanel
      ) : (
      // Keyed by tab, so each list starts at its top.
      <SidePanelBody key={tab} switchList="annotations" className="gap-4 p-5">
        <h2 className="flex items-center gap-2 text-heading font-semibold">
          {tab === "highlights" ? "Highlights on this page" : "Notes on this page"}
          {items.length > 0 && <Badge>{items.length}</Badge>}
        </h2>
        {tab === "highlights" &&
          annotations?.highlights.map((h) => (
            <Card key={h.id} onClick={() => onGoTo(h.span)}>
              <CardMeta item={h} label={spanLabel(h.span)} deleteLabel="Remove highlight" onDelete={() => onRemoveHighlight(h.id)} />
              <p className="ar border-r-2 border-line pr-3 text-right text-ar-body">
                <span className={cx("box-decoration-clone", MARK_BG[h.color])}>{h.quote}</span>
              </p>
            </Card>
          ))}
        {tab === "notes" && annotations && (
          <>
            {pageNote ? (
              <div data-page-note className="flex flex-col gap-3 rounded-2xl border border-accent/30 bg-accent-soft p-4 transition-colors starting:opacity-0">
                <CardMeta item={pageNote} icon={FileText} label={`Page ${pageLabel}`} deleteLabel="Delete page note" onDelete={() => onDeleteNote(pageNote.id)} />
                <NoteBody note={pageNote} onSave={onUpdateNote} onEditing={onEditingNote} clamp />
              </div>
            ) : draft?.kind === "page" ? (
              <NewNote label={`Page ${pageLabel}`} icon={FileText} tinted onAdd={(body) => {
                  onAddNote({ page: true, body });
                  onDraft(null);
                }} onCancel={() => onDraft(null)} />
            ) : (
              <button
                type="button"
                data-add-page-note
                onClick={() => onDraft({ kind: "page" })}
                className="flex items-center gap-3 rounded-2xl border border-dashed border-line px-4 py-3 text-left text-ink-3 outline-none transition-colors duration-press ease-out hover:border-ink-3 hover:text-ink-2 focus-visible:ring-2 focus-visible:ring-accent"
              >
                <FilePlus aria-hidden className="size-4 shrink-0" />
                <span className="flex flex-col">
                  <span className="text-sm font-medium text-ink-2">Add page note</span>
                  <span className="text-xs">A summary, the lesson point, a question…</span>
                </span>
              </button>
            )}
            {lineDraft && (
              <NewNote label={lineLabel(lineDraft.line)} icon={Text} quote={lineDraft.text} tinted={false} onAdd={(body) => {
                  onAddNote({ line: lineDraft.line, body });
                  onDraft(null);
                }} onCancel={() => onDraft(null)} />
            )}
            {lineNotes.map((n) => (
              <Card key={n.id} onClick={() => onGoTo(n.span)}>
                <CardMeta item={n} icon={Text} label={lineLabel({ part: n.span.part, line: n.span.start.line })} deleteLabel="Delete note" onDelete={() => onDeleteNote(n.id)} />
                <p className="ar truncate border-r-2 border-line pr-3 text-right text-ar-body text-ink-2">{n.quote}</p>
                <NoteBody note={n} onSave={onUpdateNote} onEditing={onEditingNote} />
              </Card>
            ))}
            {wordNotes.map((n) => (
              <Card key={n.id} onClick={() => onGoTo(n.span)}>
                <CardMeta item={n} label={spanLabel(n.span)} deleteLabel="Delete note" onDelete={() => onDeleteNote(n.id)} />
                <p className="ar border-r-2 border-accent pr-3 text-right text-ar-body">
                  <span className="underline decoration-accent decoration-dotted decoration-2 underline-offset-8">{n.quote}</span>
                </p>
                <NoteBody note={n} onSave={onUpdateNote} onEditing={onEditingNote} />
              </Card>
            ))}
          </>
        )}
        {annotations && items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
            <span className="mb-1 flex size-10 items-center justify-center rounded-full bg-surface-2 text-ink-3">
              {tab === "highlights" ? <Highlighter aria-hidden className="size-5" /> : <NotebookPen aria-hidden className="size-5" />}
            </span>
            <p className="text-sm font-medium text-ink-2">{tab === "highlights" ? "Nothing highlighted yet" : "No notes yet"}</p>
            <p className="max-w-60 text-xs text-ink-3">
              {tab === "highlights" ? "Select text, then pick a colour." : "Select text and choose Note, or add a note to a line from its number."}
            </p>
          </div>
        ) : (
          <p className="text-xs text-ink-3">
            {tab === "highlights"
              ? "Select text and pick a colour to highlight it."
              : pageNote
                ? "Notes belong to this page. Click a note's text to edit it here, or open it from the page."
                : "Page notes cover the whole page. Ask AI reads them with the page."}
          </p>
        )}
      </SidePanelBody>
      )}
    </SidePanel>
  );
};
