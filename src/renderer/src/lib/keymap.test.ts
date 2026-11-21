import { describe, expect, it, vi } from "vitest";
import { ariaKeyShortcuts, COMMANDS, comboParts, type CommandId, formatCombo, keysOf, matchesCombo, matchesCommand, parseCombo, shortcutKeys, shortcutLabel, withShortcut } from "./keymap";
import { createKeyDispatcher, type DispatchedKey, handleKeys } from "./use-keybindings";

interface FakeKey extends DispatchedKey {
  typing: boolean;
  prevented: boolean;
  stopped: boolean;
  stopPropagation: () => void;
}

const keyEvent = (over: Partial<Pick<FakeKey, "key" | "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey" | "typing">> = {}): FakeKey => {
  const event: FakeKey = {
    key: "",
    code: "",
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    typing: false,
    target: null,
    prevented: false,
    stopped: false,
    preventDefault: () => (event.prevented = true),
    stopPropagation: () => (event.stopped = true),
    ...over,
  };
  return event;
};

const ctrlF = keyEvent({ key: "f", code: "KeyF", ctrlKey: true });
const escape = () => keyEvent({ key: "Escape", code: "Escape" });

describe("parseCombo", () => {
  it("reads modifiers and turns characters into physical keys", () => {
    expect(parseCombo("Mod+Shift+Z")).toEqual({ mod: true, ctrl: false, alt: false, shift: true, meta: false, code: "KeyZ", key: "Z" });
    expect(parseCombo("Mod+[").code).toBe("BracketLeft");
    expect(parseCombo("Mod+\\").code).toBe("Backslash");
    expect(parseCombo("Mod+=").code).toBe("Equal");
    expect(parseCombo("0").code).toBe("Digit0");
    expect(parseCombo("Mod+NumpadAdd").code).toBe("NumpadAdd");
  });

  it("matches named keys and other characters by key", () => {
    expect(parseCombo("Escape")).toMatchObject({ code: null, key: "Escape" });
    expect(parseCombo("Shift+ArrowLeft")).toMatchObject({ shift: true, code: null, key: "ArrowLeft" });
    expect(parseCombo("?")).toMatchObject({ code: null, key: "?" });
  });

  it("refuses modifiers it doesn't know", () => {
    expect(() => parseCombo("Hyper+F")).toThrow();
    expect(() => parseCombo("Mod+")).toThrow();
  });

  it("reads every combo in the table", () => {
    for (const id of Object.keys(COMMANDS) as CommandId[]) for (const combo of keysOf(id)) expect(() => parseCombo(combo)).not.toThrow();
  });
});

describe("matchesCombo", () => {
  it("takes Mod as Ctrl, and as ⌘ on macOS", () => {
    expect(matchesCombo({ event: ctrlF, combo: "Mod+F", mac: false })).toBe(true);
    expect(matchesCombo({ event: ctrlF, combo: "Mod+F", mac: true })).toBe(false);
    const cmdF = keyEvent({ key: "f", code: "KeyF", metaKey: true });
    expect(matchesCombo({ event: cmdF, combo: "Mod+F", mac: true })).toBe(true);
    expect(matchesCombo({ event: cmdF, combo: "Mod+F", mac: false })).toBe(false);
  });

  it("matches by physical key, so an Arabic layout works", () => {
    expect(matchesCombo({ event: keyEvent({ key: "ب", code: "KeyF", ctrlKey: true }), combo: "Mod+F", mac: false })).toBe(true);
    expect(matchesCombo({ event: keyEvent({ key: "ب", code: "KeyF" }), combo: "F" })).toBe(true);
    expect(matchesCombo({ event: keyEvent({ key: "ا", code: "KeyH" }), combo: "H" })).toBe(true);
    expect(matchesCombo({ event: keyEvent({ key: "٠", code: "Digit0" }), combo: "0" })).toBe(true);
    expect(matchesCombo({ event: keyEvent({ key: "f", code: "KeyJ" }), combo: "F" })).toBe(false);
  });

  it("needs the modifiers to match exactly", () => {
    const ctrlShiftF = keyEvent({ key: "F", code: "KeyF", ctrlKey: true, shiftKey: true });
    expect(matchesCombo({ event: ctrlShiftF, combo: "Mod+F", mac: false })).toBe(false);
    expect(matchesCombo({ event: ctrlShiftF, combo: "Mod+Shift+F", mac: false })).toBe(true);
    expect(matchesCombo({ event: keyEvent({ key: "f", code: "KeyF", shiftKey: true }), combo: "F" })).toBe(false);
    expect(matchesCombo({ event: ctrlF, combo: "F", mac: false })).toBe(false);
    expect(matchesCombo({ event: keyEvent({ key: "f", code: "KeyF", ctrlKey: true, altKey: true }), combo: "Mod+F", mac: false })).toBe(false);
    expect(matchesCombo({ event: keyEvent({ key: "ArrowLeft", code: "ArrowLeft", altKey: true }), combo: "Alt+ArrowLeft" })).toBe(true);
  });

  it("keeps both Ctrl+= and Ctrl++ for larger text", () => {
    expect(matchesCommand({ event: keyEvent({ key: "=", code: "Equal", ctrlKey: true }), id: "text.bigger", mac: false })).toBe(true);
    expect(matchesCommand({ event: keyEvent({ key: "+", code: "Equal", ctrlKey: true, shiftKey: true }), id: "text.bigger", mac: false })).toBe(true);
    expect(matchesCommand({ event: keyEvent({ key: "+", code: "NumpadAdd", ctrlKey: true }), id: "text.bigger", mac: false })).toBe(true);
  });

  it("matches Enter from the number pad too, by key", () => {
    expect(matchesCombo({ event: keyEvent({ key: "Enter", code: "NumpadEnter" }), combo: "Enter" })).toBe(true);
  });
});

