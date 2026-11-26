import { ArrowLeft, Brain, Check, KeyRound, Minus, Pencil, Plug, Plus, Search, Server, Trash2, TriangleAlert, X } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { foldArabic } from "../../../shared/arabic";
import type { Memory, MemoryType } from "../../../shared/memories";
import { useLocation, useNavigate } from "react-router";
import type { Theme } from "../../../shared/ipc";
import { LARGEST, SMALLEST, stepScale } from "../components/display-menu";
import { Textarea } from "@/components/ui/textarea";
import { Badge, Button, cx, IconButton, Segmented, Switch, TextField, Toast, ToastAction } from "../components/ui";
import { GLOSS_HINTS, GLOSS_MODES, NOTE_MARK_HINTS, NOTE_MARKS, type GlossMode, type HighlightStyle, type NoteIcons, type PageWidth, useFocusMode, useGlossMode, useHighlightStyle, useNoteIcons, usePageWidth, useTheme } from "../lib/appearance";
import type { FocusChoice } from "../lib/focus";
import { ariaKeyShortcuts } from "../lib/keymap";
import { ON_LAUNCH_PREF, type OnLaunch } from "../lib/launch";
import type { SyncStatus } from "../../../shared/sync";
import { useNow } from "../components/devices";
import { plural, timeAgo } from "../lib/format";
import { midad, useConnectSync, useDisconnectSync, useMemories, useRemoveMemory, useRestoreMemory, useSaveSettings, useSettings, useSyncSettings, useSyncStatus, useUpdateMemory } from "../lib/midad";
import { usePref } from "../lib/prefs";
import { useKeybindings } from "../lib/use-keybindings";
import type { ReaderState } from "./reader";

type TestState = { kind: "idle" } | { kind: "testing" } | { kind: "ok" } | { kind: "error"; message: string };

/** The book Settings was opened from, and where in it the reader was. */
export interface BookReturn {
  bookId: string;
  title: string;
  position: number;
  scrollTop: number;
}

/** What a link into Settings can ask for: the section to land on, and the book to offer a way back to. */
export interface SettingsState {
  section: "appearance" | "devices" | "memory";
  from?: BookReturn;
}

const Section = ({ title, description, children }: { title: string; description: string; children: ReactNode }) => (
  <section id={title.toLowerCase()} aria-labelledby={`${title.toLowerCase()}-title`} className="flex scroll-mt-10 flex-col gap-3">
    <div className="flex flex-col gap-0.5 px-1">
      <h2 id={`${title.toLowerCase()}-title`} tabIndex={-1} className="scroll-mt-20 text-heading font-semibold outline-none">
        {title}
      </h2>
      <p className="text-small text-ink-3">{description}</p>
    </div>
    <div className="flex flex-col divide-y divide-line rounded-2xl border border-line bg-surface">{children}</div>
  </section>
);

const Row = ({ title, hint, children }: { title: string; hint: string; children: ReactNode }) => (
  <div className="flex min-h-16 items-center gap-6 px-5 py-3">
    <div className="flex flex-1 flex-col gap-0.5">
      <span className="text-sm font-medium">{title}</span>
      <span className="text-xs text-ink-3">{hint}</span>
    </div>
    {children}
  </div>
);

const HIGHLIGHT_STYLES: { value: HighlightStyle; label: string }[] = [
  { value: "under", label: "Under text" },
  { value: "behind", label: "Behind text" },
];


const FOCUS_CHOICES: { value: FocusChoice; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "auto", label: "Auto" },
  { value: "locked", label: "Locked" },
];

const FOCUS_HINTS: Record<FocusChoice, string> = {
  off: "Toolbars are always visible.",
  auto: "Hides toolbars while you read. Move the pointer to show them.",
  locked: "Hides toolbars while you read. Point at any edge of the window to show them.",
};

const ON_LAUNCH_CHOICES: { value: OnLaunch; label: string }[] = [
  { value: "library", label: "Library" },
  { value: "continue", label: "Continue reading" },
];

const ON_LAUNCH_HINTS: Record<OnLaunch, string> = {
  library: "Midad opens to your library.",
  continue: "Midad opens where you left off: your book at the page you were on, or the library if you closed it there.",
};

