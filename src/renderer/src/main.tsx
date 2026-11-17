import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter, Route, Routes } from "react-router";
import { AppShell } from "./components/app-shell";
import { LibraryRoute } from "./routes/library";
import { ReaderRoute } from "./routes/reader";
import { SettingsRoute } from "./routes/settings";
import "./styles.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, staleTime: 30_000 } },
});

const root = document.getElementById("root");
if (!root) throw new Error("#root is missing from index.html");

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<LibraryRoute />} />
            <Route path="settings" element={<SettingsRoute />} />
          </Route>
          <Route path="read/:bookId" element={<ReaderRoute />} />
        </Routes>
      </HashRouter>
    </QueryClientProvider>
  </StrictMode>,
);
