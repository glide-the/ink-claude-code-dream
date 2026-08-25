#!/usr/bin/env node
// [Input] Exactly five locally generated clean-room npm tgz archives and the checked package policy.
// [Output] Identity, inventory, MIT/third-party license, CycloneDX, checksum, native magic, selector, and forbidden-material evidence.
// [Pos] Immutable five-package verifier; it does not publish, execute foreign binaries, or inspect restored source.
// [Sync] 2026-08-24: verify Dream's canonical CLI, release manifest, capabilities, and digest bindings.
// [Sync] 2026-08-24: verify a deterministic dependency-complete CycloneDX SBOM in every tarball.
// [Sync] 2026-08-24: require the checked Dream receipt digest in every formal publication attestation.

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createGunzip } from "node:zlib";
import tar from "tar-stream";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const policy = JSON.parse(await readFile(path.join(repositoryRoot, "runtime", "cleanroom-npm-policy.json"), "utf8"));
const cleanroomPolicy = JSON.parse(await readFile(path.join(repositoryRoot, "runtime", "cleanroom-artifact-policy.json"), "utf8"));
const dependencyPolicy = JSON.parse(await readFile(path.join(repositoryRoot, "runtime", "cleanroom-dependency-licenses.json"), "utf8"));
const expectedLicense = await readFile(path.join(repositoryRoot, "LICENSE"));
const allowedTargets = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"];
const formalPublication = cleanroomPolicy.publicationGate?.publicationAllowed === true;
const qualificationFixture = !formalPublication &&
  process.env.INK_CLEANROOM_QUALIFICATION_FIXTURE === "provider-free-test";
const expectedProductionEligible =
  cleanroomPolicy.publicationGate?.productionEligible === true || qualificationFixture;
const expectedRedistributionAllowed =
  cleanroomPolicy.publicationGate?.redistributionAllowed === true || qualificationFixture;

function fail(message) {
  throw new Error(`[verify-cleanroom-npm] ${message}`);
}

function sha256(body) {
  return createHash("sha256").update(body).digest("hex");
}

const businessReceiptRelative = cleanroomPolicy.publicationGate?.businessAcceptance?.receiptPath;
if (
  typeof businessReceiptRelative !== "string" ||
  !businessReceiptRelative.startsWith("runtime/attestations/") ||
  path.normalize(businessReceiptRelative) !== businessReceiptRelative ||
  path.isAbsolute(businessReceiptRelative)
) {
  fail("Dream business acceptance receipt path is invalid");
}
const businessReceiptBody = await readFile(path.join(repositoryRoot, businessReceiptRelative));
const businessReceipt = JSON.parse(businessReceiptBody.toString("utf8"));
const businessReceiptSha256 = sha256(businessReceiptBody);
if (
  cleanroomPolicy.publicationGate?.businessAcceptance?.passed !== true ||
  cleanroomPolicy.publicationGate?.businessAcceptance?.receiptSha256 !== businessReceiptSha256 ||
  businessReceipt.schemaVersion !== "ink-dream-real-business-acceptance/v1" ||
  businessReceipt.subject?.runtime !== cleanroomPolicy.artifact?.name ||
  businessReceipt.subject?.version !== policy.version ||
  businessReceipt.acceptance?.status !== "passed" ||
  businessReceipt.privacy?.accountIdentifierIncluded !== false ||
  businessReceipt.privacy?.rawBusinessLogsIncluded !== false ||
  businessReceipt.privacy?.databaseRowsIncluded !== false ||
  businessReceipt.privacy?.oauthCredentialsIncluded !== false ||
  businessReceipt.privacy?.callbacksIncluded !== false ||
  businessReceipt.privacy?.transcriptsIncluded !== false ||
  businessReceipt.authorization?.explicitPublicNpmReleaseApproved !== true ||
  businessReceipt.authorization?.platformPackagesBeforeSelectorRequired !== true ||
  businessReceipt.authorization?.pypiPublicationApproved !== false
) {
  fail("Dream business acceptance receipt binding is invalid");
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, stableValue(child)]),
    );
  }
  return value;
}

function inspectBinary(body) {
  if (body.length < 20) fail("compiled executable is too small");
  if (body.subarray(0, 4).equals(Buffer.from([0xcf, 0xfa, 0xed, 0xfe]))) {
    const cpu = body.readUInt32LE(4);
    if (cpu === 0x0100000c) return "mach-o-64-arm64";
    if (cpu === 0x01000007) return "mach-o-64-x64";
  }
  if (body.subarray(0, 6).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01]))) {
    const machine = body.readUInt16LE(18);
    if (machine === 0xb7) return "elf-64-arm64";
    if (machine === 0x3e) return "elf-64-x64";
  }
  fail(`unknown executable magic: ${body.subarray(0, 20).toString("hex")}`);
}