const Appearance = () => {
  const [theme, setTheme] = useTheme();
  const [pageWidth, setPageWidth] = usePageWidth();
  const focusMode = useFocusMode();
  const [highlightStyle, setHighlightStyle] = useHighlightStyle();
  return (
    <Section title="Appearance" description="How Midad looks. Changes apply at once.">
      <Row title="Theme" hint="Follow the system, or always light or dark">
        <Segmented<Theme>
          label="Theme"
          value={theme}
          onChange={setTheme}
          options={[
            { value: "system", label: "System" },
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ]}
        />
      </Row>
      <Row title="Page width" hint="Narrow justifies a shorter line; Wide sets longer, ragged lines">
        <Segmented<PageWidth>
          label="Page width"
          value={pageWidth}
          onChange={setPageWidth}
          options={[
            { value: "narrow", label: "Narrow" },
            { value: "wide", label: "Wide" },
          ]}
        />
      </Row>
      <Row title="Highlight style" hint="Under keeps the harakat clear; Behind fills the whole word">
        <Segmented<HighlightStyle> label="Highlight style" value={highlightStyle} onChange={setHighlightStyle} options={HIGHLIGHT_STYLES} />
      </Row>
      <Row title="Focus mode" hint={FOCUS_HINTS[focusMode.choice]}>
        <Segmented<FocusChoice> label="Focus mode" value={focusMode.choice} onChange={focusMode.setChoice} options={FOCUS_CHOICES} />
      </Row>
    </Section>
  );
};

const Reading = () => {
  const [textScale, setTextScale] = usePref({ key: "reader.textScale", fallback: 1 });
  const [showHarakat, setShowHarakat] = usePref({ key: "reader.showHarakat", fallback: true });
  const [showMine, setShowMine] = usePref({ key: "reader.showMine", fallback: true });
  const [lineNumbers, setLineNumbers] = usePref({ key: "reader.lineNumbers", fallback: true });
  const [glosses, setGlosses] = useGlossMode();
  const [hashiyaMarkers, setHashiyaMarkers] = usePref({ key: "reader.hashiyaMarkers", fallback: true });
  const [noteIcons, setNoteIcons] = useNoteIcons();
  const [onLaunch, setOnLaunch] = usePref(ON_LAUNCH_PREF);
  return (
    <Section title="Reading" description="Where Midad opens, and the page's text. Text size and harakat are also in the reader's Display menu.">
      <Row title="On launch" hint={ON_LAUNCH_HINTS[onLaunch]}>
        <Segmented<OnLaunch> label="On launch" value={onLaunch} onChange={setOnLaunch} options={ON_LAUNCH_CHOICES} />
      </Row>
      <Row title="Text size" hint="The page's Arabic text">
        <div className="flex items-center gap-1">
          <IconButton icon={Minus} label="Smaller text" disabled={textScale <= SMALLEST} onClick={() => setTextScale(stepScale({ scale: textScale, by: -1 }))} />
          <span className="w-12 text-center text-sm tabular-nums text-ink-2">{Math.round(textScale * 100)}%</span>
          <IconButton icon={Plus} label="Larger text" disabled={textScale >= LARGEST} onClick={() => setTextScale(stepScale({ scale: textScale, by: 1 }))} />
        </div>
      </Row>
      <Row title="Harakat" hint="The corpus's marks and yours">
        <Switch label="Show harakat" checked={showHarakat} onChange={setShowHarakat} />
      </Row>
      <Row title="My harakat" hint="Marks you added, drawn in red">
        <Switch label="Show my harakat" checked={showMine} onChange={setShowMine} disabled={!showHarakat} />
      </Row>
      <Row title="Line numbers" hint="The numbers notes and Ask AI use">
        <Switch label="Show line numbers" checked={lineNumbers} onChange={setLineNumbers} />
      </Row>
      <Row title="Glosses" hint={GLOSS_HINTS[glosses]}>
        <Segmented<GlossMode> label="Glosses" value={glosses} onChange={setGlosses} options={GLOSS_MODES} />
      </Row>
      <Row title="Hashiya markers" hint="Footnote numbers in the main text; the hashiya below stays">
        <Switch label="Show hashiya markers" checked={hashiyaMarkers} onChange={setHashiyaMarkers} />
      </Row>
      <Row title="Note marks" hint={NOTE_MARK_HINTS[noteIcons]}>
        <Segmented<NoteIcons> label="Note marks" value={noteIcons} onChange={setNoteIcons} options={NOTE_MARKS} />
      </Row>
    </Section>
  );
};

