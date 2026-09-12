#!/usr/bin/env node
// [Input] Original src/restored-src module inventories, active build/package contracts, historical attestations, and Git files.
// [Output] Fail on a parallel implementation, module/layout drift, version drift, or unsafe release authority.
// [Pos] Source-of-truth lint for the single original-module Runtime.
// [Sync] 2026-09-13: replace the mistaken prohibition on combining original source with the actual implementation.

import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const json = async file => JSON.parse(await readFile(resolve(root, file), "utf8"));
const pkg = await json("package.json");
const selector = await json("package/package.json");
const layout = await json("runtime/source-layout.json");
const profile = await json("runtime/core-prune-profile.json");
const local = await json("runtime/local-artifact-policy.json");
const localManifest = await json("runtime/local-release-manifest.json");
const npm = await json("runtime/npm-release-policy.json");
function require_(condition, message) { if (!condition) throw new Error(message); }

require_(pkg.name === "ink-claude-code-dream" && pkg.version === "0.1.8" && pkg.private === true &&
  pkg.license === "UNLICENSED" && !Object.hasOwn(pkg, "bin"), "private project identity drift");
require_(selector.version === pkg.version && selector.bin.claude === "cli.js" &&
  selector.bin["ink-claude-code-dream"] === "cli.js", "selector version/entrypoint drift");
require_(Object.values(selector.optionalDependencies).every(version => version === pkg.version), "native version drift");
require_(layout.implementationRoot === "src" && layout.referenceRoot === "restored-src/src" &&
  layout.entrypoint === "src/entrypoints/cli.tsx" && layout.parallelImplementation === false &&
  layout.sameModulePaths === true && layout.buildUsesImplementation === true, "single module ownership drift");
require_(profile.sourceDirectory === "src" && profile.entrypoints.length === 1 &&
  profile.entrypoints[0] === layout.entrypoint && profile.builder.version === "1.4.0", "actual compiler routing drift");
require_(pkg.scripts.build === "./node_modules/.bin/bun scripts/build.ts" &&
  !Object.keys(pkg.scripts).some(name => name.startsWith("cleanroom:")), "parallel default build route");
require_(local.artifact.version === pkg.version && localManifest.runtime.version === pkg.version &&
  localManifest.runtime.integration.sdkVersion === "0.2.145" && npm.version === pkg.version, "Runtime/Dream version contract drift");
require_(local.legalGate.publicationAllowed === false && local.legalGate.redistributionAllowed === false &&
  local.legalGate.derivedBundleMayBeCommitted === false &&
  layout.publicationAllowed === false && layout.redistributionAllowed === false, "source provenance is not release authority");
require_(npm.publish.license === null, "npm publication has no source-derived license grant");
require_(await stat(resolve(root, "src/cleanroom")).then(() => false, error => error.code === "ENOENT"),
  "src/cleanroom must not remain as a second Runtime");
const verified = spawnSync(process.execPath, ["scripts/sync-restored-source.mjs", "verify"], { cwd: root, encoding: "utf8" });
require_(verified.status === 0, verified.stderr || "module inventory failed");
const source = JSON.parse(verified.stdout);
require_(source.sameModules === true && source.implementationRoot === "src", "side snapshot does not restore project src");
for (const [version, digest] of [
  ["0.1.3", "2e7da1f41a41af3b229b79080085e587cdae39e664d7630ed209592ec8c73d4b"],
  ["0.1.5", "dbe6f521e51c62a774afcb90f1969b66b422ad34e420b1d73f875b989597e662"],
]) {
 const body = await readFile(resolve(root, "runtime/attestations/dream-real-business-acceptance-" + version + ".json"));
 require_(createHash("sha256").update(body).digest("hex") === digest, "historical acceptance was rewritten");
}
const inventory = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: root, encoding: "utf8" });
require_(inventory.status === 0, "Git inventory failed");
const files = inventory.stdout.split("\0").filter(Boolean);
for (const file of files) {
 if (file.startsWith("src/") || file.startsWith("restored-src/src/") || file.startsWith("dist/")) continue;
 if (file.startsWith("vendor/")) throw new Error("vendor artifacts are not project source");
 const info = await stat(resolve(root, file)).catch(error => error.code === "ENOENT" ? null : Promise.reject(error));
 if (!info) continue;
 require_(info.size <= 10 * 1024 * 1024, "unexpected large artifact: " + file);
 if ([".js", ".mjs", ".ts", ".py", ".md"].includes(extname(file)) && !file.endsWith("/LICENSE.md")) {
  const header = (await readFile(resolve(root, file), "utf8")).split("\n").slice(0, 8).join("\n");
  require_(["[Input]", "[Output]", "[Pos]"].every(field => header.includes(field)), "missing file header: " + file);
 }
}
console.log(JSON.stringify({ ok: true, version: pkg.version, implementationRoot: "src", sameModules: true,
  modules: source.files, directories: source.topLevelDirectories.length, files: files.length }));