describe("formatting", () => {
  it("writes combos the way the platform does", () => {
    expect(formatCombo("Mod+D", { mac: false })).toBe("Ctrl+D");
    expect(formatCombo("Mod+D", { mac: true })).toBe("⌘D");
    expect(formatCombo("Mod+Shift+Z", { mac: true })).toBe("⇧⌘Z");
    expect(formatCombo("Mod+[", { mac: false })).toBe("Ctrl+[");
    expect(formatCombo("Mod+-", { mac: false })).toBe("Ctrl+−");
    expect(formatCombo("Shift+Enter", { mac: false })).toBe("Shift+Enter");
    expect(formatCombo("Escape", { mac: false })).toBe("Esc");
    expect(formatCombo("F", { mac: false })).toBe("F");
    expect(comboParts("Mod+D", { mac: false })).toEqual(["Ctrl", "D"]);
  });

  it("labels a command with its main combo", () => {
    expect(shortcutLabel("bookmark.toggle", { mac: false })).toBe("Bookmark page (Ctrl+D)");
    expect(shortcutLabel("find.open", { mac: false })).toBe("Find on page (Ctrl+F)");
    expect(withShortcut({ label: "Hide contents", command: "contents.toggle", mac: false })).toBe("Hide contents (Ctrl+[)");
    expect(withShortcut({ label: "Show scan", command: "scan.toggle", mac: false })).toBe("Show scan (S)");
    expect(shortcutKeys("panels.toggle", { mac: false })).toBe("Ctrl+\\");
    expect(shortcutKeys("scan.fit", { mac: false })).toBe("0");
  });

  it("writes aria-keyshortcuts", () => {
    expect(ariaKeyShortcuts(["settings.back", "settings.close"], { mac: false })).toBe("Alt+ArrowLeft Escape");
    expect(ariaKeyShortcuts(["bookmark.toggle"], { mac: true })).toBe("Meta+D");
  });
});

