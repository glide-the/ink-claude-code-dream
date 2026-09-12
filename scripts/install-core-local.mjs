#!/usr/bin/env node
// [Input] A verified production-qualified local Runtime package, exact Bun 1.4.0 binary, and an explicit/default user prefix.
// [Output] Install immutable local release/toolchain copies and atomic PATH symlinks without changing global Bun.
// [Pos] Local operator installer; it never reads restored source, credentials, transcripts, or Dream business data.
// [Sync] 2026-08-24: add the first fail-closed local Runtime installation path.
// [Sync] 2026-09-12: advance the immutable local candidate directory to Runtime 0.1.6.

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmod,
  copyFile,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  realpath,
  rename,
  rm,
  symlink,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultPackageRoot = path.join(
  repositoryRoot,
  "dist",
  "core-package-local",
  "ink-claude-code-dream-0.1.6",
);
const defaultBunBinary = path.join(repositoryRoot, "node_modules", "bun", "bin", "bun.exe");
const verifyScript = path.join(repositoryRoot, "scripts", "verify-core-package-local.mjs");

function fail(message) {
  throw new Error(`[install-core-local] ${message}`);
}

function parseArguments(argv) {
  const values = {};
  const names = new Map([
    ["--package-root", "packageRoot"],
    ["--prefix", "prefix"],
    ["--bun-binary", "bunBinary"],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const name = names.get(argv[index]);
    if (!name) fail(`unknown argument: ${argv[index]}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) fail(`${argv[index]} requires a path`);
    values[name] = path.resolve(value);
    index += 1;
  }
  return values;
}

function sha256(body) {
  return createHash("sha256").update(body).digest("hex");
}

async function regularRealPath(file, label) {
  const info = await lstat(file).catch(() => null);
  if (!info?.isFile()) fail(`${label} must be a regular file`);
  const resolved = await realpath(file);
  const resolvedInfo = await lstat(resolved).catch(() => null);
  if (!resolvedInfo?.isFile() || resolvedInfo.isSymbolicLink()) {
    fail(`${label} must resolve to a regular non-symlink file`);
  }
  return resolved;
}

function verifyPackage(packageRoot) {
  const result = spawnSync(process.execPath, [verifyScript, "--package-root", packageRoot], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  if (result.status !== 0) fail(`package verification failed\n${result.stdout}${result.stderr}`);
  const receipt = JSON.parse(result.stdout.trim());
  if (receipt.productionEligible !== true) fail("Runtime package is not production-qualified");
  return receipt;
}

async function installSymlink(link, target) {
  const existing = await lstat(link).catch(() => null);
  if (existing && !existing.isSymbolicLink()) fail(`refusing to replace non-symlink: ${link}`);
  if (existing && path.resolve(path.dirname(link), await readlink(link)) === target) return;
  const temporary = `${link}.install-${process.pid}`;
  await rm(temporary, { force: true });
  await symlink(target, temporary);
  await rename(temporary, link);
}

const options = parseArguments(process.argv.slice(2));
let packageRoot = options.packageRoot ?? defaultPackageRoot;
const prefix = options.prefix ?? path.join(os.homedir(), ".local");
const bunBinary = await regularRealPath(options.bunBinary ?? defaultBunBinary, "Bun binary");
const prefixRoot = path.parse(prefix).root;
if (!path.isAbsolute(prefix) || prefix === prefixRoot || prefix === os.homedir()) {
  fail("install prefix must be an absolute child directory, not a filesystem or home root");
}
packageRoot = await realpath(packageRoot);
const packageReceipt = verifyPackage(packageRoot);
const artifactManifest = JSON.parse(
  await readFile(path.join(packageRoot, "manifest", "artifact-manifest.json"), "utf8"),
);
const policy = JSON.parse(
  await readFile(path.join(packageRoot, "manifest", "local-artifact-policy.json"), "utf8"),
);
const bunVersionProbe = spawnSync(bunBinary, ["--version"], { encoding: "utf8" });
if (bunVersionProbe.status !== 0 || bunVersionProbe.stdout.trim() !== policy.artifact.bunVersion) {
  fail(`Bun must be exactly ${policy.artifact.bunVersion}`);
}
const bunDigest = sha256(await readFile(bunBinary));
const releaseKey = `${policy.artifact.version}-${artifactManifest.payloadTreeSha256.slice(0, 16)}`;
const toolchainKey = `${policy.artifact.bunVersion}-${bunDigest.slice(0, 16)}`;
const installRoot = path.join(prefix, "share", policy.artifact.name);
const installedRelease = path.join(installRoot, "releases", releaseKey);
const installedBun = path.join(installRoot, "toolchains", toolchainKey, "bun");
const releaseInfo = await lstat(installedRelease).catch(() => null);
if (!releaseInfo) {
  await mkdir(path.dirname(installedRelease), { recursive: true });
  const stageRoot = await mkdtemp(path.join(path.dirname(installedRelease), ".install-stage-"));
  try {
    const stagedRelease = path.join(stageRoot, "release");
    await cp(packageRoot, stagedRelease, { recursive: true, preserveTimestamps: true });
    verifyPackage(stagedRelease);
    await rename(stagedRelease, installedRelease);
  } finally {
    await rm(stageRoot, { recursive: true, force: true });
  }
} else if (!releaseInfo.isDirectory() || releaseInfo.isSymbolicLink()) {
  fail(`installed release path is not a regular directory: ${installedRelease}`);
} else {
  verifyPackage(installedRelease);
}
const bunInfo = await lstat(installedBun).catch(() => null);
if (!bunInfo) {
  await mkdir(path.dirname(installedBun), { recursive: true, mode: 0o755 });
  await copyFile(bunBinary, installedBun);
  await chmod(installedBun, 0o755);
} else if (!bunInfo.isFile() || bunInfo.isSymbolicLink()) {
  fail(`installed Bun path is not a regular file: ${installedBun}`);
}
if (sha256(await readFile(installedBun)) !== bunDigest) fail("installed Bun digest mismatch");
const installedBunProbe = spawnSync(installedBun, ["--version"], { encoding: "utf8" });
if (installedBunProbe.status !== 0 || installedBunProbe.stdout.trim() !== policy.artifact.bunVersion) {
  fail("installed Bun version mismatch");
}
await mkdir(path.join(prefix, "bin"), { recursive: true, mode: 0o755 });
const runtimeLink = path.join(prefix, "bin", policy.artifact.name);
const bunLink = path.join(prefix, "bin", policy.artifact.bunExecutableName);
await installSymlink(runtimeLink, path.join(installedRelease, policy.artifact.entrypoint));
await installSymlink(bunLink, installedBun);
process.stdout.write(`${JSON.stringify({
  status: "installed",
  runtime: runtimeLink,
  runtimeTarget: path.join(installedRelease, policy.artifact.entrypoint),
  bun: bunLink,
  bunTarget: installedBun,
  bunVersion: policy.artifact.bunVersion,
  bunSha256: bunDigest,
  coreBundleSha256: packageReceipt.coreBundleSha256,
  productionEligible: true,
})}\n`);
