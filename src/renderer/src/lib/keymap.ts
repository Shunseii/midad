/**
 * Every keyboard shortcut in Midad, in one table.
 *
 * To add a shortcut, add a command to COMMANDS with its keys and a label, then
 * handle it where it applies:
 *
 *   useKeybindings({ scope: "route", handlers: { "bookmark.toggle": toggleBookmark } });
 *
 * or, for keys that belong to one focused element, `onKeyDown={(e) => handleKeys({ event: e, handlers })}`.
 * Tooltips and hints read the keys back with shortcutLabel, withShortcut and shortcutKeys.
 *
 * Keys are combos such as "Mod+F", "Mod+[", "Shift+ArrowLeft", "F" or "Escape".
 * - Mod is Ctrl, or ⌘ on macOS.
 * - Letters, digits and punctuation match the physical key (KeyboardEvent.code),
 *   so shortcuts work the same on an Arabic layout. Codes such as "NumpadAdd"
 *   can be written as they are. Named keys (Escape, Enter, arrows) and any other
 *   character match KeyboardEvent.key.
 * - Modifiers match exactly: "Mod+F" doesn't fire on Ctrl+Shift+F.
 * - Commands sharing a key are tried in table order; a handler returns false to
 *   pass the key on.
 */

/** The sections of the keyboard shortcuts list, in the order it shows them. */
export const SHORTCUT_GROUPS = ["General", "Pages", "Reading", "Panels", "Text size", "Find", "Page scrubber", "Scan", "Notes", "Ask AI", "Settings"] as const;

export type ShortcutGroup = (typeof SHORTCUT_GROUPS)[number];

export interface Command {
  keys: string | readonly string[];
  /** What the command does, for tooltips, the shortcuts list and a future command palette. */
  label: string;
  /** Where the shortcuts list shows it. Commands without one (Escape to close, Enter to save a field) aren't listed. */
  group?: ShortcutGroup;
  /** Also runs while typing in a field. */
  allowWhileTyping?: boolean;
}

export const COMMANDS = {
  "shortcuts.show": { keys: "Shift+/", label: "Keyboard shortcuts", group: "General" },
  "text.bigger": { keys: ["Mod+=", "Mod+Shift+=", "Mod+NumpadAdd"], label: "Larger text", group: "Text size", allowWhileTyping: true },
  "text.smaller": { keys: ["Mod+-", "Mod+NumpadSubtract"], label: "Smaller text", group: "Text size", allowWhileTyping: true },
  "text.reset": { keys: ["Mod+0", "Mod+Numpad0"], label: "Reset to normal size", group: "Text size", allowWhileTyping: true },
  "find.open": { keys: "Mod+F", label: "Find on page", group: "Pages" },
  "bookmark.toggle": { keys: "Mod+D", label: "Bookmark page", group: "Pages" },
  "contents.toggle": { keys: "Mod+[", label: "Show or hide contents", group: "Panels" },
  "panel.toggle": { keys: "Mod+]", label: "Show or hide highlights and notes", group: "Panels" },
  "panels.toggle": { keys: "Mod+\\", label: "Show or hide both side panels", group: "Panels" },
  "edit.undo": { keys: "Mod+Z", label: "Undo", group: "General" },
  "edit.redo": { keys: ["Mod+Y", "Mod+Shift+Z"], label: "Redo", group: "General" },
  "focus.toggle": { keys: "F", label: "Focus mode", group: "Reading" },
  "focus.leave": { keys: "Escape", label: "Leave focus mode", group: "Reading" },
  "page.next": { keys: ["ArrowLeft", "PageDown"], label: "Next page", group: "Pages" },
  "page.previous": { keys: ["ArrowRight", "PageUp"], label: "Previous page", group: "Pages" },
  "selection.extendLeft": { keys: ["Shift+ArrowLeft", "Mod+Shift+ArrowLeft"], label: "Extend selection a word left", group: "Reading" },
  "selection.extendRight": { keys: ["Shift+ArrowRight", "Mod+Shift+ArrowRight"], label: "Extend selection a word right", group: "Reading" },
  "selection.extendUp": { keys: "Shift+ArrowUp", label: "Extend selection a line up", group: "Reading" },
  "selection.extendDown": { keys: "Shift+ArrowDown", label: "Extend selection a line down", group: "Reading" },
  "selection.extendStart": { keys: "Shift+Home", label: "Extend selection to the line's start", group: "Reading" },
  "selection.extendEnd": { keys: "Shift+End", label: "Extend selection to the line's end", group: "Reading" },
  "harakat.toggle": { keys: "H", label: "Show or hide harakat", group: "Reading" },
  "scan.toggle": { keys: "S", label: "Show or hide scan", group: "Reading" },
  "reader.dismiss": { keys: "Escape", label: "Close" },

  "find.next": { keys: ["Enter", "ArrowDown"], label: "Next match", group: "Find", allowWhileTyping: true },
  "find.previous": { keys: ["Shift+Enter", "ArrowUp"], label: "Previous match", group: "Find", allowWhileTyping: true },
  "find.selectQuery": { keys: "Mod+F", label: "Select the search", allowWhileTyping: true },
  "find.close": { keys: "Escape", label: "Close", allowWhileTyping: true },

  "scrubber.nextMark": { keys: "Shift+ArrowLeft", label: "Next marked page", group: "Page scrubber" },
  "scrubber.previousMark": { keys: "Shift+ArrowRight", label: "Previous marked page", group: "Page scrubber" },
  "scrubber.next": { keys: ["ArrowLeft", "ArrowUp"], label: "Next page" },
  "scrubber.previous": { keys: ["ArrowRight", "ArrowDown"], label: "Previous page" },
  "scrubber.forward": { keys: "PageDown", label: "Ten pages on", group: "Page scrubber" },
  "scrubber.back": { keys: "PageUp", label: "Ten pages back", group: "Page scrubber" },
  "scrubber.first": { keys: "Home", label: "First page", group: "Page scrubber" },
  "scrubber.last": { keys: "End", label: "Last page", group: "Page scrubber" },
  "scrubber.cancelDrag": { keys: "Escape", label: "Cancel dragging" },

  "scan.fit": { keys: ["0", "Numpad0", "Escape"], label: "Fit to width", group: "Scan" },

  "field.commit": { keys: "Enter", label: "Save", allowWhileTyping: true },
  "field.cancel": { keys: "Escape", label: "Cancel", allowWhileTyping: true },
  "note.save": { keys: "Mod+Enter", label: "Save note", group: "Notes", allowWhileTyping: true },

  "ask.send": { keys: "Enter", label: "Ask, or queue while Claude answers", group: "Ask AI", allowWhileTyping: true },
  "ask.sendNow": { keys: "Mod+Enter", label: "Send now, stopping the answer", group: "Ask AI", allowWhileTyping: true },
  "ask.leave": { keys: "Escape", label: "Leave the message box", group: "Ask AI", allowWhileTyping: true },

  "settings.back": { keys: "Alt+ArrowLeft", label: "Back to the book", group: "Settings", allowWhileTyping: true },
  "settings.close": { keys: "Escape", label: "Back to the book" },
} satisfies Record<string, Command>;