describe("dispatcher", () => {
  const dispatcher = () => createKeyDispatcher<FakeKey>({ isTyping: (e) => e.typing, mac: false });

  it("lets the highest scope that handles a command win", () => {
    const keys = dispatcher();
    const route = vi.fn();
    const popover = vi.fn();
    keys.register({ scope: "popover", handlers: () => ({ "reader.dismiss": popover }) });
    keys.register({ scope: "route", handlers: () => ({ "reader.dismiss": route }) });
    const e = escape();
    expect(keys.dispatch(e)).toBe(true);
    expect(popover).toHaveBeenCalledOnce();
    expect(route).not.toHaveBeenCalled();
    expect(e.prevented).toBe(true);
  });

  it("passes a key down when a handler returns false", () => {
    const keys = dispatcher();
    const route = vi.fn();
    keys.register({ scope: "route", handlers: () => ({ "reader.dismiss": route }) });
    keys.register({ scope: "panel", handlers: () => ({ "scan.fit": () => false }) });
    expect(keys.dispatch(escape())).toBe(true);
    expect(route).toHaveBeenCalledOnce();
  });

  it("tries commands sharing a key in table order within a scope", () => {
    const keys = dispatcher();
    const calls: string[] = [];
    keys.register({
      scope: "route",
      handlers: () => ({
        "reader.dismiss": () => void calls.push("dismiss"),
        "focus.leave": () => {
          calls.push("leave");
          return false;
        },
      }),
    });
    keys.dispatch(escape());
    expect(calls).toEqual(["leave", "dismiss"]);
  });

  it("leaves an unhandled key alone", () => {
    const keys = dispatcher();
    keys.register({ scope: "route", handlers: () => ({ "reader.dismiss": () => false }) });
    const e = escape();
    expect(keys.dispatch(e)).toBe(false);
    expect(e.prevented).toBe(false);
  });

  it("lets the latest binding in a scope win, and forgets one that unmounts", () => {
    const keys = dispatcher();
    const first = vi.fn();
    const second = vi.fn();
    keys.register({ scope: "route", handlers: () => ({ "find.open": first }) });
    const unregister = keys.register({ scope: "route", handlers: () => ({ "find.open": second }) });
    keys.dispatch(keyEvent({ key: "f", code: "KeyF", ctrlKey: true }));
    expect(second).toHaveBeenCalledOnce();
    unregister();
    keys.dispatch(keyEvent({ key: "f", code: "KeyF", ctrlKey: true }));
    expect(first).toHaveBeenCalledOnce();
  });

  it("skips commands while typing unless they're allowed", () => {
    const keys = dispatcher();
    const find = vi.fn();
    const zoom = vi.fn();
    keys.register({ scope: "route", handlers: () => ({ "find.open": find, "text.bigger": zoom }) });
    const typedCtrlF = keyEvent({ key: "f", code: "KeyF", ctrlKey: true, typing: true });
    expect(keys.dispatch(typedCtrlF)).toBe(false);
    expect(typedCtrlF.prevented).toBe(false);
    expect(find).not.toHaveBeenCalled();
    keys.dispatch(keyEvent({ key: "=", code: "Equal", ctrlKey: true, typing: true }));
    expect(zoom).toHaveBeenCalledOnce();
  });

  it("gives a fallback the keys no command took, but not while typing", () => {
    const keys = dispatcher();
    const typed: string[] = [];
    const page = vi.fn();
    keys.register({ scope: "route", handlers: () => ({ "page.next": page }) });
    keys.register({ scope: "popover", handlers: () => ({}), fallback: () => (e) => (e.key === "ArrowLeft" ? (typed.push(e.key), true) : false) });
    keys.dispatch(keyEvent({ key: "ArrowLeft", code: "ArrowLeft" }));
    expect(typed).toEqual(["ArrowLeft"]);
    expect(page).not.toHaveBeenCalled();
    keys.dispatch(keyEvent({ key: "PageDown", code: "PageDown" }));
    expect(page).toHaveBeenCalledOnce();
    keys.dispatch(keyEvent({ key: "ArrowLeft", code: "ArrowLeft", typing: true }));
    expect(typed).toEqual(["ArrowLeft"]);
  });

  it("reads the handlers at the time of the key", () => {
    const keys = dispatcher();
    let open = false;
    keys.register({ scope: "route", handlers: () => (open ? { "reader.dismiss": () => void (open = false) } : {}) });
    expect(keys.dispatch(escape())).toBe(false);
    open = true;
    expect(keys.dispatch(escape())).toBe(true);
    expect(open).toBe(false);
  });
});

describe("handleKeys", () => {
  it("runs a field's command and keeps the key from the page", () => {
    const step = vi.fn();
    const e = keyEvent({ key: "Enter", code: "Enter", shiftKey: true, typing: true });
    expect(handleKeys({ event: e, handlers: { "find.next": () => step(1), "find.previous": () => step(-1) }, mac: false })).toBe(true);
    expect(step).toHaveBeenCalledWith(-1);
    expect(e.prevented && e.stopped).toBe(true);
  });

  it("lets a key it passes on carry on", () => {
    const e = escape();
    expect(handleKeys({ event: e, handlers: { "scan.fit": () => false } })).toBe(false);
    expect(e.prevented || e.stopped).toBe(false);
  });
});
