// [Input] Original restored modules, the actual project src, and active build/version contracts.
// [Output] Prove unique original directories/files/modules/bytes and src-based compilation.
// [Pos] Regression for the user's single original-module Runtime requirement.
// [Sync] 2026-09-13: cover both trees and prevent a renamed or relocated parallel implementation.

import assert from "node:assert/strict";
import { readFile, readdir, access } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";
const root = resolve(import.meta.dirname, "..");
const json = async file => JSON.parse(await readFile(resolve(root, file), "utf8"));
test("src has all original module directories, file paths, modes and exact bytes", async () => {
 const receipt = await json("runtime/source-provenance.json");
 const directories = (await readdir(resolve(root, "src"), { withFileTypes: true }))
  .filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
 assert.deepEqual(directories, receipt.topLevelDirectories);
 assert.equal(directories.length, 35);
 assert.equal(receipt.fileCount, 1902);
 assert.equal(receipt.totalBytes, 30382832);
 const run = spawnSync(process.execPath, ["scripts/verify-original-source.mjs"], { cwd: root, encoding: "utf8" });
 assert.equal(run.status, 0, run.stderr);
 const verified = JSON.parse(run.stdout);
 assert.equal(verified.singleSource, true);
 await assert.rejects(access(resolve(root, "restored-src")), { code: "ENOENT" });
 assert.equal(verified.implementationRoot, "src");
 assert.equal(verified.subtreeGitSha1, "7640f58ea271eb60952ebdbe0dfa173fc96ebe30");
 assert.equal(verified.contentInventorySha256, "40269454cd690c74d129a31699935d6db713f2958aabe4787e01617e1c92a906");
 for (const file of ["main.tsx", "QueryEngine.ts", "Tool.ts", "Task.ts", "entrypoints/cli.tsx"]) await access(resolve(root, "src", file));
 await assert.rejects(access(resolve(root, "src/cleanroom")), { code: "ENOENT" });
 await assert.rejects(access(resolve(root, "src/launcher.ts")), { code: "ENOENT" });
});
test("the actual default build uses original project modules as one Runtime", async () => {
 const pkg = await json("package.json");
 const profile = await json("runtime/core-prune-profile.json");
 const layout = await json("runtime/source-layout.json");
 const build = await readFile(resolve(root, "scripts/build.ts"), "utf8");
 const compiler = await readFile(resolve(root, "scripts/build-core-prune.ts"), "utf8");
 assert.equal(pkg.version, "0.1.9");
 assert.equal(pkg.license, "UNLICENSED");
 assert.equal(pkg.scripts.build, "./node_modules/.bin/bun scripts/build.ts");
 assert.ok(!Object.keys(pkg.scripts).some(name => name.startsWith("cleanroom:")));
 assert.match(build, /import\("\.\/build-core-prune\.ts"\)/);
 assert.equal(profile.sourceDirectory, "src");
 assert.deepEqual(profile.entrypoints, ["src/entrypoints/cli.tsx"]);
 assert.equal(layout.buildUsesImplementation, true);
 assert.equal(layout.parallelImplementation, false);
 assert.equal(layout.implementationRoot, "src");
 assert.match(compiler, /const sourceRoot = repositoryRoot/);
 assert.match(compiler, /implementationSource: "repository"/);
 assert.equal(layout.publicationAllowed, true);
 assert.equal(layout.redistributionAllowed, true);
 assert.equal(layout.authorization, "runtime/source-authorization.json");
});
