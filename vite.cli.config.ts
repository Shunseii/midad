import { builtinModules } from "node:module";
import { defineConfig } from "vite";

// Bundles the `midad` command-line tool into one file that runs on Node 22+.
export default defineConfig({
  build: {
    outDir: "out/cli",
    emptyOutDir: true,
    target: "node22",
    minify: false,
    lib: { entry: "src/cli/main.ts", formats: ["es"], fileName: () => "midad.mjs" },
    rollupOptions: {
      external: [...builtinModules, ...builtinModules.map((m) => `node:${m}`), "node:sqlite"],
      output: { banner: "#!/usr/bin/env -S node --no-warnings" },
    },
  },
});
