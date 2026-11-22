import { useState } from "react";
import { comboParts, shortcutSections } from "../lib/keymap";
import { handleKeys, useKeybindings } from "../lib/use-keybindings";
import { Dialog, Kbd } from "./ui";

const Combo = ({ combo }: { combo: string }) => (
  <span className="inline-flex items-center gap-1">
    {comboParts(combo).map((part) => (
      <Kbd key={part}>{part}</Kbd>
    ))}
  </span>
);

/** Every listed shortcut from the keymap, opened with ? from anywhere in the app. */
export const ShortcutsDialog = () => {
  const [open, setOpen] = useState(false);
  useKeybindings({ scope: "app", handlers: { "shortcuts.show": () => setOpen((o) => !o) } });
  if (!open) return null;
  return (
    <Dialog
      title="Keyboard shortcuts"
      onClose={() => setOpen(false)}
      className="max-w-3xl"
      onKeyDown={(event) => handleKeys({ event, handlers: { "shortcuts.show": () => setOpen(false) } })}
    >
      <div className="columns-1 gap-10 sm:columns-2">
        {shortcutSections().map(({ group, commands }) => (
          <section key={group} className="mb-6 break-inside-avoid">
            <h3 className="mb-2 text-xs font-medium text-ink-3">{group}</h3>
            <dl className="flex flex-col">
              {commands.map((c) => (
                <div key={c.id} className="flex items-start justify-between gap-4 border-b border-line py-1.5 last:border-b-0">
                  <dt className="text-sm">{c.label}</dt>
                  <dd className="flex shrink-0 flex-wrap items-center justify-end gap-x-1.5 gap-y-1 text-xs text-ink-3">
                    {c.combos.map((combo, i) => (
                      <span key={combo} className="inline-flex items-center gap-1.5">
                        {i > 0 && "or"}
                        <Combo combo={combo} />
                      </span>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  );
};
