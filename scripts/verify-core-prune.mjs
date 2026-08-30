// [Input] Local-only core-prune profile, resolution map, build receipt, metafile, and resolution gaps.
// [Output] Fail unless Bun/source digest/feature-DCE/output-path/resolution evidence is internally consistent and built.
// [Pos] Read-only verifier for dist/core-local; it neither builds nor reads external restored source.
// [Sync] 2026-08-30: gate restored 2.1.88 seccomp asset provenance, digest, path, and mode.

import { opendir, readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..");
const outputRoot = join(repositoryRoot, "dist", "core-local");

async function json(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

const [profile, resolutionMap, receipt, metafile, gaps] = await Promise.all([
  json(join(repositoryRoot, "runtime", "core-prune-profile.json")),
  json(join(repositoryRoot, "runtime", "core-resolution-map.json")),
  json(join(outputRoot, "build-receipt.json")),
  json(join(outputRoot, "metafile.json")),
  json(join(outputRoot, "resolution-gaps.json")),
]);

function fail(message) {
  throw new Error(`[verify-core-prune] ${message}`);
}

async function filesUnder(root) {
  const files = [];
  async function visit(directory) {
    const handle = await opendir(directory);
    for await (const entry of handle) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files.push(path);
    }
  }
  await visit(root);
  return files.sort();
}

if ((await realpath(outputRoot)) !== outputRoot) fail("output root must not be a symlink");
if (!(await stat(outputRoot)).isDirectory()) fail("output root is not a directory");
if (profile.outputDirectory !== "dist/core-local" || receipt.outputDirectory !== profile.outputDirectory) {
  fail("output directory drift");
}
if (profile.builder?.version !== "1.4.0" || receipt.builder?.version !== "1.4.0") {
  fail("Bun 1.4.0 receipt is required");
}
if (receipt.status !== "built" || receipt.build?.success !== true) fail("build is not successful");
if (!/^[a-f0-9]{64}$/.test(receipt.sourceDigest?.digest ?? "")) fail("invalid source digest");
if (!Number.isSafeInteger(receipt.sourceDigest?.fileCount) || receipt.sourceDigest.fileCount < 1) {
  fail("invalid source file count");
}
if (!Number.isSafeInteger(receipt.sourceDigest?.bytes) || receipt.sourceDigest.bytes < 1) {
  fail("invalid source byte count");
}
if (JSON.stringify(receipt.features) !== JSON.stringify(profile.features)) fail("feature receipt drift");
if (
  JSON.stringify(receipt.sourceTransforms) !==
  JSON.stringify(profile.sourceTransforms.map(({ path, sha256, transform }) => ({ path, sha256, transform })))
) {
  fail("source-transform receipt drift");
}
if (profile.features.enabled.some(feature => profile.features.disabled.includes(feature))) {
  fail("enabled and disabled features overlap");
}
if (receipt.dceAssertions?.status !== "passed" || receipt.dceAssertions.violations.length !== 0) {
  fail("DCE assertions did not pass");
}
if (
  gaps.gaps?.length !== 0 ||
  gaps.uniqueGaps?.length !== 0 ||
  receipt.resolution?.edgeGapCount !== 0 ||
  receipt.resolution?.uniqueGapCount !== 0
) {
  fail("resolution gaps remain");
}

const metafileInputs = Object.keys(metafile.inputs ?? {}).map(path => path.replaceAll("\\", "/"));
const logicalInputs = metafileInputs.map(path => path.replace(/^<SOURCE_ROOT>\//, ""));
const supportedRuntimeTargets = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"];
if (!supportedRuntimeTargets.includes(receipt.runtimeTarget)) fail("unsupported Runtime target receipt");
if (receipt.runtimeTarget !== `${process.platform}-${process.arch}`) {
  fail("core receipt target does not match the verifying host");
}
const selectedRuntimeAssets = [
  ...profile.runtimeAssets,
  ...(profile.runtimeAssetTargets?.[receipt.runtimeTarget] ?? []),
];
if (JSON.stringify(receipt.runtimeAssets) !== JSON.stringify(
  selectedRuntimeAssets.map(({ sourceRoot, sourceIdentity, output, sha256, mode, license }) => ({
    sourceRoot: sourceRoot ?? "authorized-package",
    sourceIdentity: sourceIdentity ?? `@anthropic-ai/claude-code@${profile.sourceVersionEvidence}`,
    output,
    sha256,
    mode,
    license,
  })),
)) fail("runtime-asset receipt drift");
for (const asset of receipt.runtimeAssets) {
  const assetPath = join(outputRoot, "bundle", asset.output);
  const info = await stat(assetPath);
  if (!info.isFile() || (info.mode & 0o777) !== asset.mode) {
    fail(`runtime asset mode drift: ${asset.output}`);
  }
  const digest = (await import("node:crypto")).createHash("sha256")
    .update(await readFile(assetPath)).digest("hex");
  if (digest !== asset.sha256) fail(`runtime asset digest drift: ${asset.output}`);
}
for (const suffix of profile.dceAssertions.forbiddenInputSuffixes) {
  if (metafileInputs.some(path => path.endsWith(suffix))) fail(`forbidden input survived: ${suffix}`);
}
for (const prefix of profile.dceAssertions.forbiddenInputPrefixes) {
  if (logicalInputs.some(path => path.startsWith(prefix))) fail(`forbidden input prefix survived: ${prefix}`);
}
if (
  JSON.stringify(receipt.dceAssertions.forbiddenInputPrefixes) !==
    JSON.stringify(profile.dceAssertions.forbiddenInputPrefixes) ||
  JSON.stringify(receipt.dceAssertions.forbiddenOutputSubstrings) !==
    JSON.stringify(profile.dceAssertions.forbiddenOutputSubstrings)
) fail("DCE prefix/output receipt drift");
for (const path of await filesUnder(join(outputRoot, "bundle"))) {
  if (!path.endsWith(".js")) continue;
  const body = await readFile(path, "utf8");
  for (const forbidden of profile.dceAssertions.forbiddenOutputSubstrings) {
    if (body.includes(forbidden)) fail(`forbidden output substring survived: ${forbidden}`);
  }
  if (body.includes(repositoryRoot)) fail(`bundle leaked repository identity: ${relative(outputRoot, path)}`);
}
for (const capability of profile.requiredCapabilities) {
  const expectedInputs = profile.capabilityInputAssertions?.[capability];
  if (!Array.isArray(expectedInputs) || expectedInputs.length === 0) {
    fail(`capability has no input assertions: ${capability}`);
  }
  for (const suffix of expectedInputs) {
    if (!metafileInputs.some(path => path.endsWith(suffix))) {
      fail(`required capability input missing for ${capability}: ${suffix}`);
    }
  }
}
for (const path of [...metafileInputs, ...Object.keys(metafile.outputs ?? {})]) {
  if (path.includes("<SOURCE_ROOT>")) continue;
  if (isAbsolute(path)) fail(`metafile leaked an absolute path: ${path}`);
  const rel = relative(repositoryRoot, resolve(repositoryRoot, path));
  if (rel.startsWith("..")) fail(`metafile path escaped repository: ${path}`);
}
const receiptText = JSON.stringify(receipt);
if (receiptText.includes(process.env.INK_AUTHORIZED_CORE_SOURCE_ROOT ?? "\u0000")) {
  fail("receipt leaked the external source root");
}
if (
  resolutionMap.schemaVersion !== "ink-core-resolution-map/v1" ||
  Object.keys(resolutionMap.exact ?? {}).length !== receipt.resolution.exactEntries ||
  Object.keys(resolutionMap.prefix ?? {}).length !== receipt.resolution.prefixEntries ||
  Object.keys(resolutionMap.virtualFacades ?? {}).length !== receipt.resolution.virtualFacadeEntries
) {
  fail("resolution-map receipt drift");
}

process.stdout.write(
  `${JSON.stringify({
    status: "verified",
    sourceDigest: receipt.sourceDigest.digest,
    inputs: metafileInputs.length,
    outputs: Object.keys(metafile.outputs ?? {}).length,
    disabledFeatures: profile.features.disabled.length,
    runtimeTarget: receipt.runtimeTarget,
  })}\n`,
);
