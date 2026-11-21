import { Highlighter, NotebookPen, Sparkles, Trash2, X } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import type { Highlight, Note, PageAnnotations, Span } from "../../../shared/annotations";
import { timeAgo } from "../lib/format";
import { noteEditOutcome } from "../lib/note-edit";
import { handleKeys } from "../lib/use-keybindings";
import { switchListInTransition } from "../lib/view-transition";
import { MARK_BG } from "./page-view";
import { Badge, IconButton, Segmented, cx } from "./ui";
import { Textarea } from "./ui/textarea";

export type PanelTab = "highlights" | "notes" | "ask";

const ANNOTATION_TABS: { value: Exclude<PanelTab, "ask">; label: string }[] = [
  { value: "highlights", label: "Highlights" },
  { value: "notes", label: "Notes" },
];

export const spanLabel = (span: Span) =>
  span.part === "matn" ? `Line ${span.start.line}` : `Ḥāshiya ${span.start.line}`;

const CardMeta = ({ item, onDelete, deleteLabel }: { item: Highlight | Note; onDelete: () => void; deleteLabel: string }) => (
  <div className="flex items-center gap-2 text-xs text-ink-3">
    {item.author === "agent" && (
      <Badge tone="accent" dot>
        Claude
      </Badge>
    )}
    <span>
      {spanLabel(item.span)} · {timeAgo("updatedAt" in item ? item.updatedAt : item.createdAt)}
    </span>
    {item.stale && (
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
    className="flex cursor-pointer flex-col gap-3 rounded-2xl border border-line bg-surface p-4 transition-colors hover:border-ink-3"
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
}: {
  note: Note;
  onSave: (input: { id: string; body: string }) => void;
  onEditing: (id: string | null) => void;
}) => {
  const [draft, setDraft] = useState<string | null>(null);
  // Shows a saved edit until the refetched note catches up with it.
  const [saved, setSaved] = useState<string | null>(null);
  useEffect(() => setSaved(null), [note.body]);
  const finished = useRef(false);

  const start = () => {
    finished.current = false;
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
      <button
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
        )}
      >
        {saved ?? note.body}
      </button>
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
  askPanel,
  width,
  onResize,
  onResetSize,
}: {
  askPanel: ReactNode;
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
}) => {
  const items = tab === "highlights" ? (annotations?.highlights ?? []) : (annotations?.notes ?? []);
  return (
    <aside aria-label={tab === "ask" ? "Ask AI" : "Annotations"} style={{ width }} className="relative flex min-h-0 shrink-0 flex-col border-l border-line bg-surface">
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panel"
        title="Drag to resize · double-click to reset"
        onDoubleClick={onResetSize}
        onPointerDown={(e) => {
          e.preventDefault();
          const handle = e.currentTarget;
          handle.setPointerCapture(e.pointerId);
          const startX = e.clientX;
          const move = (ev: PointerEvent) => onResize(width + startX - ev.clientX);
          handle.addEventListener("pointermove", move);
          handle.addEventListener("pointerup", () => handle.removeEventListener("pointermove", move), { once: true });
        }}
        className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize transition-colors hover:bg-accent-soft active:bg-accent-soft"
      />
      <div className="flex h-15 shrink-0 items-center gap-2 border-b border-line px-4">
        {tab === "ask" ? (
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="size-4 text-accent" /> Ask AI
          </h2>
        ) : (
          <Segmented
            label="Annotations"
            value={tab}
            onChange={(next) => switchListInTransition({ list: "annotations", order: ANNOTATION_TABS.map((t) => t.value), from: tab, to: next, apply: onTab })}
            options={ANNOTATION_TABS}
          />
        )}
        <span className="flex-1" />
        <IconButton icon={X} label="Close panel" onClick={onClose} />
      </div>
      {tab === "ask" ? (
        askPanel
      ) : (
      // Keyed by tab, so each list starts at its top.
      <div key={tab} data-switch-list="annotations" className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
        <h2 className="flex items-center gap-2 text-heading font-semibold">
          {tab === "highlights" ? "Highlights on this page" : "Notes on this page"}
          {items.length > 0 && <Badge>{items.length}</Badge>}
        </h2>
        {tab === "highlights" &&
          annotations?.highlights.map((h) => (
            <Card key={h.id} onClick={() => onGoTo(h.span)}>
              <CardMeta item={h} deleteLabel="Remove highlight" onDelete={() => onRemoveHighlight(h.id)} />
              <p className="ar border-r-2 border-line pr-3 text-right text-ar-body">
                <span className={cx("box-decoration-clone", MARK_BG[h.color])}>{h.quote}</span>
              </p>
            </Card>
          ))}
        {tab === "notes" &&
          annotations?.notes.map((n) => (
            <Card key={n.id} onClick={() => onGoTo(n.span)}>
              <CardMeta item={n} deleteLabel="Delete note" onDelete={() => onDeleteNote(n.id)} />
              <p className="ar border-r-2 border-accent pr-3 text-right text-ar-body">
                <span className="underline decoration-accent decoration-dotted decoration-2 underline-offset-8">{n.quote}</span>
              </p>
              <NoteBody note={n} onSave={onUpdateNote} onEditing={onEditingNote} />
            </Card>
          ))}
        {annotations && items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
            <span className="mb-1 flex size-10 items-center justify-center rounded-full bg-surface-2 text-ink-3">
              {tab === "highlights" ? <Highlighter aria-hidden className="size-5" /> : <NotebookPen aria-hidden className="size-5" />}
            </span>
            <p className="text-sm font-medium text-ink-2">{tab === "highlights" ? "Nothing highlighted yet" : "No notes yet"}</p>
            <p className="max-w-60 text-xs text-ink-3">
              {tab === "highlights" ? "Select text, then pick a colour." : "Select text and choose Note. Notes stay with the page they're on."}
            </p>
          </div>
        ) : (
          <p className="text-xs text-ink-3">
            {tab === "highlights"
              ? "Select text and pick a colour to highlight it."
              : "Notes belong to this page. Click a note's text to edit it here, or open it from the page."}
          </p>
        )}
      </div>
      )}
    </aside>
  );
};