async function defaultTarballs() {
  const root = path.join(repositoryRoot, policy.tarballRoot);
  return (await readdir(root))
    .filter(name => name.endsWith(".tgz"))
    .sort()
    .map(name => path.join(root, name));
}

async function extractTarball(tarball) {
  const files = new Map();
  const modes = new Map();
  const extract = tar.extract();
  const complete = new Promise((resolve, reject) => {
    extract.on("entry", (header, stream, next) => {
      const chunks = [];
      stream.on("data", chunk => chunks.push(chunk));
      stream.on("error", reject);
      stream.on("end", () => {
        if (header.type === "directory") return next();
        if (header.type !== "file") return reject(new Error(`non-regular tar entry is forbidden: ${header.name}`));
        if (!header.name.startsWith("package/")) return reject(new Error(`tar entry escaped package root: ${header.name}`));
        const name = header.name.slice("package/".length);
        if (!name || name.includes("..") || path.posix.isAbsolute(name) || files.has(name)) {
          return reject(new Error(`invalid or duplicate tar entry: ${header.name}`));
        }
        files.set(name, Buffer.concat(chunks));
        modes.set(name, header.mode ?? 0);
        next();
      });
      stream.resume();
    });
    extract.once("finish", resolve);
    extract.once("error", reject);
  });
  createReadStream(tarball).pipe(createGunzip()).pipe(extract);
  await complete;
  return { files, modes };
}

function validateCommon(files, expectedFiles, packageName) {
  const actual = [...files.keys()].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expectedFiles)) {
    fail(`${packageName} inventory drift: ${actual.join(", ")}`);
  }
  for (const [name, body] of files) {
    const lower = name.toLowerCase();
    if (policy.materialPolicy.forbiddenSuffixes.some(suffix => lower.endsWith(suffix))) {
      fail(`${packageName} contains forbidden suffix: ${name}`);
    }
    const segments = lower.split("/");
    if (segments.some(segment => policy.materialPolicy.forbiddenPathSegments.includes(segment))) {
      fail(`${packageName} contains forbidden path segment: ${name}`);
    }
    for (const pattern of policy.materialPolicy.forbiddenBytePatterns) {
      if (body.includes(Buffer.from(pattern))) fail(`${packageName} contains forbidden byte pattern: ${pattern}`);
    }
  }
  if (!files.get("LICENSE")?.equals(expectedLicense)) fail(`${packageName} MIT LICENSE drift`);
  const packageJson = JSON.parse(files.get("package.json").toString("utf8"));
  if (packageJson.name !== packageName || packageJson.version !== policy.version || packageJson.license !== "MIT") {
    fail(`${packageName} package identity/version/license drift`);
  }
  return packageJson;
}

function verifyChecksum(files, pathName, packageName) {
  const digest = sha256(files.get(pathName));
  const expected = `${digest}  ${pathName}\n`;
  if (files.get("SHA256SUMS")?.toString("utf8") !== expected) fail(`${packageName} SHA256SUMS drift`);
  return digest;
}

function verifyPublicationAttestation(files, packageName, entrypointSha256, target) {
  const body = files.get("npm-publication-attestation.json");
  if (!body) fail(`${packageName} is missing its publication attestation`);
  const attestation = JSON.parse(body.toString("utf8"));
  if (
    attestation.schemaVersion !== (target
      ? "ink-cleanroom-npm-platform-publication-attestation/v1"
      : "ink-cleanroom-npm-meta-publication-attestation/v1") ||
    attestation.repository !== policy.repository ||
    attestation.version !== policy.version ||
    attestation.productionEligible !== true ||
    attestation.publicationAllowed !== true ||
    attestation.redistributionAllowed !== true ||
    attestation.businessAcceptanceReceiptSha256 !== businessReceiptSha256 ||
    attestation.sourceMapsIncluded !== false ||
    attestation.entrypointSha256 !== entrypointSha256 ||
    Object.hasOwn(attestation, "fixture") ||
    (target ? attestation.runtimeTarget !== target : Object.hasOwn(attestation, "runtimeTarget"))
  ) {
    fail(`${packageName} publication attestation drift`);
  }
}

