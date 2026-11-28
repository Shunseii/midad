import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { createHashRouter, RouterProvider } from "react-router";
import { AppShell } from "./components/app-shell";
import { ShortcutsDialog } from "./components/shortcuts-dialog";
import { ThemeSync } from "./lib/appearance";
import { LAST_SCREEN_PREF, launchPlace, ON_LAUNCH_PREF, screenOf } from "./lib/launch";
import { getPref, setPref } from "./lib/prefs";
import { queryClient } from "./lib/query-client";
import { KeybindingsRoot } from "./lib/use-keybindings";
import { keys, midad } from "./lib/midad";
import { dropFocusFromClickedControls } from "./lib/pointer-focus";
import { passPressesThroughTransitions } from "./lib/view-transition";
import { LibraryRoute } from "./routes/library";
import { ReaderRoute, type ReaderState } from "./routes/reader";
import { SettingsRoute } from "./routes/settings";
import "./styles.css";


// The midad CLI writes to the same library; show its changes as they land.
window.midadEvents.onLibraryChanged(() => void queryClient.invalidateQueries({ queryKey: ["library"] }));

window.midadEvents.onSyncStatus((status) => queryClient.setQueryData(keys.syncStatus, status));

window.midadEvents.onUpdateStatus((status) => queryClient.setQueryData(keys.updateStatus, status));

passPressesThroughTransitions();
dropFocusFromClickedControls();

const router = createHashRouter([
  {
    element: <AppShell />,
    children: [
      { index: true, element: <LibraryRoute /> },
      { path: "settings", element: <SettingsRoute /> },
    ],
  },
  { path: "read/:bookId", element: <ReaderRoute /> },
]);

/** Continue reading opens the last book at its saved place; anything missing, and the library opens as usual. */
const openLastBook = async () => {
  const onLaunch = getPref(ON_LAUNCH_PREF);
  if (onLaunch !== "continue" || router.state.location.pathname !== "/") return;
  try {
    const books = await queryClient.fetchQuery({ queryKey: keys.library, queryFn: () => midad["library.list"]() });
    const place = launchPlace({ onLaunch, lastScreen: getPref(LAST_SCREEN_PREF), books });
    if (!place) return;
    const state: ReaderState = place.anchor ? { anchor: place.anchor, launched: true } : { launched: true };
    await router.navigate(`/read/${place.bookId}?p=${place.position}`, { replace: true, state });
  } catch (err) {
    console.error("Couldn't reopen the last book:", err);
  }
};

const root = document.getElementById("root");
if (!root) throw new Error("#root is missing from index.html");

await openLastBook();
const recordScreen = (pathname: string) => setPref({ key: LAST_SCREEN_PREF.key, value: screenOf(pathname) });
recordScreen(router.state.location.pathname);
router.subscribe(({ location }) => recordScreen(location.pathname));

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeSync />
      <KeybindingsRoot />
      <TooltipProvider delay={400}>
      <RouterProvider router={router} />
      <ShortcutsDialog />
      <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  </StrictMode>,
);
