import { useCallback, useSyncExternalStore } from "react";

/** Reader display preferences are per-viewer conveniences, kept in localStorage. */
export const readPref = <T>({ key, fallback }: { key: string; fallback: T }): T => {
  try {
    const raw = localStorage.getItem(`midad.${key}`);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
};

export const writePref = ({ key, value }: { key: string; value: unknown }) => {
  try {
    localStorage.setItem(`midad.${key}`, JSON.stringify(value));
  } catch {
    // Storage can be unavailable; preferences then last for the session only.
  }
};

/**
 * Preferences shared by every component that reads them: a change made in one
 * place (the display menu, Settings) shows everywhere at once.
 */
const cache = new Map<string, unknown>();
const listeners = new Map<string, Set<() => void>>();

export const getPref = <T>({ key, fallback }: { key: string; fallback: T }): T => {
  if (!cache.has(key)) cache.set(key, readPref({ key, fallback }));
  return cache.get(key) as T;
};

export const setPref = ({ key, value }: { key: string; value: unknown }) => {
  if (cache.get(key) === value) return;
  cache.set(key, value);
  writePref({ key, value });
  for (const listener of listeners.get(key) ?? []) listener();
};

export const subscribePref = ({ key, listener }: { key: string; listener: () => void }) => {
  const set = listeners.get(key) ?? new Set();
  set.add(listener);
  listeners.set(key, set);
  return () => {
    set.delete(listener);
  };
};

export const usePref = <T>({ key, fallback }: { key: string; fallback: T }) => {
  const value = useSyncExternalStore(
    useCallback((listener: () => void) => subscribePref({ key, listener }), [key]),
    () => getPref({ key, fallback }),
  );
  const update = useCallback((next: T) => setPref({ key, value: next }), [key]);
  return [value, update] as const;
};