function verifyDreamManifest(files, releasePath, capabilityPath, artifactPath, executablePath, packageName) {
  const release = JSON.parse(files.get(releasePath).toString("utf8"));
  const capabilities = JSON.parse(files.get(capabilityPath).toString("utf8"));
  const artifact = JSON.parse(files.get(artifactPath).toString("utf8"));
  const executableSha256 = sha256(files.get(executablePath));
  const capabilityIds = capabilities.capabilities?.map(value => value.id).sort();
  if (
    release.schemaVersion !== "ink-claude-cli-envelope/v1" ||
    release.runtime?.name !== "ink-claude-code-dream" ||
    release.runtime?.version !== policy.version ||
    release.runtime?.entrypoint !== "bin/ink-claude-code-dream" ||
    release.runtime?.integration?.environment !== "CLAUDE_CODE_CLI_PATH" ||
    release.runtime?.integration?.sdkVersion !== "0.2.144" ||
    release.runtime?.integration?.sdkOption !== "ClaudeAgentOptions.cli_path" ||
    release.core?.corePruned !== true ||
    release.core?.productionEligible !== expectedProductionEligible ||
    release.core?.entrypointSha256 !== executableSha256 ||
    release.protocol?.name !== "claude-code-stream-json" ||
    release.protocol?.version !== 1 ||
    capabilities.runtime?.corePruned !== true ||
    capabilities.runtime?.productionEligible !== expectedProductionEligible ||
    JSON.stringify(capabilityIds) !== JSON.stringify([...cleanroomPolicy.requiredCapabilities].sort()) ||
    artifact.artifact?.entrypointSha256 !== executableSha256 ||
    artifact.artifact?.productionEligible !== expectedProductionEligible ||
    artifact.artifact?.publicationAllowed !== cleanroomPolicy.publicationGate.publicationAllowed ||
    artifact.artifact?.redistributionAllowed !== expectedRedistributionAllowed
  ) {
    fail(`${packageName} Dream release/capability/artifact binding drift`);
  }
  return executableSha256;
}

function sbomLicenseValue(choice) {
  return choice?.license?.id ?? choice?.expression;
}

function verifyDependencyEvidence(files, reportPath, sbomPath, packageName, kind, entrypointSha256, target) {
  const notices = files.get("THIRD_PARTY_NOTICES.txt");
  const reportBody = files.get(reportPath);
  const sbomBody = files.get(sbomPath);
  if (!notices || !reportBody || !sbomBody) fail(`${packageName} missing SBOM or third-party license evidence`);
  const report = JSON.parse(reportBody.toString("utf8"));
  const sbom = JSON.parse(sbomBody.toString("utf8"));
  const expected = dependencyPolicy.components.map(({ name, version, license }) => ({
    name,
    version,
    license,
  }));
  const actual = report.components?.map(({ name, version, license }) => ({ name, version, license }));
  if (
    dependencyPolicy.schemaVersion !== "ink-cleanroom-dependency-licenses/v1" ||
    report.schemaVersion !== "ink-cleanroom-bundled-dependencies/v1" ||
    report.thirdPartyNoticesSha256 !== sha256(notices) ||
    JSON.stringify(actual) !== JSON.stringify(expected) ||
    !actual.some(component =>
      component.name === "@anthropic-ai/sandbox-runtime" &&
      component.version === "0.0.73" &&
      component.license === "Apache-2.0"
    ) ||
    actual.some((component, index) =>
      typeof report.components[index]?.licenseSha256 !== "string" ||
      report.components[index].licenseSha256.length !== 64 ||
      !notices.includes(Buffer.from(`===== ${component.name}@${component.version} (${component.license}) =====`))
    )
  ) {
    fail(`${packageName} third-party dependency/license evidence drift`);
  }
  const rootRef = `pkg:npm/${packageName}@${policy.version}`;
  const sbomComponents = sbom.components?.map(component => ({
    ref: component["bom-ref"],
    name: component.name,
    version: component.version,
    license: sbomLicenseValue(component.licenses?.[0]),
    licenseTextSha256: component.properties?.find(property => property.name === "ink.license.text.sha256")?.value,
  }));
  const expectedComponents = report.components.map(component => ({
    ref: `pkg:npm/${component.name}@${component.version}`,
    name: component.name,
    version: component.version,
    license: component.license,
    licenseTextSha256: component.licenseSha256,
  }));
  const properties = Object.fromEntries(
    (sbom.metadata?.component?.properties ?? []).map(property => [property.name, property.value]),
  );
  const dependencies = sbom.dependencies ?? [];
  if (
    sbom.bomFormat !== "CycloneDX" ||
    sbom.specVersion !== "1.5" ||
    sbom.version !== 1 ||
    sbom.metadata?.component?.type !== "application" ||
    sbom.metadata?.component?.["bom-ref"] !== rootRef ||
    sbom.metadata?.component?.name !== packageName ||
    sbom.metadata?.component?.version !== policy.version ||
    sbomLicenseValue(sbom.metadata?.component?.licenses?.[0]) !== "MIT" ||
    properties["ink.runtime.kind"] !== kind ||
    properties["ink.runtime.entrypoint.sha256"] !== entrypointSha256 ||
    (target ? properties["ink.runtime.target"] !== target : "ink.runtime.target" in properties) ||
    JSON.stringify(sbomComponents) !== JSON.stringify(expectedComponents) ||
    dependencies[0]?.ref !== rootRef ||
    JSON.stringify(dependencies[0]?.dependsOn) !== JSON.stringify(expectedComponents.map(component => component.ref)) ||
    JSON.stringify(stableValue(dependencies.slice(1))) !==
      JSON.stringify(stableValue(expectedComponents.map(component => ({ ref: component.ref, dependsOn: [] }))))
  ) {
    fail(`${packageName} CycloneDX SBOM drift`);
  }
}

