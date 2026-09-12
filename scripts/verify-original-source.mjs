#!/usr/bin/env node
// [Input] Canonical src and checked source provenance; no parallel reference tree.
// [Output] Verify original module paths, modes, bytes and directory inventory.
// [Pos] Read-only single-source gate used by lint, tests and CI.
// [Sync] 2026-09-13: remove synchronization/copy routes and duplicate source dependency.

import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const sourceRoot = path.join(root, "src");
const receipt = JSON.parse(await readFile(path.join(root, "runtime/source-provenance.json"), "utf8"));
const hash = body => createHash("sha256").update(body).digest("hex");
const fail = message => { throw new Error(`[verify-original-source] ${message}`); };
const order = (a, b) => a < b ? -1 : a > b ? 1 : 0;
if (await lstat(path.join(root, "restored-src")).catch(error => {
  if (error.code === "ENOENT") return null;
  throw error;
})) fail("duplicate restored-src directory must not exist");
if (!(await lstat(sourceRoot)).isDirectory() || (await lstat(sourceRoot)).isSymbolicLink()) {
  fail("src must be a regular directory");
}
const entries = [];
const directories = [];
async function walk(directory) {
  for (const child of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, child.name);
    const info = await lstat(absolute);
    const relative = path.relative(sourceRoot, absolute).split(path.sep).join("/");
    if (info.isSymbolicLink()) fail(`source symlink forbidden: ${relative}`);
    if (info.isDirectory()) {
      directories.push(relative);
      await walk(absolute);
    } else if (info.isFile()) {
      const body = await readFile(absolute);
      entries.push({ path: relative, mode: info.mode & 0o111 ? "0755" : "0644", bytes: body.length, sha256: hash(body) });
    } else fail(`non-regular source entry: ${relative}`);
  }
}
await walk(sourceRoot);
entries.sort((a, b) => order(a.path, b.path));
directories.sort(order);
const bytes = entries.reduce((total, entry) => total + entry.bytes, 0);
const contentInventorySha256 = hash(entries.map(entry => `${entry.mode} ${entry.sha256} ${entry.bytes} ${entry.path}\n`).join(""));
const directoryInventorySha256 = hash(directories.map(directory => `${directory}\n`).join(""));
const topLevelDirectories = directories.filter(directory => !directory.includes("/"));
if (receipt.schemaVersion !== "ink-original-source-provenance/v1" || receipt.destination !== "src" ||
    receipt.source?.repository !== "claude-code-sourcemap" || receipt.source?.version !== "2.1.88" ||
    receipt.source?.commit !== "a8a678cb6244e6770e1e421767ff0987a1d95549" ||
    receipt.source?.subtree !== "restored-src/src" ||
    receipt.source?.subtreeGitSha1 !== "7640f58ea271eb60952ebdbe0dfa173fc96ebe30" ||
    receipt.source?.provenance !== "public-npm-cli.js.map-sourcesContent" ||
    receipt.source?.license !== "Anthropic-all-rights-reserved-research-only" ||
    receipt.fileCount !== 1902 || entries.length !== 1902 ||
    receipt.totalBytes !== 30382832 || bytes !== 30382832 ||
    receipt.contentInventorySha256 !== "40269454cd690c74d129a31699935d6db713f2958aabe4787e01617e1c92a906" ||
    receipt.contentInventorySha256 !== contentInventorySha256 ||
    receipt.directoryInventorySha256 !== "de240ba91f4fb367107c227cf490b7222f3a0df8143957af3c1ecbb51ad593ac" ||
    receipt.directoryInventorySha256 !== directoryInventorySha256 ||
    JSON.stringify(receipt.topLevelDirectories) !== JSON.stringify(topLevelDirectories) || topLevelDirectories.length !== 35) {
  fail("original source provenance, paths, directories, bytes or modes drift");
}
console.log(JSON.stringify({ status: "original-source-verified", version: receipt.source.version,
  sourceCommit: receipt.source.commit, subtreeGitSha1: receipt.source.subtreeGitSha1,
  implementationRoot: "src", singleSource: true, files: entries.length, bytes,
  contentInventorySha256, directoryInventorySha256, topLevelDirectories }));
