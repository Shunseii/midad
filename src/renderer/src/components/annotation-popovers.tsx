import { Check, Copy, Eraser, NotebookPen, Sparkles, Trash2 } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { HIGHLIGHT_COLORS, type HighlightColor, type Note } from "../../../shared/annotations";
import { timeAgo } from "../lib/format";
import { MARK_BG } from "./page-view";
import { Popover, PopoverArrow, PopoverContent } from "./ui/popover";
import { Button, IconButton, Kbd, cx } from "./ui";

const COLOR_NAMES: Record<HighlightColor, string> = { yellow: "Yellow", green: "Green", pink: "Pink", blue: "Blue" };

const toAnchor = (rect: DOMRect) => ({ getBoundingClientRect: () => rect });

/** Shared by the note layer and the selection toolbar: no chrome of its own, grows from the anchor, and takes no focus. */
const FLOATING_LAYER = "w-auto gap-0 rounded-none bg-transparent p-0 shadow-none ring-0 duration-150 data-closed:pointer-events-none motion-reduce:animate-none";

export const SelectionToolbar = ({
  open,
  rect,
  mode,
  onDismiss,
  onHighlight,
  onRemoveHighlight,
  onNote,
  onClearHarakat,
  onCopy,
  onAsk,
}: {
  open: boolean;
  rect: DOMRect;
  mode: "selection" | "highlight";
  onDismiss: () => void;
  onAsk: () => void;
  onHighlight: (color: HighlightColor) => void;
  onRemoveHighlight: () => void;
  onNote: () => void;
  /** Only given when the selection has harakat the reader or the agent added. */
  onClearHarakat?: () => void;
  onCopy: () => void;
}) => {
  const anchor = useMemo(() => toAnchor(rect), [rect]);
  return (
    <Popover open={open} onOpenChange={(next) => !next && onDismiss()}>
      <PopoverContent
        anchor={anchor}
        side="top"
        sideOffset={10}
        // The top padding keeps it from sliding under the reader's header; it flips below instead.
        collisionPadding={{ top: 68, right: 12, bottom: 12, left: 12 }}
        initialFocus={false}
        finalFocus={false}
        role="toolbar"
        aria-label="Annotate"
        onMouseDown={(e) => e.preventDefault()}
        className={cn(FLOATING_LAYER, "flex-row items-center gap-1 rounded-xl border border-line bg-surface p-1.5 shadow-lg")}
      >
        {mode === "selection" ? (
          HIGHLIGHT_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              aria-label={`Highlight ${COLOR_NAMES[color].toLowerCase()}`}
              title={`Highlight ${COLOR_NAMES[color].toLowerCase()}`}
              onClick={() => onHighlight(color)}
              className={cx("mx-0.5 size-5 rounded-full ring-1 ring-line transition-transform hover:scale-110", MARK_BG[color])}
            />
          ))
        ) : (
          <Button variant="ghost" size="sm" icon={Trash2} onClick={onRemoveHighlight}>
            Remove
          </Button>
        )}
        <div className="mx-1 h-5 w-px bg-line" />
        <Button variant="ghost" size="sm" icon={NotebookPen} onClick={onNote}>
          Note
        </Button>
        {mode === "selection" && (
          <Button variant="ghost" size="sm" icon={Sparkles} onClick={onAsk}>
            Ask
          </Button>
        )}
        {onClearHarakat && <IconButton icon={Eraser} label="Clear my harakat" onClick={onClearHarakat} />}
        {mode === "selection" && <IconButton icon={Copy} label="Copy" onClick={onCopy} />}
      </PopoverContent>
    </Popover>
  );
};

type SaveState = "idle" | "saving" | "saved" | "error";

const SaveStatus = ({ state }: { state: SaveState }) => {
  if (state === "saving") return <span>Saving…</span>;
  if (state === "error") return <span className="text-danger">Couldn't save. Keep typing to retry.</span>;
  if (state === "saved")
    return (
      <span className="flex items-center gap-1 text-ok">
        <Check className="size-3.5" /> Saved
      </span>
    );
  return null;
};

/**
 * The floating layer a note shows in, anchored to the noted words. Base UI
 * places it (flipping above when there's no room below), animates it in and
 * out, closes it on Esc or a click elsewhere, and unmounts the content once
 * it has animated out.
 */
