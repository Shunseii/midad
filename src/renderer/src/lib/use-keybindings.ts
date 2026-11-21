import { useEffect, useRef } from "react";
import { COMMAND_IDS, type CommandId, commandOf, IS_MAC, type KeyEventLike, matchesCommand } from "./keymap";

/**
 * Where a set of key bindings lives. Higher scopes see a key first:
 * popover > panel > route > app. Within one scope, the latest to mount wins.
 */
export type KeyScope = "app" | "route" | "panel" | "popover";

const SCOPE_RANK: Record<KeyScope, number> = { app: 0, route: 1, panel: 2, popover: 3 };

/** Handles a command. Returning false passes the key on to the next command or scope. */
export type KeyHandler<E> = (event: E) => boolean | void;

export type KeyHandlers<E> = Partial<Record<CommandId, KeyHandler<E>>>;

export interface DispatchedKey extends KeyEventLike {
  target: EventTarget | null;
  preventDefault: () => void;
}

interface Binding<E> {
  scope: KeyScope;
  handlers: () => KeyHandlers<E>;
  /** Keys none of the commands took, such as text typed into a modal editor. Returns true when it used the key. */
  fallback?: () => ((event: E) => boolean) | undefined;
}

/** Runs the first matching command that doesn't pass, in table order. Returns whether one handled the key. */
const runCommands = <E extends KeyEventLike>({ event, handlers, typing, mac }: { event: E; handlers: KeyHandlers<E>; typing: boolean; mac: boolean }) =>
  COMMAND_IDS.some((id) => {
    const handler = handlers[id];
    if (!handler || (typing && !commandOf(id).allowWhileTyping) || !matchesCommand({ event, id, mac })) return false;
    return handler(event) !== false;
  });

/**
 * Keys for one focused element (a field, the scrubber), from its own onKeyDown.
 * A handled key is kept from the page: its default action and the bindings
 * further up see nothing.
 */
export const handleKeys = <E extends KeyEventLike & { preventDefault: () => void; stopPropagation: () => void }>({
  event,
  handlers,
  mac = IS_MAC,
}: {
  event: E;
  handlers: KeyHandlers<E>;
  mac?: boolean;
}): boolean => {
  if (!runCommands({ event, handlers, typing: false, mac })) return false;
  event.preventDefault();
  event.stopPropagation();
  return true;
};

/**
 * One stack of key bindings fed by one keydown listener. Commands that aren't
 * allowed while typing are skipped when `isTyping` says the key is going into
 * a field.
 */
export const createKeyDispatcher = <E extends DispatchedKey>({ isTyping, mac = IS_MAC }: { isTyping: (event: E) => boolean; mac?: boolean }) => {
  const bindings: (Binding<E> & { order: number })[] = [];
  let mounted = 0;

  const register = (binding: Binding<E>) => {
    const entry = { ...binding, order: mounted++ };
    bindings.push(entry);
    return () => {
      const at = bindings.indexOf(entry);
      if (at >= 0) bindings.splice(at, 1);
    };
  };

  const dispatch = (event: E): boolean => {
    const typing = isTyping(event);
    const stack = [...bindings].sort((a, b) => SCOPE_RANK[b.scope] - SCOPE_RANK[a.scope] || b.order - a.order);
    const handled = stack.some((binding) => {
      if (runCommands({ event, handlers: binding.handlers(), typing, mac })) return true;
      const fallback = binding.fallback?.();
      return !typing && fallback !== undefined && fallback(event);
    });
    if (handled) event.preventDefault();
    return handled;
  };

  return { register, dispatch };
};

/**
 * Marks an element whose keys are its own, such as a side sheet: shortcuts
 * from inside it only run if they are allowed while typing.
 */
export const OWN_KEYS = "data-own-keys";

export const typingIn = (target: EventTarget | null): boolean =>
  target instanceof HTMLInputElement ||
  target instanceof HTMLTextAreaElement ||
  (target instanceof HTMLElement && target.isContentEditable) ||
  (target instanceof Element && target.closest(`[${OWN_KEYS}]`) !== null);

const appKeys = createKeyDispatcher<KeyboardEvent>({ isTyping: (event) => typingIn(event.target) });

/** The one window keydown listener behind every useKeybindings. Mount once, at the app root. */
export const KeybindingsRoot = () => {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => void appKeys.dispatch(event);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return null;
};

/** Handles commands from the keymap while mounted and enabled. Handlers can change every render. */
export const useKeybindings = ({
  scope,
  handlers,
  enabled = true,
  fallback,
}: {
  scope: KeyScope;
  handlers: KeyHandlers<KeyboardEvent>;
  enabled?: boolean;
  fallback?: (event: KeyboardEvent) => boolean;
}) => {
  const latest = useRef({ handlers, fallback });
  latest.current = { handlers, fallback };
  useEffect(() => {
    if (!enabled) return;
    return appKeys.register({ scope, handlers: () => latest.current.handlers, fallback: () => latest.current.fallback });
  }, [scope, enabled]);
};
