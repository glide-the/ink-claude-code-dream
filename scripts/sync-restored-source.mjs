#!/usr/bin/env node
// [Input] `sync` with one explicit claude-code-sourcemap/restored-src path, or the checked local snapshot for `verify`.
// [Output] A byte-exact restored-src/src tree plus a deterministic provenance and content-inventory receipt.
// [Pos] Research-source structure synchronizer; it never makes restored code a clean-room npm input or publication material.
// [Sync] 2026-09-13: restore the complete 2.1.88 sourcemap source layout without renaming or rewriting its files.

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const restoredRoot = path.join(repositoryRoot, "restored-src");
const destination = path.join(restoredRoot, "src");
const receiptPath = path.join(restoredRoot, "source-snapshot.json");
const command = process.argv[2] ?? "verify";
const expectedSnapshot = {
  fileCount: 1902,
  totalBytes: 30382832,
  contentInventorySha256: "40269454cd690c74d129a31699935d6db713f2958aabe4787e01617e1c92a906",
  topLevelDirectories: [
    "assistant", "bootstrap", "bridge", "buddy", "cli", "commands", "components", "constants",
    "context", "coordinator", "entrypoints", "hooks", "ink", "keybindings", "memdir",
    "migrations", "moreright", "native-ts", "outputStyles", "plugins", "query", "remote",
    "schemas", "screens", "server", "services", "skills", "state", "tasks", "tools", "types",
    "upstreamproxy", "utils", "vim", "voice",
  ],
};

function fail(message) {
  throw new Error(`[sync-restored-source] ${message}`);
}

function sha256(body) {
  return createHash("sha256").update(body).digest("hex");
}

async function inventory(root) {
  const entries = [];
  async function walk(directory) {
    const children = await readdir(directory, { withFileTypes: true });
    children.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    for (const child of children) {
      const absolute = path.join(directory, child.name);
      const info = await lstat(absolute);
      if (info.isSymbolicLink()) fail(`symlink is forbidden: ${absolute}`);
      if (info.isDirectory()) {
        await walk(absolute);
        continue;
      }
      if (!info.isFile()) fail(`non-regular source entry is forbidden: ${absolute}`);
      const body = await readFile(absolute);
      entries.push({
        path: path.relative(root, absolute).split(path.sep).join("/"),
        mode: info.mode & 0o111 ? "0755" : "0644",
        bytes: body.length,
        sha256: sha256(body),
      });
    }
  }
  await walk(root);
  entries.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  const serialized = entries
    .map(entry => `${entry.mode} ${entry.sha256} ${entry.bytes} ${entry.path}\n`)
    .join("");
  const topLevelDirectories = (
    await readdir(root, { withFileTypes: true })
  )
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort();
  return {
    entries,
    fileCount: entries.length,
    totalBytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
    contentInventorySha256: sha256(serialized),
    topLevelDirectories,
  };
}

function gitValue(sourceRepository, args, label) {
  const result = spawnSync("git", ["-C", sourceRepository, ...args], {
    encoding: "utf8",
  });
  if (result.status !== 0) fail(`${label} is unavailable`);
  return result.stdout.trim();
}

