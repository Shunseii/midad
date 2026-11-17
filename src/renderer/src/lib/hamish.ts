import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { HamishApi, SyncInput } from "../../../shared/ipc";

declare global {
  interface Window {
    hamish: HamishApi;
  }
}

export const hamish = window.hamish;

export const keys = {
  settings: ["settings"] as const,
  corpusBooks: ["corpus", "books"] as const,
  library: ["library"] as const,
  book: (bookId: string) => ["library", bookId] as const,
  page: (bookId: string, position: number) => ["library", bookId, "page", position] as const,
  syncPreview: (bookId: string) => ["library", bookId, "sync-preview"] as const,
};

export const useSettings = () => useQuery({ queryKey: keys.settings, queryFn: () => hamish["settings.get"]() });

export const useLibrary = () => useQuery({ queryKey: keys.library, queryFn: () => hamish["library.list"]() });

export const useBook = (bookId: string) =>
  useQuery({ queryKey: keys.book(bookId), queryFn: () => hamish["library.get"](bookId) });

export const usePage = ({ bookId, position }: { bookId: string; position: number }) =>
  useQuery({
    queryKey: keys.page(bookId, position),
    queryFn: () => hamish["library.page"]({ bookId, position }),
    placeholderData: (previous) => previous,
  });

export const useCorpusBooks = ({ enabled }: { enabled: boolean }) =>
  useQuery({ queryKey: keys.corpusBooks, queryFn: () => hamish["corpus.listBooks"](), enabled, retry: false });

export const useSyncPreview = ({ bookId, enabled }: { bookId: string; enabled: boolean }) =>
  useQuery({
    queryKey: keys.syncPreview(bookId),
    queryFn: () => hamish["library.previewSync"]({ bookId }),
    enabled,
    retry: false,
    gcTime: 0,
  });

export const useImportBook = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (corpusBookId: string) => hamish["library.import"]({ corpusBookId }),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.library }),
  });
};

export const useSyncBook = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: SyncInput) => hamish["library.sync"](input),
    onSuccess: (_result, input) => client.invalidateQueries({ queryKey: keys.book(input.bookId) }),
  });
};

export const useSaveSettings = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { endpoint: string; key?: string }) => hamish["settings.save"](input),
    onSuccess: (settings) => {
      client.setQueryData(keys.settings, settings);
      void client.invalidateQueries({ queryKey: keys.corpusBooks });
    },
  });
};

/** Reader display preferences are per-viewer conveniences, kept in localStorage. */
export const readPref = <T>({ key, fallback }: { key: string; fallback: T }): T => {
  try {
    const raw = localStorage.getItem(`hamish.${key}`);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
};

export const writePref = ({ key, value }: { key: string; value: unknown }) => {
  try {
    localStorage.setItem(`hamish.${key}`, JSON.stringify(value));
  } catch {
    // Storage can be unavailable; preferences then last for the session only.
  }
};