export type CommandId = keyof typeof COMMANDS;

export const COMMAND_IDS = Object.keys(COMMANDS) as CommandId[];

export const commandOf = (id: CommandId): Command => COMMANDS[id];

export const keysOf = (id: CommandId): readonly string[] => {
  const { keys } = commandOf(id);
  return typeof keys === "string" ? [keys] : keys;
};

export const IS_MAC = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform || navigator.userAgent);

export interface Combo {
  /** Ctrl, or ⌘ on macOS. */
  mod: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
  /** Matched against KeyboardEvent.code when set, else `key` against KeyboardEvent.key. */
  code: string | null;
  key: string;
}

const PUNCTUATION_CODES: Record<string, string> = {
  "[": "BracketLeft",
  "]": "BracketRight",
  "\\": "Backslash",
  "=": "Equal",
  "-": "Minus",
  "/": "Slash",
  ",": "Comma",
  ".": "Period",
  ";": "Semicolon",
  "'": "Quote",
  "`": "Backquote",
};

const codeOf = (key: string): string | null => {
  if (/^[a-z]$/i.test(key)) return `Key${key.toUpperCase()}`;
  if (/^\d$/.test(key)) return `Digit${key}`;
  if (/^(Key[A-Z]|Digit\d|Numpad\w+)$/.test(key)) return key;
  return PUNCTUATION_CODES[key] ?? null;
};

const MODIFIERS = new Set(["Mod", "Ctrl", "Alt", "Shift", "Meta"]);

const parsed = new Map<string, Combo>();

export const parseCombo = (combo: string): Combo => {
  const cached = parsed.get(combo);
  if (cached) return cached;
  // A trailing "+" is the key itself, as in "Mod++".
  const parts = combo.endsWith("++") ? [...combo.slice(0, -2).split("+"), "+"] : combo.split("+");
  const key = parts.at(-1) ?? "";
  const modifiers = parts.slice(0, -1);
  const unknown = modifiers.find((m) => !MODIFIERS.has(m));
  if (!key || unknown) throw new Error(`Can't read the key combo "${combo}"`);
  const result: Combo = {
    mod: modifiers.includes("Mod"),
    ctrl: modifiers.includes("Ctrl"),
    alt: modifiers.includes("Alt"),
    shift: modifiers.includes("Shift"),
    meta: modifiers.includes("Meta"),
    code: codeOf(key),
    key,
  };
  parsed.set(combo, result);
  return result;
};

