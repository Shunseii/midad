import { Plug } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge, Button, TextField } from "../components/ui";
import { hamish, useSaveSettings, useSettings } from "../lib/hamish";

type TestState = { kind: "idle" } | { kind: "testing" } | { kind: "ok" } | { kind: "error"; message: string };

export const SettingsRoute = () => {
  const settings = useSettings();
  const save = useSaveSettings();
  const [endpoint, setEndpoint] = useState("");
  const [key, setKey] = useState("");
  const [test, setTest] = useState<TestState>({ kind: "idle" });

  useEffect(() => {
    if (settings.data) setEndpoint(settings.data.endpoint);
  }, [settings.data]);

  const runTest = async () => {
    setTest({ kind: "testing" });
    const result = await hamish["settings.test"]({ endpoint, key: key || undefined });
    setTest(result.ok ? { kind: "ok" } : { kind: "error", message: result.message });
  };

  const onSave = () =>
    save.mutate(
      { endpoint, key: key || undefined },
      {
        onSuccess: () => {
          setKey("");
          void runTest();
        },
      },
    );

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8 px-12 py-10">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-display font-semibold">Settings</h1>
        <p className="text-sm text-ink-2">Where Hamish imports books from.</p>
      </header>

      <section className="flex max-w-xl flex-col gap-4 rounded-2xl border border-line bg-surface p-6">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-heading font-semibold">Corpus</h2>
          <p className="text-small text-ink-3">The arabic-digitization API that holds your books. Only used when you import or sync.</p>
        </div>
        <TextField
          label="API URL"
          icon={Plug}
          placeholder="https://arabic-digitization.example.workers.dev"
          value={endpoint}
          onChange={(e) => setEndpoint(e.target.value)}
        />
        <TextField
          label="API key"
          type="password"
          placeholder={settings.data?.hasKey ? "Saved. Enter a new key to replace it." : "Paste the API key"}
          helper="Stored encrypted with your OS keychain."
          value={key}
          onChange={(e) => setKey(e.target.value)}
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
          <Button variant="secondary" onClick={() => void runTest()} disabled={test.kind === "testing"}>
            Test connection
          </Button>
          <Button onClick={onSave} disabled={save.isPending || !endpoint.trim()}>
            Save
          </Button>
        </div>
      </section>
    </div>
  );
};
