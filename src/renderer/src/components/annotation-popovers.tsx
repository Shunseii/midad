import { Check, Copy, NotebookPen, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { HIGHLIGHT_COLORS, type HighlightColor, type Note } from "../../../shared/annotations";
import { timeAgo } from "../lib/format";
import { MARK_BG } from "./page-view";
import { Button, IconButton, Kbd, cx } from "./ui";

const COLOR_NAMES: Record<HighlightColor, string> = { yellow: "Yellow", green: "Green", pink: "Pink", blue: "Blue" };

/** Fixed-position box centred above `rect`, or below it when there isn't room above. */
const placement = ({ rect, height }: { rect: DOMRect; height: number }) => {
  const above = rect.top > height + 80;
  return {
    left: Math.min(Math.max(rect.left + rect.width / 2, 220), window.innerWidth - 220),
    top: above ? rect.top - 10 : rect.bottom + 10,
    transform: above ? "translate(-50%, -100%)" : "translate(-50%, 0)",
  };
};

export const SelectionToolbar = ({
  rect,
  mode,
  onHighlight,
  onRemoveHighlight,
  onNote,
  onCopy,
  onAsk,
}: {
  onAsk: () => void;
  rect: DOMRect;
  mode: "selection" | "highlight";
  onHighlight: (color: HighlightColor) => void;
  onRemoveHighlight: () => void;
  onNote: () => void;
  onCopy: () => void;
}) => (
  <div
    role="toolbar"
    aria-label="Annotate"
    style={placement({ rect, height: 44 })}
    onMouseDown={(e) => e.preventDefault()}
    className="fixed z-40 flex items-center gap-1 rounded-xl border border-line bg-surface p-1.5 shadow-lg"
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
    {mode === "selection" && <IconButton icon={Copy} label="Copy" onClick={onCopy} />}
  </div>
);

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
 * Edits a note in place. A new note (no `note` yet) is created on the first
 * non-empty text; after that every pause in typing saves.
 */
export const NotePopover = ({
  rect,
  note,
  lineLabel,
  onCreate,
  onUpdate,
  onDelete,
  onClose,
  onPointerInside,
}: {
  rect: DOMRect;
  note: Note | null;
  lineLabel: string;
  onCreate: (body: string) => Promise<Note>;
  onUpdate: (input: { id: string; body: string }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onClose: () => void;
  onPointerInside: (inside: boolean) => void;
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
      // Save what was typed in the last half second when the popover closes.
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
    <div
      role="dialog"
      aria-label="Note"
      style={placement({ rect, height: 200 })}
      onMouseEnter={() => onPointerInside(true)}
      onMouseLeave={() => onPointerInside(false)}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
      className="fixed z-40 flex w-108 flex-col gap-2.5 rounded-xl border border-line bg-surface p-3 shadow-lg"
    >
      <div className="flex items-center gap-2 text-xs text-ink-3">
        <NotebookPen className="size-3.5" />
        <span className="flex-1">
          {note ? `Note · ${lineLabel} · edited ${timeAgo(note.updatedAt)}` : `New note · ${lineLabel}`}
        </span>
        <IconButton icon={Trash2} label="Delete note" onClick={() => void remove()} />
      </div>
      <textarea
        autoFocus={!note}
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
