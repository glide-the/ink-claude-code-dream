#!/usr/bin/env node
// [Input] The one original-source build, explicit recovered dependencies, and fixed build policy.
// [Output] Compile twice and compare every actual bundle/asset byte, without changing ZIP/publication policy.
// [Pos] Canonical source Runtime reproducibility gate, not legacy envelope qualification.
// [Sync] 2026-09-13: validate src-based outputs after removing the independent implementation.

import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join, resolve, relative } from "node:path";
const root = resolve(import.meta.dirname, "..");
const bun = join(process.env.INK_CORE_TOOLCHAIN_ROOT || root, "node_modules/.bin/bun");
async function inventory(directory) {
 const files = [];
 async function visit(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
   const file = join(dir, entry.name);
   if (entry.isSymbolicLink()) throw new Error("unexpected bundle symlink");
   if (entry.isDirectory()) await visit(file);
   else files.push({ path: relative(directory, file), sha256: createHash("sha256").update(await readFile(file)).digest("hex") });
  }
 }
 await visit(directory);
 files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
 return { fileCount: files.length, sha256: createHash("sha256").update(JSON.stringify(files)).digest("hex") };
}
async function build() {
 for (const [executable, args] of [[bun, ["scripts/build.ts"]], [process.execPath, ["scripts/verify-core-prune.mjs"]]]) {
  const result = spawnSync(executable, args, { cwd: root, env: process.env, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || "source build failed");
 }
 return inventory(join(root, "dist/core-local/bundle"));
}
const first = await build();
const second = await build();
if (JSON.stringify(first) !== JSON.stringify(second)) throw new Error("canonical bundle reproducibility mismatch");
console.log(JSON.stringify({ ok: true, implementationRoot: "src", first, second }));