if (
  policy.schemaVersion !== "ink-cleanroom-npm-policy/v1" ||
  policy.license !== "MIT" ||
  policy.bunVersion !== "1.4.0" ||
  policy.materialPolicy?.sourceMapsAllowed !== false ||
  policy.publication?.npmPublishAllowed !== true ||
  cleanroomPolicy.publicationGate?.productionEligible !== true ||
  cleanroomPolicy.publicationGate?.publicationAllowed !== true ||
  cleanroomPolicy.publicationGate?.redistributionAllowed !== true ||
  Object.values(cleanroomPolicy.publicationGate?.targetHostQualification ?? {}).length !== 4 ||
  Object.values(cleanroomPolicy.publicationGate?.targetHostQualification ?? {}).some(value => value !== true) ||
  JSON.stringify(Object.keys(policy.platforms)) !== JSON.stringify(allowedTargets)
) {
  fail("checked policy identity, MIT, exact Bun, target matrix, or no-map gate drift");
}

const tarballs = process.argv.length > 2 ? process.argv.slice(2).map(value => path.resolve(value)) : await defaultTarballs();
if (tarballs.length !== 5) fail(`expected exactly five tgz archives; received ${tarballs.length}`);
const expectedNames = new Set([
  policy.metaPackage.name,
  ...allowedTargets.map(target => policy.platforms[target].package),
]);
const seen = new Set();
const reports = [];

