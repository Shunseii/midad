import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { defineConfig } from "electron-vite";

export default defineConfig({
  main: {},
  preload: {
    build: {
      rollupOptions: {
        // Sandboxed preloads must be CommonJS.
        output: { format: "cjs", entryFileNames: "[name].cjs" },
      },
    },
  },
  renderer: {
    resolve: { alias: { "@": resolve(import.meta.dirname, "src/renderer/src") } },
    plugins: [react(), tailwindcss()],
  },
});
