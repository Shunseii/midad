export interface History<T> {
  done: readonly T[];
  undone: readonly T[];
}

export const EMPTY_HISTORY: History<never> = { done: [], undone: [] };

export const record = <T>(history: History<T>, entry: T): History<T> => ({ done: [...history.done, entry], undone: [] });

export const undo = <T>(history: History<T>): { history: History<T>; entry: T | null } => {
  const entry = history.done.at(-1);
  if (entry === undefined) return { history, entry: null };
  return { history: { done: history.done.slice(0, -1), undone: [...history.undone, entry] }, entry };
};

export const redo = <T>(history: History<T>): { history: History<T>; entry: T | null } => {
  const entry = history.undone.at(-1);
  if (entry === undefined) return { history, entry: null };
  return { history: { done: [...history.done, entry], undone: history.undone.slice(0, -1) }, entry };
};