/** The parts of a keyboard event a combo is matched against. */
export interface KeyEventLike {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

export const matchesCombo = ({ event, combo, mac = IS_MAC }: { event: KeyEventLike; combo: string | Combo; mac?: boolean }): boolean => {
  const c = typeof combo === "string" ? parseCombo(combo) : combo;
  const ctrl = c.ctrl || (c.mod && !mac);
  const meta = c.meta || (c.mod && mac);
  if (event.ctrlKey !== ctrl || event.metaKey !== meta || event.altKey !== c.alt || event.shiftKey !== c.shift) return false;
  return c.code === null ? event.key === c.key : event.code === c.code;
};

export const matchesCommand = ({ event, id, mac = IS_MAC }: { event: KeyEventLike; id: CommandId; mac?: boolean }): boolean =>
  keysOf(id).some((combo) => matchesCombo({ event, combo, mac }));

const KEY_NAMES: Record<string, string> = {
  Escape: "Esc",
  ArrowLeft: "←",
  ArrowRight: "→",
  ArrowUp: "↑",
  ArrowDown: "↓",
  PageUp: "Page Up",
  PageDown: "Page Down",
  "-": "−",
  NumpadAdd: "+",
  NumpadSubtract: "−",
};

/** Shift with these keys is shown as the character it types: "?" rather than "Shift+/". */
const SHIFTED: Record<string, string> = { "/": "?", "=": "+" };

const keyName = (key: string) => KEY_NAMES[key] ?? (key.startsWith("Numpad") ? key.slice(6) : key.length === 1 ? key.toUpperCase() : key);

/** The keys of a combo as shown to the reader, one entry per key: ["Ctrl", "D"], or ["⌘", "D"] on macOS. */
export const comboParts = (combo: string | Combo, { mac = IS_MAC }: { mac?: boolean } = {}): string[] => {
  const c = typeof combo === "string" ? parseCombo(combo) : combo;
  const ctrl = c.ctrl || (c.mod && !mac);
  const meta = c.meta || (c.mod && mac);
  const shifted = c.shift ? SHIFTED[c.key] : undefined;
  const shift = c.shift && !shifted;
  const modifiers = mac
    ? [ctrl && "⌃", c.alt && "⌥", shift && "⇧", meta && "⌘"]
    : [ctrl && "Ctrl", c.alt && "Alt", shift && "Shift", meta && "Meta"];
  return [...modifiers.filter((m): m is string => typeof m === "string"), shifted ?? keyName(c.key)];
};

/** A combo as shown to the reader: "Ctrl+D", or "⌘D" on macOS. */
export const formatCombo = (combo: string | Combo, options: { mac?: boolean } = {}): string =>
  comboParts(combo, options).join(options.mac ?? IS_MAC ? "" : "+");

/** The keys of a command's main combo, one entry per key: ["Ctrl", "D"]. */
export const shortcutParts = (id: CommandId, options: { mac?: boolean } = {}): string[] => comboParts(keysOf(id)[0] ?? "", options);

/** The keys of a command's main combo: "Ctrl+D". */
export const shortcutKeys = (id: CommandId, options: { mac?: boolean } = {}): string => formatCombo(keysOf(id)[0] ?? "", options);

/** A label with a command's keys after it: "Hide contents (Ctrl+[)". */
export const withShortcut = ({ label, command, mac }: { label: string; command: CommandId; mac?: boolean }): string =>
  `${label} (${shortcutKeys(command, { mac })})`;

/** A command's own label with its keys: "Bookmark page (Ctrl+D)". */
export const shortcutLabel = (id: CommandId, options: { mac?: boolean } = {}): string =>
  withShortcut({ label: commandOf(id).label, command: id, mac: options.mac });

/** The listed commands under each section of the keyboard shortcuts list, with the combos worth showing (no numpad duplicates). */
export const shortcutSections = (): { group: ShortcutGroup; commands: { id: CommandId; label: string; combos: string[] }[] }[] =>
  SHORTCUT_GROUPS.map((group) => ({
    group,
    commands: COMMAND_IDS.filter((id) => commandOf(id).group === group).map((id) => ({
      id,
      label: commandOf(id).label,
      combos: keysOf(id).filter((combo) => !combo.includes("Numpad")),
    })),
  })).filter((section) => section.commands.length > 0);

const ARIA_MODIFIERS = { ctrl: "Control", alt: "Alt", shift: "Shift", meta: "Meta" } as const;

/** Commands' combos in the form `aria-keyshortcuts` takes: "Alt+ArrowLeft Escape". */
export const ariaKeyShortcuts = (ids: readonly CommandId[], { mac = IS_MAC }: { mac?: boolean } = {}): string =>
  ids
    .flatMap(keysOf)
    .map((combo) => {
      const c = parseCombo(combo);
      const held = { ctrl: c.ctrl || (c.mod && !mac), alt: c.alt, shift: c.shift, meta: c.meta || (c.mod && mac) };
      const modifiers = (Object.keys(ARIA_MODIFIERS) as (keyof typeof ARIA_MODIFIERS)[]).filter((m) => held[m]).map((m) => ARIA_MODIFIERS[m]);
      return [...modifiers, c.key].join("+");
    })
    .join(" ");
