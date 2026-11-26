import { builtinModules } from "node:module";
import { defineConfig } from "vite";

// Bundles the `midad` command-line tool, and the corpus MCP server Ask AI uses, into files Midad runs on its own executable as Node (ELECTRON_RUN_AS_NODE).
export default defineConfig({
  build: {
    outDir: "out/cli",
    emptyOutDir: true,
    target: "node22",
    minify: false,
    lib: { entry: { midad: "src/cli/main.ts", "corpus-mcp": "src/mcp/main.ts" }, formats: ["es"], fileName: (_format, name) => `${name}.mjs` },
    rollupOptions: {
      external: [...builtinModules, ...builtinModules.map((m) => `node:${m}`), "node:sqlite"],
      output: { banner: "#!/usr/bin/env -S node --no-warnings" },
    },
  },
});
