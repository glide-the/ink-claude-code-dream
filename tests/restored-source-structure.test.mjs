// [Input] Checked restored-source tree, immutable snapshot receipt, and clean-room/local packaging policies.
// [Output] Prove the complete 2.1.88 module layout and exact byte inventory, without admitting it to npm artifacts.
// [Pos] Provider-free repository structure and research-source boundary regression test.
// [Sync] 2026-09-13: require all 35 original module directories and the 1,902-file sourcemap subtree.

import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const readJson = async file => JSON.parse(await readFile(resolve(root, file), "utf8"));
const expectedDirectories = [
  "assistant", "bootstrap", "bridge", "buddy", "cli", "commands", "components", "constants",
  "context", "coordinator", "entrypoints", "hooks", "ink", "keybindings", "memdir",
  "migrations", "moreright", "native-ts", "outputStyles", "plugins", "query", "remote",
  "schemas", "screens", "server", "services", "skills", "state", "tasks", "tools", "types",
  "upstreamproxy", "utils", "vim", "voice",
];

test("restored source preserves the complete reference module tree and bytes", async () => {
  const receipt = await readJson("restored-src/source-snapshot.json");
  const directories = (await readdir(resolve(root, "restored-src/src"), { withFileTypes: true }))
    .filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
  assert.deepEqual(directories, expectedDirectories);
  assert.deepEqual(receipt.topLevelDirectories, expectedDirectories);
  assert.equal(receipt.fileCount, 1902);
  assert.equal(receipt.totalBytes, 30382832);
  assert.equal(receipt.source.commit, "a8a678cb6244e6770e1e421767ff0987a1d95549");
  assert.equal(receipt.source.subtreeGitSha1, "7640f58ea271eb60952ebdbe0dfa173fc96ebe30");
  const verified = spawnSync(process.execPath, ["scripts/sync-restored-source.mjs", "verify"], {
    cwd: root, encoding: "utf8",
  });
  assert.equal(verified.status, 0, verified.stderr);
  assert.equal(JSON.parse(verified.stdout).contentInventorySha256,
    "40269454cd690c74d129a31699935d6db713f2958aabe4787e01617e1c92a906");
});

test("research source is checked in but remains excluded from clean-room npm and publication", async () => {
  const receipt = await readJson("restored-src/source-snapshot.json");
  const cleanroom = await readJson("runtime/cleanroom-artifact-policy.json");
  const npm = await readJson("runtime/cleanroom-npm-policy.json");
  const local = await readJson("runtime/local-artifact-policy.json");
  const workspace = await readJson("package.json");
  const selector = await readJson("package/package.json");
  assert.equal(receipt.cleanroomNpmInput, false);
  assert.equal(receipt.publicationAllowed, false);
  assert.equal(receipt.redistributionAllowed, false);
  assert.equal(cleanroom.source.repositoryResearchSnapshotAllowed, true);
  assert.equal(cleanroom.source.repositoryResearchSnapshotIsBuildInput, false);
  assert.equal(cleanroom.source.restoredSourceAllowed, false);
  assert.ok(npm.materialPolicy.forbiddenPathSegments.includes("restored-src"));
  assert.ok(npm.materialPolicy.forbiddenBytePatterns.includes("restored-src"));
  assert.equal(npm.publication.npmPublishAllowed, false);
  assert.equal(local.legalGate.restoredSourceMayBeCommitted, true);
  assert.equal(local.materialPolicy.restoredSourceBundled, false);
  assert.equal(workspace.version, "0.1.7");
  assert.equal(workspace.license, "UNLICENSED");
  assert.equal(selector.version, workspace.version);
  assert.equal(selector.license, "MIT");
  assert.deepEqual(selector.files, ["cli.js", "README.md", "LICENSE.md"]);
});
