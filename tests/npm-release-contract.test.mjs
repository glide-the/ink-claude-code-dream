// [Input] Original-module Runtime layout, local package/NPM policies and root lifecycle guard.
// [Output] Prove source unification does not create publication authority or a second implementation.
// [Pos] Provider-free source-derived package/release contract regression.
// [Sync] 2026-09-13: retire the former cleanroom five-native fixture lane rather than applying it to unrelated source.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";
const root = resolve(import.meta.dirname, "..");
const json = async file => JSON.parse(await readFile(resolve(root, file), "utf8"));
test("original source, selector and local package have one Runtime version", async () => {
 const pkg = await json("package.json");
 const selector = await json("package/package.json");
 const local = await json("runtime/local-artifact-policy.json");
 const npm = await json("runtime/npm-release-policy.json");
 assert.equal(pkg.version, "0.1.8");
 assert.equal(selector.version, pkg.version);
 assert.equal(local.artifact.version, pkg.version);
 assert.equal(npm.version, pkg.version);
 assert.deepEqual(selector.bin, { claude: "cli.js", "ink-claude-code-dream": "cli.js" });
 assert.deepEqual(Object.values(selector.optionalDependencies), Array(4).fill(pkg.version));
 assert.equal(local.legalGate.publicationAllowed, false);
 assert.equal(local.legalGate.redistributionAllowed, false);
 assert.equal(npm.publish.license, null);
});
test("npm layout planning remains readable, publication remains fail closed", () => {
 const plan = spawnSync(process.execPath, ["scripts/npm-release.mjs", "plan"], { cwd: root, encoding: "utf8" });
 assert.equal(plan.status, 0, plan.stderr);
 assert.equal(JSON.parse(plan.stdout).version, "0.1.8");
 const gate = spawnSync(process.execPath, ["scripts/npm-release.mjs", "legal"], { cwd: root, encoding: "utf8",
  env: { ...process.env, INK_NPM_PUBLICATION_ALLOWED: "true" } });
 assert.notEqual(gate.status, 0);
 assert.match(gate.stderr, /publication blocked by checked policy/);
});
test("private repository root cannot be packed or published", () => {
 const result = spawnSync(process.execPath, ["scripts/npm-root-guard.mjs"], { cwd: root, encoding: "utf8" });
 assert.notEqual(result.status, 0);
 assert.match(result.stderr, /private/);
});
