import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { createHashRouter, RouterProvider } from "react-router";
import { AppShell } from "./components/app-shell";
import { ThemeSync } from "./lib/appearance";
import { LibraryRoute } from "./routes/library";
import { ReaderRoute } from "./routes/reader";
import { SettingsRoute } from "./routes/settings";
import "./styles.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, staleTime: 30_000 } },
});

// The midad CLI writes to the same library; show its changes as they land.
window.midadEvents.onLibraryChanged(() => void queryClient.invalidateQueries({ queryKey: ["library"] }));

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

const root = document.getElementById("root");
if (!root) throw new Error("#root is missing from index.html");

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeSync />
      <TooltipProvider delay={400}>
      <RouterProvider router={router} />
      <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  </StrictMode>,
);
