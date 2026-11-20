import { Check, Minus, Plug, Plus } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import type { Theme } from "../../../shared/ipc";
import { LARGEST, SMALLEST, stepScale } from "../components/display-menu";
import { Badge, Button, IconButton, Segmented, Switch, TextField } from "../components/ui";
import { type PageWidth, useFocusMode, usePageWidth, useTheme } from "../lib/appearance";
import { midad, useSaveSettings, useSettings } from "../lib/midad";
import { usePref } from "../lib/prefs";

type TestState = { kind: "idle" } | { kind: "testing" } | { kind: "ok" } | { kind: "error"; message: string };

const Section = ({ title, description, children }: { title: string; description: string; children: ReactNode }) => (
  <section className="flex flex-col gap-3">
    <div className="flex flex-col gap-0.5 px-1">
      <h2 className="text-heading font-semibold">{title}</h2>
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

const Appearance = () => {
  const [theme, setTheme] = useTheme();
  const [pageWidth, setPageWidth] = usePageWidth();
  const [focusMode, setFocusMode] = useFocusMode();
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
      <Row title="Focus mode" hint="The bars step aside while you read and return when you move">
        <Switch label="Focus mode" checked={focusMode} onChange={setFocusMode} />
      </Row>
    </Section>
  );
};

const Reading = () => {
  const [textScale, setTextScale] = usePref({ key: "reader.textScale", fallback: 1 });
  const [showHarakat, setShowHarakat] = usePref({ key: "reader.showHarakat", fallback: true });
  const [showMine, setShowMine] = usePref({ key: "reader.showMine", fallback: true });
  const [lineNumbers, setLineNumbers] = usePref({ key: "reader.lineNumbers", fallback: true });
  return (
    <Section title="Reading" description="The page's text. The same settings are in the reader's Aa menu.">
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

export const SettingsRoute = () => (
  <div className="mx-auto flex max-w-3xl flex-col gap-10 px-12 py-10">
    <header className="flex flex-col gap-1">
      <h1 className="font-display text-display font-semibold">Settings</h1>
      <p className="text-sm text-ink-2">Appearance, reading and where Midad gets its books.</p>
    </header>
    <Appearance />
    <Reading />
    <Corpus />
  </div>
);
