#!/usr/bin/env node
// [Input] One generated npm tgz, or the complete four-platform plus one-meta release set.
// [Output] Strict identity/manifest/checksum/legal/target validation and exact five-package inventory evidence.
// [Pos] Final immutable npm release gate; it rejects maps, legacy/user data, aliases, and incomplete release sets.

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createGunzip } from "node:zlib";
import tar from "tar-stream";

const tarballs = process.argv.slice(2).map(value => path.resolve(value));
if (tarballs.length === 0) {
  throw new Error("[verify-npm-tarball] usage: verify-npm-tarball.mjs <package.tgz> [other four release tgz files]");
}
const repositoryRoot = path.resolve(import.meta.dirname, "..");
const policyBody = await readFile(path.join(repositoryRoot, "runtime", "npm-release-policy.json"));
const policy = JSON.parse(policyBody.toString("utf8"));
const policyDigest = createHash("sha256").update(policyBody).digest("hex");
const platformsByPackage = new Map(
  Object.entries(policy.platforms).map(([target, platform]) => [platform.package, { target, ...platform }]),
);
const forbiddenSegments = new Set(policy.materialPolicy.forbiddenPathSegments);

function fail(message) {
  throw new Error(`[verify-npm-tarball] ${message}`);
}

function sha256(body) {
  return createHash("sha256").update(body).digest("hex");
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, stableValue(child)]));
  }
  return value;
}

function parseJson(files, name, label) {
  const body = files.get(`package/${name}`);
  if (!body) fail(`${label} missing ${name}`);
  try {
    return JSON.parse(body.toString("utf8"));
  } catch {
    fail(`${label} has invalid JSON: ${name}`);
  }
}

async function readTarball(absolute) {
  if (!absolute.endsWith(".tgz")) fail(`not an npm tgz: ${absolute}`);
  const archiveBody = await readFile(absolute);
  const extract = tar.extract();
  const files = new Map();
  let entryCount = 0;
  extract.on("entry", (header, stream, next) => {
    const name = header.name.replaceAll("\\", "/");
    if (!name.startsWith("package/") || name.includes("../") || path.posix.isAbsolute(name)) {
      extract.destroy(new Error(`unsafe tar path: ${name}`));
      return;
    }
    if (!["file", "directory"].includes(header.type)) {
      extract.destroy(new Error(`non-regular npm tar entry: ${name}`));
      return;
    }
    const relative = name.slice("package/".length).toLowerCase();
    if (relative.endsWith(".map")) {
      extract.destroy(new Error(`source map forbidden from npm tarball: ${name}`));
      return;
    }
    if (relative.split("/").some(segment => forbiddenSegments.has(segment))) {
      extract.destroy(new Error(`mutable/user data forbidden from npm tarball: ${name}`));
      return;
    }
    if (relative.startsWith("dist/release/")) {
      extract.destroy(new Error("legacy envelope is forbidden from npm tarball"));
      return;
    }
    const chunks = [];
    stream.on("data", chunk => chunks.push(chunk));
    stream.on("end", () => {
      entryCount += 1;
      if (header.type === "file") {
        if (files.has(name)) {
          extract.destroy(new Error(`duplicate npm tar entry: ${name}`));
          return;
        }
        files.set(name, Buffer.concat(chunks));
      }
      next();
    });
    stream.resume();
  });
  await new Promise((resolvePromise, reject) => {
    extract.on("finish", resolvePromise);
    extract.on("error", reject);
    createReadStream(absolute).pipe(createGunzip()).pipe(extract).on("error", reject);
  });
  return { absolute, archiveSha256: sha256(archiveBody), files, entryCount };
}

function assertCommon(pkg, attestation, label) {
  if (
    pkg.version !== policy.version ||
    pkg.private === true ||
    pkg.license !== policy.publish.license ||
    pkg.publishConfig?.access !== "public" ||
    pkg.publishConfig?.provenance !== true ||
    attestation.repository !== policy.repository ||
    attestation.version !== policy.version ||
    attestation.publicationAllowed !== true ||
    attestation.redistributionAllowed !== true ||
    attestation.productionEligible !== true ||
    attestation.npmReleasePolicySha256 !== policyDigest ||
    attestation.sourceMapsIncluded !== false
  ) {
    fail(`${label} common identity/legal/policy contract mismatch`);
  }
}