for (const tarball of tarballs) {
  const tarballBody = await readFile(tarball);
  const { files, modes } = await extractTarball(tarball);
  const rawPackageJson = files.get("package.json");
  if (!rawPackageJson) fail(`${tarball} has no package.json`);
  const identity = JSON.parse(rawPackageJson.toString("utf8"));
  if (!expectedNames.has(identity.name)) fail(`unexpected package identity: ${identity.name}`);
  if (seen.has(identity.name)) fail(`duplicate package identity: ${identity.name}`);
  seen.add(identity.name);

  if (identity.name === policy.metaPackage.name) {
    const packageJson = validateCommon(files, policy.materialPolicy.metaFiles, identity.name);
    const manifest = JSON.parse(files.get("runtime-manifest.json").toString("utf8"));
    const optionalDependencies = Object.fromEntries(
      allowedTargets.map(target => [policy.platforms[target].package, policy.version]),
    );
    if (
      packageJson.type !== "module" ||
      packageJson.bin?.claude !== "bin/ink-claude-code-dream" ||
      packageJson.bin?.["ink-claude-code-dream"] !== "bin/ink-claude-code-dream" ||
      packageJson.scripts?.prepack !== "node scripts/prepack.mjs" ||
      JSON.stringify(stableValue(packageJson.optionalDependencies)) !== JSON.stringify(stableValue(optionalDependencies)) ||
      manifest.schemaVersion !== "ink-cleanroom-npm-meta/v1" ||
      JSON.stringify(manifest.commands) !== JSON.stringify(["claude", "ink-claude-code-dream"]) ||
      manifest.sourcemap !== "none"
    ) {
      fail("meta package selector/bin/optionalDependencies manifest drift");
    }
    const digest = verifyChecksum(files, "bin/ink-claude-code-dream", identity.name);
    verifyPublicationAttestation(files, identity.name, digest);
    verifyDreamManifest(
      files,
      "release-manifest.json",
      "manifest/capabilities.json",
      "manifest/artifact-manifest.json",
      "bin/ink-claude-code-dream",
      identity.name,
    );
    verifyDependencyEvidence(
      files,
      "manifest/dependency-licenses.json",
      "manifest/sbom.cdx.json",
      identity.name,
      "meta",
      digest,
    );
    if (manifest.launcherSha256 !== digest || manifest.selector !== "bin/ink-claude-code-dream" || (modes.get("bin/ink-claude-code-dream") & 0o111) === 0) {
      fail("meta launcher checksum or executable mode drift");
    }
    reports.push({ name: identity.name, kind: "meta", tarball: path.basename(tarball), bytes: tarballBody.byteLength, sha256: sha256(tarballBody) });
    continue;
  }

  const target = allowedTargets.find(value => policy.platforms[value].package === identity.name);
  if (!target) fail(`unknown platform package: ${identity.name}`);
  const platform = policy.platforms[target];
  const packageJson = validateCommon(files, policy.materialPolicy.platformFiles, identity.name);
  const manifest = JSON.parse(files.get("runtime-manifest.json").toString("utf8"));
  const executablePath = "runtime/bin/ink-claude-code-dream";
  const executable = files.get(executablePath);
  const digest = verifyChecksum(files, executablePath, identity.name);
  verifyPublicationAttestation(files, identity.name, digest, target);
  verifyDreamManifest(
    files,
    "runtime/release-manifest.json",
    "runtime/manifest/capabilities.json",
    "runtime/manifest/artifact-manifest.json",
    executablePath,
    identity.name,
  );
  verifyDependencyEvidence(
    files,
    "runtime/manifest/dependency-licenses.json",
    "runtime/manifest/sbom.cdx.json",
    identity.name,
    "platform",
    digest,
    target,
  );
  const format = inspectBinary(executable);
  if (
    JSON.stringify(packageJson.os) !== JSON.stringify([platform.os]) ||
    JSON.stringify(packageJson.cpu) !== JSON.stringify([platform.cpu]) ||
    manifest.schemaVersion !== "ink-cleanroom-npm-platform/v1" ||
    manifest.runtime?.target !== target ||
    manifest.runtime?.os !== platform.os ||
    manifest.runtime?.cpu !== platform.cpu ||
    manifest.runtime?.bunVersion !== "1.4.0" ||
    manifest.runtime?.bunTarget !== platform.bunTarget ||
    manifest.runtime?.binaryFormat !== platform.binaryFormat ||
    manifest.runtime?.bytes !== executable.byteLength ||
    manifest.runtime?.sha256 !== digest ||
    manifest.runtime?.executable !== executablePath ||
    manifest.runtime?.sourcemap !== "none" ||
    format !== platform.binaryFormat ||
    packageJson.scripts?.prepack !== "node scripts/prepack.mjs" ||
    (modes.get(executablePath) & 0o111) === 0
  ) {
    fail(`${target} os/cpu/manifest/checksum/magic/mode drift`);
  }
  reports.push({
    name: identity.name,
    kind: "platform",
    target,
    format,
    executableBytes: executable.byteLength,
    executableSha256: digest,
    tarball: path.basename(tarball),
    bytes: tarballBody.byteLength,
    sha256: sha256(tarballBody),
  });
}

if (seen.size !== 5 || [...expectedNames].some(name => !seen.has(name))) {
  fail(`incomplete five-package set: ${[...seen].sort().join(", ")}`);
}
reports.sort((left, right) => left.name.localeCompare(right.name));
const tarballDirectories = new Set(tarballs.map(file => path.dirname(file)));
if (tarballDirectories.size === 1) {
  const checksumRoot = [...tarballDirectories][0];
  const expectedChecksums = `${reports
    .map(item => `${item.sha256}  ${item.tarball}`)
    .sort()
    .join("\n")}\n`;
  const aggregateChecksums = await readFile(path.join(checksumRoot, "SHA256SUMS"), "utf8").catch(() => null);
  if (aggregateChecksums !== expectedChecksums) fail("five-tarball aggregate SHA256SUMS drift");
}
process.stdout.write(`${JSON.stringify({ status: "cleanroom-npm-verified", packages: reports }, null, 2)}\n`);
