import { ArrowLeft, Check, Minus, Plug, Plus } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import type { Theme } from "../../../shared/ipc";
import { LARGEST, SMALLEST, stepScale } from "../components/display-menu";
import { Badge, Button, IconButton, Segmented, Switch, TextField } from "../components/ui";
import { type HighlightStyle, type NoteIcons, type PageWidth, useFocusMode, useHighlightStyle, useNoteIcons, usePageWidth, useTheme } from "../lib/appearance";
import type { FocusChoice } from "../lib/focus";
import { midad, useSaveSettings, useSettings } from "../lib/midad";
import { usePref } from "../lib/prefs";
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
  section: "appearance";
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

const NOTE_ICONS: { value: NoteIcons; label: string }[] = [
  { value: "words", label: "On the words" },
  { value: "margin", label: "In the margin" },
];

const FOCUS_CHOICES: { value: FocusChoice; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "auto", label: "Auto" },
  { value: "locked", label: "Locked" },
];

const FOCUS_HINTS: Record<FocusChoice, string> = {
  off: "Toolbars are always visible.",
  auto: "Hides toolbars while you read. Move the pointer to show them.",
  locked: "Hides toolbars while you read. Point at the top or bottom edge to show them.",
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
  const [glossMarkers, setGlossMarkers] = usePref({ key: "reader.glossMarkers", fallback: true });
  const [hashiyaMarkers, setHashiyaMarkers] = usePref({ key: "reader.hashiyaMarkers", fallback: true });
  const [noteIcons, setNoteIcons] = useNoteIcons();
  return (
    <Section title="Reading" description="The page's text. Text size and harakat are also in the reader's Display menu.">
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
      <Row title="Gloss markers" hint="Rings after words with an interlinear gloss; hidden, the glosses aren't shown">
        <Switch label="Show gloss markers" checked={glossMarkers} onChange={setGlossMarkers} />
      </Row>
      <Row title="Hashiya markers" hint="Footnote numbers in the main text; the hashiya below stays">
        <Switch label="Show hashiya markers" checked={hashiyaMarkers} onChange={setHashiyaMarkers} />
      </Row>
      <Row title="Note icons" hint="Show a note icon next to each note, or one per line in the margin">
        <Segmented<NoteIcons> label="Note icons" value={noteIcons} onChange={setNoteIcons} options={NOTE_ICONS} />
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

/** Lands on the section a link asked for, with keyboard focus on its heading. */
const typingIn = (target: EventTarget | null) =>
  target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable);

/** Back to the book Settings was opened from, at the same page and scroll. Alt+Left, or Esc outside a field, does the same. */
const BackToBook = ({ from }: { from: BookReturn }) => {
  const navigate = useNavigate();
  const back = () =>
    void navigate(`/read/${from.bookId}?p=${from.position}`, { replace: true, state: { scrollTop: from.scrollTop } satisfies ReaderState, viewTransition: true });
  const backRef = useRef(back);
  backRef.current = back;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const altLeft = e.altKey && !e.ctrlKey && !e.metaKey && e.key === "ArrowLeft";
      const escape = e.key === "Escape" && !e.altKey && !e.ctrlKey && !e.metaKey && !typingIn(e.target) && !document.querySelector("[data-slot=popover-content], [role=dialog]");
      if (!altLeft && !escape) return;
      e.preventDefault();
      backRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <button
      type="button"
      onClick={back}
      aria-keyshortcuts="Alt+ArrowLeft Escape"
      className="-ml-2 flex w-fit max-w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-ink-2 transition-colors duration-press hover:bg-ink/4 hover:text-ink"
    >
      <ArrowLeft aria-hidden className="size-4 shrink-0" />
      <span className="shrink-0">Back to</span>
      <span className="ar truncate font-medium">{from.title}</span>
    </button>
  );
};

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
        <p className="text-sm text-ink-2">Appearance, reading and where Midad gets its books.</p>
      </header>
      <Appearance />
      <Reading />
      <Corpus />
    </div>
    </>
  );
};