function verifyPlatform(parsed, pkg, attestation, platform) {
  const { target } = platform;
  assertCommon(pkg, attestation, platform.package);
  if (
    pkg.name !== platform.package ||
    JSON.stringify(pkg.os) !== JSON.stringify([platform.os]) ||
    JSON.stringify(pkg.cpu) !== JSON.stringify([platform.cpu]) ||
    JSON.stringify(pkg.dependencies) !== JSON.stringify({ [policy.bun.package]: policy.bun.version }) ||
    pkg.scripts?.prepack !== "node scripts/prepack.mjs" ||
    pkg.inkRuntime?.target !== target ||
    pkg.inkRuntime?.bunVersion !== policy.bun.version ||
    pkg.inkRuntime?.ripgrepPath !== `runtime/${platform.ripgrepPath}` ||
    pkg.inkRuntime?.ripgrepSha256 !== platform.ripgrepSha256 ||
    pkg.inkRuntime?.sourceMapsIncluded !== false ||
    attestation.schemaVersion !== "ink-npm-platform-publication-attestation/v1" ||
    attestation.runtimeTarget !== target
  ) {
    fail(`${platform.package} platform package contract mismatch`);
  }
  const release = parseJson(parsed.files, "runtime/release-manifest.json", platform.package);
  const artifact = parseJson(parsed.files, "runtime/manifest/artifact-manifest.json", platform.package);
  const core = parseJson(parsed.files, "runtime/manifest/core-build-receipt.json", platform.package);
  const qualificationBody = parsed.files.get("package/runtime/manifest/qualification-summary.json");
  if (!qualificationBody) fail(`${platform.package} missing qualification summary`);
  const ripgrep = parsed.files.get(`package/runtime/${platform.ripgrepPath}`);
  if (!ripgrep) fail(`${platform.package} missing target ripgrep`);
  if (
    release.core?.runtimeTarget !== target ||
    artifact.artifact?.runtimeTarget !== target ||
    core.runtimeTarget !== target ||
    release.status?.productionEligible !== true ||
    artifact.artifact?.productionEligible !== true ||
    release.status?.publicationAllowed !== true ||
    release.status?.redistributionAllowed !== true ||
    artifact.artifact?.publicationAllowed !== true ||
    artifact.artifact?.redistributionAllowed !== true ||
    attestation.coreBundleSha256 !== artifact.coreBundleSha256 ||
    attestation.payloadTreeSha256 !== artifact.payloadTreeSha256 ||
    attestation.qualificationSummarySha256 !== sha256(qualificationBody) ||
    sha256(ripgrep) !== platform.ripgrepSha256
  ) {
    fail(`${platform.package} Runtime manifest/ripgrep/qualification binding mismatch`);
  }
  for (const other of platformsByPackage.values()) {
    if (other.target === target) continue;
    if (parsed.files.has(`package/runtime/${other.ripgrepPath}`)) {
      fail(`${platform.package} contains cross-platform ripgrep: ${other.target}`);
    }
  }
  return {
    kind: "platform",
    package: pkg.name,
    version: pkg.version,
    target,
    tarballSha256: parsed.archiveSha256,
    qualificationSummarySha256: attestation.qualificationSummarySha256,
    coreBundleSha256: attestation.coreBundleSha256,
    payloadTreeSha256: attestation.payloadTreeSha256,
    entries: parsed.entryCount,
  };
}

function verifyMeta(parsed, pkg, attestation) {
  assertCommon(pkg, attestation, policy.metaPackage);
  const optionalDependencies = Object.fromEntries(
    Object.values(policy.platforms).map(platform => [platform.package, policy.version]),
  );
  if (
    pkg.name !== policy.metaPackage ||
    JSON.stringify(pkg.optionalDependencies) !== JSON.stringify(optionalDependencies) ||
    Object.hasOwn(pkg, "dependencies") ||
    pkg.bin?.[policy.command] !== `bin/${policy.command}` ||
    pkg.scripts?.prepack !== "node scripts/prepack.mjs" ||
    attestation.schemaVersion !== "ink-npm-meta-publication-attestation/v1" ||
    Object.hasOwn(attestation, "runtimeTarget") ||
    !Array.isArray(attestation.platforms) ||
    attestation.platforms.length !== 4
  ) {
    fail("meta package selector/attestation contract mismatch");
  }
  return {
    kind: "meta",
    package: pkg.name,
    version: pkg.version,
    tarballSha256: parsed.archiveSha256,
    platforms: attestation.platforms,
    entries: parsed.entryCount,
  };
}

async function verifyOne(absolute) {
  const parsed = await readTarball(absolute);
  const pkg = parseJson(parsed.files, "package.json", absolute);
  const attestation = parseJson(parsed.files, "npm-publication-attestation.json", pkg.name ?? absolute);
  if (pkg.name === policy.metaPackage) return verifyMeta(parsed, pkg, attestation);
  const platform = platformsByPackage.get(pkg.name);
  if (!platform) fail(`unexpected npm package name: ${pkg.name}`);
  return verifyPlatform(parsed, pkg, attestation, platform);
}

const summaries = [];
for (const tarball of tarballs) summaries.push(await verifyOne(tarball));
if (summaries.length !== 1) {
  if (summaries.length !== 5) fail(`complete release set must contain exactly 5 tgz files; received ${summaries.length}`);
  const byPackage = new Map(summaries.map(summary => [summary.package, summary]));
  const expectedNames = [policy.metaPackage, ...Object.values(policy.platforms).map(platform => platform.package)];
  if (
    byPackage.size !== 5 ||
    expectedNames.some(name => !byPackage.has(name)) ||
    summaries.some(summary => summary.version !== policy.version)
  ) {
    fail("release set package names/version are not exactly the checked five-package inventory");
  }
  const meta = byPackage.get(policy.metaPackage);
  const expectedBindings = Object.entries(policy.platforms).map(([target, platform]) => {
    const summary = byPackage.get(platform.package);
    return {
      target,
      package: platform.package,
      version: policy.version,
      tarballSha256: summary.tarballSha256,
      qualificationSummarySha256: summary.qualificationSummarySha256,
      coreBundleSha256: summary.coreBundleSha256,
      payloadTreeSha256: summary.payloadTreeSha256,
    };
  });
  if (JSON.stringify(stableValue(meta.platforms)) !== JSON.stringify(stableValue(expectedBindings))) {
    fail("meta attestation is not bound to the exact four platform tarballs/qualifications");
  }
  process.stdout.write(`${JSON.stringify({ status: "npm-release-set-verified", version: policy.version, packages: expectedNames, sourceMaps: 0 })}\n`);
} else {
  process.stdout.write(`${JSON.stringify({ status: "tarball-verified", ...summaries[0], sourceMaps: 0 })}\n`);
}
