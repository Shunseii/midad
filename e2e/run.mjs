#!/usr/bin/env node
// Headless end-to-end checks against the built app: `pnpm build && pnpm build:cli`, then `pnpm test:app [group]`.
import { readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { assertBuilt, createTemplate, launchApp } from "./lib/app.mjs";

const filter = process.argv[2]?.toLowerCase();
const started = Date.now();

try {
  assertBuilt();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

const dir = join(import.meta.dirname, "checks");
const groups = [];
for (const file of readdirSync(dir).filter((f) => f.endsWith(".mjs")).sort()) {
  const mod = await import(join(dir, file));
  groups.push({ file, ...mod });
}

const { root, template } = createTemplate();
const results = [];
let open = null;
const cleanup = () => {
  open?.close().catch(() => {});
  rmSync(root, { recursive: true, force: true });
};
process.on("SIGINT", () => {
  cleanup();
  process.exit(130);
});

for (const group of groups) {
  // Checks in a group build on each other, so a filter picks whole groups.
  if (filter && !`${group.file} ${group.name}`.toLowerCase().includes(filter)) continue;
  const selected = group.checks;
  console.log(`\n${group.name}`);
  try {
    open = await launchApp({ root, template, name: group.file.replace(/\.mjs$/, ""), ...group.viewport });
  } catch (err) {
    for (const [name] of selected) results.push({ group: group.name, name, ok: false, error: `launch failed: ${err.message}` });
    console.log(`  ✗ couldn't launch the app: ${err.message}`);
    continue;
  }
  for (const [name, run] of selected) {
    const t = Date.now();
    const errorsBefore = open.page.errors.length;
    try {
      await run(open.page, open);
      const uncaught = open.page.errors.slice(errorsBefore);
      if (uncaught.length) throw new Error(`uncaught error in the app: ${uncaught[0]}`);
      results.push({ group: group.name, name, ok: true });
      console.log(`  ✓ ${name} (${Date.now() - t}ms)`);
    } catch (err) {
      results.push({ group: group.name, name, ok: false, error: err.message });
      console.log(`  ✗ ${name} (${Date.now() - t}ms)\n      ${err.message.split("\n").join("\n      ")}`);
    }
  }
  await open.close();
  open = null;
}
cleanup();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed in ${((Date.now() - started) / 1000).toFixed(1)}s`);
for (const f of failed) console.log(`  ✗ ${f.group} › ${f.name}`);
process.exit(failed.length || !results.length ? 1 : 0);