async function sync(sourceRootArgument) {
  if (!sourceRootArgument || !path.isAbsolute(sourceRootArgument)) {
    fail("sync requires an explicit absolute claude-code-sourcemap/restored-src path");
  }
  const sourceRoot = path.resolve(sourceRootArgument);
  if (path.basename(sourceRoot) !== "restored-src") {
    fail("source path must end in restored-src");
  }
  const source = path.join(sourceRoot, "src");
  const sourceInfo = await lstat(source).catch(() => null);
  if (!sourceInfo?.isDirectory() || sourceInfo.isSymbolicLink()) {
    fail("source restored-src/src must be a regular directory");
  }
  if (await lstat(destination).catch(() => null)) {
    fail("destination restored-src/src already exists; refusing to overwrite it");
  }

  const sourceRepository = path.dirname(sourceRoot);
  const sourceCommit = gitValue(sourceRepository, ["rev-parse", "HEAD"], "source commit");
  const sourceSubtreeGitSha1 = gitValue(
    sourceRepository,
    ["rev-parse", "HEAD:restored-src/src"],
    "source subtree",
  );
  const sourceInventory = await inventory(source);
  if (
    sourceCommit !== "a8a678cb6244e6770e1e421767ff0987a1d95549" ||
    sourceSubtreeGitSha1 !== "7640f58ea271eb60952ebdbe0dfa173fc96ebe30" ||
    sourceInventory.fileCount !== expectedSnapshot.fileCount ||
    sourceInventory.totalBytes !== expectedSnapshot.totalBytes ||
    sourceInventory.contentInventorySha256 !== expectedSnapshot.contentInventorySha256 ||
    JSON.stringify(sourceInventory.topLevelDirectories) !==
      JSON.stringify(expectedSnapshot.topLevelDirectories)
  ) {
    fail("reference source is not the exact checked 2.1.88 snapshot; no files were copied");
  }
  await mkdir(destination, { recursive: true });
  for (const entry of sourceInventory.entries) {
    const sourceFile = path.join(source, ...entry.path.split("/"));
    const destinationFile = path.join(destination, ...entry.path.split("/"));
    await mkdir(path.dirname(destinationFile), { recursive: true });
    await copyFile(sourceFile, destinationFile);
    await chmod(destinationFile, entry.mode === "0755" ? 0o755 : 0o644);
  }

  const receipt = {
    schemaVersion: "ink-restored-source-snapshot/v1",
    source: {
      repository: "claude-code-sourcemap",
      version: "2.1.88",
      commit: sourceCommit,
      subtree: "restored-src/src",
      subtreeGitSha1: sourceSubtreeGitSha1,
      provenance: "public-npm-cli.js.map-sourcesContent",
      license: "Anthropic-all-rights-reserved-research-only",
    },
    destination: "restored-src/src",
    fileCount: sourceInventory.fileCount,
    totalBytes: sourceInventory.totalBytes,
    contentInventorySha256: sourceInventory.contentInventorySha256,
    topLevelDirectories: sourceInventory.topLevelDirectories,
    cleanroomNpmInput: false,
    redistributionAllowed: false,
    publicationAllowed: false,
  };
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o644 });
  await verify();
}

async function verify() {
  const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
  const current = await inventory(destination);
  if (
    receipt.schemaVersion !== "ink-restored-source-snapshot/v1" ||
    receipt.source?.repository !== "claude-code-sourcemap" ||
    receipt.source?.version !== "2.1.88" ||
    receipt.source?.commit !== "a8a678cb6244e6770e1e421767ff0987a1d95549" ||
    receipt.source?.subtree !== "restored-src/src" ||
    receipt.source?.subtreeGitSha1 !== "7640f58ea271eb60952ebdbe0dfa173fc96ebe30" ||
    receipt.source?.provenance !== "public-npm-cli.js.map-sourcesContent" ||
    receipt.source?.license !== "Anthropic-all-rights-reserved-research-only" ||
    receipt.destination !== "restored-src/src" ||
    receipt.cleanroomNpmInput !== false ||
    receipt.redistributionAllowed !== false ||
    receipt.publicationAllowed !== false ||
    receipt.fileCount !== expectedSnapshot.fileCount ||
    receipt.totalBytes !== expectedSnapshot.totalBytes ||
    receipt.contentInventorySha256 !== expectedSnapshot.contentInventorySha256 ||
    JSON.stringify(receipt.topLevelDirectories) !==
      JSON.stringify(expectedSnapshot.topLevelDirectories) ||
    receipt.fileCount !== current.fileCount ||
    receipt.totalBytes !== current.totalBytes ||
    receipt.contentInventorySha256 !== current.contentInventorySha256 ||
    JSON.stringify(receipt.topLevelDirectories) !== JSON.stringify(current.topLevelDirectories)
  ) {
    fail("restored source provenance, structure, or byte inventory drift");
  }
  process.stdout.write(`${JSON.stringify({
    status: "restored-source-verified",
    version: receipt.source.version,
    sourceCommit: receipt.source.commit,
    subtreeGitSha1: receipt.source.subtreeGitSha1,
    files: current.fileCount,
    bytes: current.totalBytes,
    contentInventorySha256: current.contentInventorySha256,
    topLevelDirectories: current.topLevelDirectories,
  })}\n`);
}

if (command === "sync") {
  await sync(process.argv[3]);
} else if (command === "verify") {
  await verify();
} else {
  fail(`unsupported command: ${command}`);
}