const Corpus = () => {
  const settings = useSettings();
  const save = useSaveSettings();
  const [endpoint, setEndpoint] = useState("");
  const [key, setKey] = useState("");
  const [test, setTest] = useState<TestState>({ kind: "idle" });
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (settings.data) setEndpoint(settings.data.endpoint);
  }, [settings.data]);

  const dirty = endpoint.trim() !== (settings.data?.endpoint ?? "") || key.trim() !== "";

  const runTest = async () => {
    setTest({ kind: "testing" });
    try {
      const result = await midad["settings.test"]({ endpoint, key: key || undefined });
      setTest(result.ok ? { kind: "ok" } : { kind: "error", message: result.message });
    } catch (err) {
      setTest({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  };

  const onSave = () =>
    save.mutate(
      { endpoint, key: key || undefined },
      {
        onSuccess: () => {
          setKey("");
          setSaved(true);
          void runTest();
        },
      },
    );

  return (
    <Section title="Corpus" description="The arabic-digitization service your books come from. Used only when you import or sync.">
      <div className="flex flex-col gap-4 p-5">
        <TextField
          label="API URL"
          icon={Plug}
          placeholder="https://arabic-digitization.example.workers.dev"
          value={endpoint}
          onChange={(e) => {
            setEndpoint(e.target.value);
            setSaved(false);
          }}
        />
        <TextField
          label="API key"
          type="password"
          placeholder={settings.data?.hasKey ? "Saved. Enter a new key to replace it." : "Paste the API key"}
          helper="Stored encrypted with your OS keychain."
          value={key}
          onChange={(e) => {
            setKey(e.target.value);
            setSaved(false);
          }}
        />
        {save.error && <p className="text-sm text-danger">{save.error.message}</p>}
        <div className="flex items-center gap-3">
          {test.kind === "ok" && (
            <Badge tone="ok" dot>
              Connected
            </Badge>
          )}
          {test.kind === "error" && (
            <Badge tone="danger" dot>
              {test.message}
            </Badge>
          )}
          {test.kind === "testing" && <Badge>Testing…</Badge>}
          <div className="flex-1" />
          <Button variant="secondary" onClick={() => void runTest()} disabled={test.kind === "testing" || !endpoint.trim()}>
            Test connection
          </Button>
          <Button icon={saved && !dirty ? Check : undefined} onClick={onSave} disabled={save.isPending || !dirty || !endpoint.trim()}>
            {saved && !dirty ? "Saved" : "Save"}
          </Button>
        </div>
      </div>
    </Section>
  );
};

const ENTER = "animate-in fade-in-0 slide-in-from-top-1 duration-200 ease-out";

const DevicesBadge = ({ status, now }: { status: SyncStatus; now: number }) => {
  switch (status.state) {
    case "off":
      return <Badge>Off</Badge>;
    case "connecting":
      return (
        <Badge tone="accent">
          <span className="size-1.5 animate-pulse rounded-full bg-current" />
          Connecting…
        </Badge>
      );
    case "synced":
      return (
        <Badge tone="ok" dot>
          Up to date · {timeAgo(Math.min(status.lastSyncedAt ?? now, now), now)}
        </Badge>
      );
    case "offline":
      return (
        <Badge tone="warn" dot>
          Offline · retrying
        </Badge>
      );
    case "refused":
      return (
        <Badge tone="danger" dot>
          Sign-in refused
        </Badge>
      );
  }
};

const ClockBanner = () => (
  <div role="status" className={cx("flex items-start gap-3 rounded-lg bg-warn-soft px-4 py-3", ENTER)}>
    <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warn" />
    <div className="flex flex-1 flex-col gap-0.5">
      <span className="text-sm font-semibold">One of your devices has the wrong clock</span>
      <span className="text-small text-ink-2">Edits still arrive, but may land out of order until it's fixed. Check the date and time on each device.</span>
    </div>
    <IconButton icon={X} label="Dismiss" className="-my-1.5 -mr-2" onClick={() => void midad["sync.dismissClockWarning"]()} />
  </div>
);

/** Device sync, called Devices so it never reads like a book's corpus Sync. */
const Devices = () => {
  const settings = useSyncSettings();
  const status = useSyncStatus().data;
  const connect = useConnectSync();
  const disconnect = useDisconnectSync();
  const now = useNow();
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");

  useEffect(() => {
    if (settings.data) setUrl(settings.data.url);
  }, [settings.data]);

  if (!settings.data || !status) return null;
  const { hasToken, keychain, fromEnvironment } = settings.data;
  const on = status.state !== "off";
  const refused = status.state === "refused";
  const dirty = url.trim() !== settings.data.url || token.trim() !== "";
  const canConnect = url.trim() !== "" && (token.trim() !== "" || hasToken) && (!on || dirty) && (!refused || token.trim() !== "");
  const showConnect = !fromEnvironment && (!on || refused || dirty);
  const tokenError = refused && !token ? "The server refused this token. Paste a new one." : null;
  const keychainHelper = keychain ? "Stored encrypted with your OS keychain." : "Stored on this device. Your system has no keychain, so it isn't encrypted.";
  const error = connect.error ?? disconnect.error;

  const onConnect = () =>
    connect.mutate({ url, ...(token.trim() ? { token } : {}) }, { onSuccess: () => setToken("") });

  return (
    <Section title="Devices" description="Keep highlights, notes, bookmarks and places the same on all your devices.">
      <div className="flex flex-col gap-4 p-5">
        {status.clockAheadUntil !== null && status.state !== "offline" && status.state !== "refused" && <ClockBanner />}
        <TextField
          label="Server address"
          icon={Server}
          placeholder="https://midad-sync.example.workers.dev"
          value={url}
          disabled={fromEnvironment}
          helper={fromEnvironment ? "Set by MIDAD_SYNC_URL" : status.state === "offline" ? "Can't reach this address. Changes wait on this device." : undefined}
          onChange={(e) => setUrl(e.target.value)}
        />
        <TextField
          label="Token"
          type="password"
          icon={KeyRound}
          autoComplete="off"
          placeholder={hasToken ? "Saved. Enter a new token to replace it." : "Paste the token from your server"}
          value={token}
          disabled={fromEnvironment}
          error={tokenError}
          helper={fromEnvironment ? "Set by MIDAD_SYNC_TOKEN" : keychainHelper}
          onChange={(e) => setToken(e.target.value)}
        />
        {error && <p className={cx("text-sm text-danger", ENTER)}>{error.message}</p>}
        <div className="flex items-center gap-3">
          <DevicesBadge status={status} now={now} />
          <div className="flex-1" />
          {on && !fromEnvironment && (
            <Button variant="secondary" onClick={() => disconnect.mutate(undefined, { onSuccess: () => setToken("") })} disabled={disconnect.isPending}>
              Disconnect
            </Button>
          )}
          {showConnect && (
            <Button onClick={onConnect} disabled={!canConnect || connect.isPending}>
              Connect
            </Button>
          )}
        </div>
      </div>
    </Section>
  );
};

const MEMORY_TYPE_LABELS: Record<MemoryType, string> = { reader: "Reader", preference: "Preference", feedback: "Feedback", book: "Book" };

const DAY = new Intl.DateTimeFormat("en", { day: "numeric", month: "short" });

const memoryDate = (at: number) => (new Date(at).toDateString() === new Date().toDateString() ? "Today" : DAY.format(at));

const searchable = (text: string) => foldArabic(text).toLowerCase();

const matchesSearch = ({ memory, query }: { memory: Memory; query: string }) => {
  const words = searchable(query).split(/\s+/).filter(Boolean);
  const text = searchable([memory.description, memory.body, memory.name, MEMORY_TYPE_LABELS[memory.type], memory.bookTitle ?? ""].join(" "));
  return words.every((w) => text.includes(w));
};

/** How long a deleted row takes to fade before it leaves the list. */
const ROW_EXIT_MS = 200;

const MemoryMeta = ({ memory }: { memory: Memory }) => (
  <span className="flex items-center gap-1 text-xs text-ink-3">
    <span data-memory-author={memory.author}>{memory.author === "reader" ? "You" : "Ask AI"}{memory.editedAt === null ? "" : " · edited"}</span>
    <span aria-hidden>·</span>
    {memory.bookId ? (
      <span dir="rtl" className="ar">
        {memory.bookTitle ?? memory.bookId}
      </span>
    ) : (
      <span>All books</span>
    )}
    <span aria-hidden>·</span>
    <span>{memoryDate(memory.updatedAt)}</span>
  </span>
);

const MemoryEditor = ({ memory, onDone }: { memory: Memory; onDone: () => void }) => {
  const update = useUpdateMemory();
  const [description, setDescription] = useState(memory.description);
  const [body, setBody] = useState(memory.body);
  const changed = description.trim() !== memory.description || body.trim() !== memory.body;
  const save = () => update.mutate({ id: memory.id, description, body, bookId: memory.bookId }, { onSuccess: onDone });
  return (
    <form
      aria-label="Edit memory"
      className="flex flex-col gap-3 bg-bg px-5 py-4 last:rounded-b-2xl transition-colors duration-pop ease-out starting:bg-surface [&>*]:transition-[opacity,translate] [&>*]:duration-pop [&>*]:ease-out starting:[&>*]:-translate-y-1 starting:[&>*]:opacity-0 motion-reduce:[&>*]:transition-none"
      onSubmit={(e) => {
        e.preventDefault();
        if (changed) save();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onDone();
        }
      }}
    >
      <div className="flex items-center gap-2">
        <Badge>{MEMORY_TYPE_LABELS[memory.type]}</Badge>
        <MemoryMeta memory={memory} />
      </div>
      <TextField label="Description" value={description} onChange={(e) => setDescription(e.target.value)} autoFocus />
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-ink-2">Memory</span>
        <Textarea value={body} onChange={(e) => setBody(e.target.value)} className="min-h-19" />
      </label>
      {update.error && <p className="text-sm text-danger">{update.error.message}</p>}
      <div className="flex items-center gap-2">
        <span className="flex-1 text-xs text-ink-3">Saving marks it as written by you.</span>
        <Button variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={!changed || update.isPending}>
          Save
        </Button>
      </div>
    </form>
  );
};

const MemoryRow = ({ memory, leaving, onEdit, onDelete }: { memory: Memory; leaving: boolean; onEdit: () => void; onDelete: () => void }) => (
  <div
    data-memory={memory.id}
    data-state={leaving ? "deleting" : undefined}
    className="flex items-start gap-4 px-5 py-3 last:rounded-b-2xl transition-[background-color,opacity] duration-press ease-out hover:bg-bg data-[state=deleting]:opacity-0 data-[state=deleting]:duration-pop motion-reduce:transition-none"
  >
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <div className="flex items-center gap-2">
        <Badge>{MEMORY_TYPE_LABELS[memory.type]}</Badge>
        <span className="text-sm font-medium [unicode-bidi:plaintext]">{memory.description}</span>
      </div>
      <p className="text-small whitespace-pre-line text-ink-2 [unicode-bidi:plaintext]">{memory.body}</p>
      <MemoryMeta memory={memory} />
    </div>
    <div className="flex items-center gap-0.5">
      <IconButton icon={Pencil} label="Edit memory" onClick={onEdit} />
      <IconButton icon={Trash2} label="Delete memory" onClick={onDelete} />
    </div>
  </div>
);

const MemorySection = () => {
  const memories = useMemories();
  const remove = useRemoveMemory();
  const restore = useRestoreMemory();
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [leaving, setLeaving] = useState<string | null>(null);
  const [removed, setRemoved] = useState<Memory | null>(null);

  const all = memories.data ?? [];
  const shown = query.trim() ? all.filter((memory) => matchesSearch({ memory, query })) : all;

  const onDelete = (memory: Memory) => {
    setLeaving(memory.id);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setTimeout(
      () =>
        remove.mutate(
          { id: memory.id },
          {
            onSuccess: () => setRemoved(memory),
            onSettled: () => setLeaving(null),
          },
        ),
      reduced ? 0 : ROW_EXIT_MS,
    );
  };

  return (
    <Section title="Memory" description="What Ask AI remembers about you between chats: who you are, how you like answers, corrections you gave it, and your goals for a book.">
      {all.length === 0 ? (
        memories.isPending ? (
          <div className="h-24" />
        ) : (
          <div className="flex flex-col items-center gap-1 px-5 py-8 text-center transition-opacity duration-pop ease-out starting:opacity-0">
            <Brain className="mb-1 size-5 text-ink-3" aria-hidden />
            <span className="text-sm font-medium">Nothing remembered yet</span>
            <span className="max-w-105 text-xs text-ink-3">Tell Ask AI about yourself or how you like answers, or correct it, and it keeps that here for later chats.</span>
          </div>
        )
      ) : (
        <>
          <div className="flex items-center gap-3 px-5 py-3">
            <TextField icon={Search} aria-label="Search memories" placeholder="Search memories" value={query} onChange={(e) => setQuery(e.target.value)} className="w-72" />
            <span className="flex-1 text-right text-xs text-ink-3" aria-live="polite">
              {query.trim() && shown.length === 0 ? `No memories match “${query.trim()}”` : plural({ count: shown.length, one: "memory", many: "memories" })}
            </span>
          </div>
          {shown.length === 0 && (
            <div className="flex flex-col items-center gap-1 px-5 py-8 text-center transition-opacity duration-pop ease-out starting:opacity-0">
              <span className="text-sm font-medium">No memories match</span>
              <span className="text-xs text-ink-3">Try other words, or clear the search.</span>
            </div>
          )}
          {shown.map((memory) =>
            editing === memory.id ? (
              <MemoryEditor key={memory.id} memory={memory} onDone={() => setEditing(null)} />
            ) : (
              <MemoryRow key={memory.id} memory={memory} leaving={leaving === memory.id} onEdit={() => setEditing(memory.id)} onDelete={() => onDelete(memory)} />
            ),
          )}
        </>
      )}
      {remove.error && <p className="px-5 py-3 text-sm text-danger">{remove.error.message}</p>}
      {removed && (
        <Toast key={removed.id} onDone={() => setRemoved(null)}>
          <span className="flex items-center gap-3">
            Memory deleted
            <ToastAction
              onClick={() => {
                restore.mutate({ memory: removed });
                setRemoved(null);
              }}
            >
              Undo
            </ToastAction>
          </span>
        </Toast>
      )}
    </Section>
  );
};

/** Back to the book Settings was opened from, at the same page and scroll. Alt+Left, or Esc outside a field, does the same. */
const BackToBook = ({ from }: { from: BookReturn }) => {
  const navigate = useNavigate();
  const back = () =>
    void navigate(`/read/${from.bookId}?p=${from.position}`, { replace: true, state: { scrollTop: from.scrollTop } satisfies ReaderState, viewTransition: true });

  useKeybindings({
    scope: "route",
    handlers: {
      "settings.back": back,
      // An open popover or dialog takes Esc first.
      "settings.close": () => {
        if (document.querySelector("[data-slot=popover-content], [role=dialog]")) return false;
        back();
      },
    },
  });

  return (
    <Button variant="ghost" icon={ArrowLeft} onClick={back} aria-keyshortcuts={ariaKeyShortcuts(["settings.back", "settings.close"])} className="-ml-3.5 w-fit max-w-full">
      <span className="shrink-0">Back to</span>
      <span className="ar truncate font-medium">{from.title}</span>
    </Button>
  );
};

/** Lands on the section a link asked for, with keyboard focus on its heading. */
const useLandOnSection = () => {
  const { state } = useLocation();
  const section = (state as SettingsState | null)?.section;
  useEffect(() => {
    if (!section) return;
    const heading = document.getElementById(`${section}-title`);
    heading?.scrollIntoView({ block: "start" });
    heading?.focus({ preventScroll: true });
  }, [section]);
};

export const SettingsRoute = () => {
  useLandOnSection();
  const from = (useLocation().state as SettingsState | null)?.from;
  return (
    <>
      {from && (
        // Sticky, so it stays in reach after Settings lands on a section further down.
        <div className="sticky top-0 z-10 border-b border-line bg-bg/95 backdrop-blur-sm">
          <div className="mx-auto max-w-3xl px-12 py-2.5">
            <BackToBook from={from} />
          </div>
        </div>
      )}
    <div className="mx-auto flex max-w-3xl flex-col gap-10 px-12 py-10">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-display font-semibold">Settings</h1>
        <p className="text-sm text-ink-2">Appearance, reading, what Ask AI remembers, books and devices.</p>
      </header>
      <Appearance />
      <Reading />
      <MemorySection />
      <Corpus />
      <Devices />
    </div>
    </>
  );
};