export const NoteLayer = ({
  rect,
  open,
  onClose,
  onPointerInside,
  children,
}: {
  rect: DOMRect;
  open: boolean;
  onClose: () => void;
  onPointerInside: (inside: boolean) => void;
  children: ReactNode;
}) => {
  const anchor = useMemo(() => toAnchor(rect), [rect]);
  return (
    <Popover open={open} onOpenChange={(next) => !next && onClose()}>
      <PopoverContent
        anchor={anchor}
        side="bottom"
        sideOffset={8}
        collisionPadding={12}
        // The editor focuses its own text field; a peek takes no focus at all.
        initialFocus={false}
        finalFocus={false}
        onMouseEnter={() => onPointerInside(true)}
        onMouseLeave={() => onPointerInside(false)}
        className={FLOATING_LAYER}
      >
        {children}
        <PopoverArrow />
      </PopoverContent>
    </Popover>
  );
};

/** A hovered note, read-only: a few lines and where it sits. Clicking it opens the editor. */
export const NotePeek = ({ note, lineLabel, onEdit }: { note: Note; lineLabel: string; onEdit: () => void }) => (
  <button
    type="button"
    aria-label={`Edit note on ${lineLabel}`}
    onClick={onEdit}
    className="group flex w-64 flex-col gap-1.5 rounded-lg border border-line bg-surface px-3 py-2.5 text-left shadow-md hover:border-accent"
  >
    <span dir="auto" className="line-clamp-3 text-sm leading-snug text-ink [unicode-bidi:plaintext]">
      {note.body}
    </span>
    <span className="flex items-center gap-2 text-xs text-ink-3">
      <span className="flex-1 first-letter:uppercase">
        {lineLabel} · {timeAgo(note.updatedAt)}
      </span>
      <span className="group-hover:text-accent">Click to edit</span>
    </span>
  </button>
);

/**
 * Edits a note in place. A new note (no `note` yet) is created on the first
 * non-empty text; after that every pause in typing saves.
 */
export const NoteEditor = ({
  note,
  lineLabel,
  onCreate,
  onUpdate,
  onDelete,
  onClose,
}: {
  note: Note | null;
  lineLabel: string;
  onCreate: (body: string) => Promise<{ id: string }>;
  onUpdate: (input: { id: string; body: string }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onClose: () => void;
}) => {
  const [body, setBody] = useState(note?.body ?? "");
  const [save, setSave] = useState<SaveState>("idle");
  const id = useRef(note?.id ?? null);
  const pending = useRef<Promise<unknown>>(Promise.resolve());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const persist = (text: string) => {
    if (!text.trim()) return;
    setSave("saving");
    pending.current = pending.current
      .then(async () => {
        if (id.current) await onUpdate({ id: id.current, body: text });
        else id.current = (await onCreate(text)).id;
        setSave("saved");
      })
      .catch(() => setSave("error"));
  };

  const change = (text: string) => {
    setBody(text);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => persist(text), 500);
  };

  const latest = useRef({ body, persist });
  latest.current = { body, persist };
  useEffect(
    () => () => {
      // Save what was typed in the last half second when the editor goes away.
      if (timer.current) {
        clearTimeout(timer.current);
        latest.current.persist(latest.current.body);
      }
    },
    [],
  );

  const remove = async () => {
    clearTimeout(timer.current);
    timer.current = undefined;
    await pending.current;
    if (id.current) await onDelete(id.current);
    onClose();
  };

  return (
    <div role="dialog" aria-label="Note" className="flex w-108 max-w-[calc(100vw-2rem)] flex-col gap-2.5 rounded-xl border border-line bg-surface p-3 shadow-lg">
      <div className="flex items-center gap-2 text-xs text-ink-3">
        <NotebookPen className="size-3.5" />
        <span className="flex-1">
          {note ? `Note · ${lineLabel} · edited ${timeAgo(note.updatedAt)}` : `New note · ${lineLabel}`}
        </span>
        <IconButton icon={Trash2} label="Delete note" onClick={() => void remove()} />
      </div>
      <textarea
        autoFocus
        dir="auto"
        value={body}
        onChange={(e) => change(e.target.value)}
        placeholder="Write a note…"
        rows={3}
        className="resize-none rounded-lg border border-line bg-bg px-3 py-2 text-body outline-none focus:border-accent [unicode-bidi:plaintext]"
      />
      <div className="flex items-center gap-2 text-xs text-ink-3">
        {!body.trim() && id.current ? (
          <span>Empty notes aren't saved. Delete it instead.</span>
        ) : (
          <SaveStatus state={save} />
        )}
        <span className="flex-1" />
        <Kbd>Esc</Kbd> to close
      </div>
    </div>
  );
};
