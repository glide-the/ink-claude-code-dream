#!/usr/bin/env node
// [Input] A packaged local derived Runtime artifact plus checked-in local artifact/template contracts.
// [Output] Fail closed on checksum, provenance, qualification, reproducibility, SBOM/license, executable, or mutable-data boundary drift.
// [Pos] Read-only verifier for dist/core-package-local; it never reads restored source or executes the candidate core.
// [Sync] 2026-08-24: require native target identity across core, qualifications, manifests, and assets.

import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access, lstat, readFile, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultPackageRoot = path.join(
  repositoryRoot,
  "dist",
  "core-package-local",
  "ink-claude-code-dream-0.1.1",
);

function fail(message) {
  throw new Error(`[verify-core-package-local] ${message}`);
}

function packageArgument(argv) {
  if (argv.length === 0) return defaultPackageRoot;
  if (argv.length !== 2 || argv[0] !== "--package-root" || !argv[1]) {
    fail("usage: verify-core-package-local.mjs [--package-root <absolute-or-relative-path>]");
  }
  return path.resolve(argv[1]);
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

function stableJson(value) {
  return `${JSON.stringify(stableValue(value), null, 2)}\n`;
}

function sha256(body) {
  return createHash("sha256").update(body).digest("hex");
}

async function readJson(file, label) {
  const info = await lstat(file).catch(() => null);
  if (!info?.isFile() || info.isSymbolicLink()) fail(`${label} must be a regular non-symlink file`);
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    fail(`${label} is not valid JSON`);
  }
}

async function filesUnder(root) {
  const results = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isSymbolicLink()) fail(`symlink is forbidden: ${absolute}`);
    if (entry.isDirectory()) results.push(...(await filesUnder(absolute)));
    else if (entry.isFile()) results.push(absolute);
    else fail(`non-regular artifact material is forbidden: ${absolute}`);
  }
  return results;
}

function relativePosix(root, file) {
  return path.relative(root, file).split(path.sep).join("/");
}

async function treeEntries(root, excluded = new Set()) {
  const entries = [];
  for (const file of await filesUnder(root)) {
    const relative = relativePosix(root, file);
    if (excluded.has(relative)) continue;
    const info = await stat(file);
    const body = await readFile(file);
    entries.push({
      path: relative,
      sha256: sha256(body),
      bytes: body.length,
      mode: info.mode & 0o111 ? "0755" : "0644",
    });
  }
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

function treeDigest(entries) {
  return sha256(
    entries.map(entry => `${entry.mode} ${entry.sha256} ${entry.bytes} ${entry.path}\n`).join(""),
  );
}

function assertDigest(value, label) {
  if (!/^[a-f0-9]{64}$/.test(value ?? "")) fail(`${label} is not a SHA-256 digest`);
}

function assertNoSensitiveContent(body, label) {
  const text = body.toString("utf8");
  const patterns = [
    /sk-ant-[A-Za-z0-9_-]{20,}/,
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /ANTHROPIC_(?:API_KEY|AUTH_TOKEN)\s*=\s*[^\s"']+/,
    /claude-code-sourcemap[\\/]restored-src/,
    /\/Users\/dmeck\//,
  ];
  if (patterns.some(pattern => pattern.test(text))) fail(`sensitive/source-root material found in ${label}`);
}

let packageRoot = packageArgument(process.argv.slice(2));
const rootInfo = await lstat(packageRoot).catch(() => null);
if (!rootInfo?.isDirectory() || rootInfo.isSymbolicLink()) fail("package root must be a non-symlink directory");
packageRoot = await realpath(packageRoot);

const paths = {
  release: path.join(packageRoot, "release-manifest.json"),
  policy: path.join(packageRoot, "manifest", "local-artifact-policy.json"),
  capabilities: path.join(packageRoot, "manifest", "capabilities.json"),
  core: path.join(packageRoot, "manifest", "core-build-receipt.json"),
  gaps: path.join(packageRoot, "manifest", "core-resolution-gaps.json"),
  qualifications: path.join(packageRoot, "manifest", "qualification-summary.json"),
  artifact: path.join(packageRoot, "manifest", "artifact-manifest.json"),
  reproducibility: path.join(packageRoot, "manifest", "reproducible-build.json"),
  sbom: path.join(packageRoot, "manifest", "sbom.cdx.json"),
  licenses: path.join(packageRoot, "manifest", "dependency-licenses.json"),
  checksums: path.join(packageRoot, "manifest", "checksums.sha256"),
};
const [
  release,
  policy,
  capabilities,
  core,
  gaps,
  qualifications,
  artifact,
  reproducibility,
  sbom,
  licenses,
] = await Promise.all([
  readJson(paths.release, "release manifest"),
  readJson(paths.policy, "local artifact policy"),
  readJson(paths.capabilities, "capabilities"),
  readJson(paths.core, "core build receipt"),
  readJson(paths.gaps, "core resolution gaps"),
  readJson(paths.qualifications, "qualification summary"),
  readJson(paths.artifact, "artifact manifest"),
  readJson(paths.reproducibility, "reproducibility receipt"),
  readJson(paths.sbom, "CycloneDX SBOM"),
  readJson(paths.licenses, "dependency license report"),
]);

const checkedInPolicy = await readJson(
  path.join(repositoryRoot, "runtime", "local-artifact-policy.json"),
  "checked-in local artifact policy",
);
if (stableJson(policy) !== stableJson(checkedInPolicy)) fail("embedded local artifact policy drift");
if (
  policy.schemaVersion !== "ink-core-local-artifact-policy/v1" ||
  typeof policy.legalGate?.publicationAllowed !== "boolean" ||
  typeof policy.legalGate?.redistributionAllowed !== "boolean" ||
  policy.legalGate.publicationAllowed !== policy.legalGate.redistributionAllowed
) {
  fail("local artifact policy/legal gate mismatch");
}
const publicationAllowed = policy.legalGate.publicationAllowed;
const redistributionAllowed = policy.legalGate.redistributionAllowed;
if (
  publicationAllowed &&
  (!policy.legalGate.publicationLicense || !policy.legalGate.authorizationReference)
) {
  fail("authorized artifact policy lacks checked license/authorization evidence");
}
if (
  !publicationAllowed &&
  (policy.legalGate.publicationLicense !== null || policy.legalGate.authorizationReference !== null)
) {
  fail("closed artifact policy claims license/authorization evidence");
}

if (
  core.schemaVersion !== policy.coreGate.receiptSchemaVersion ||
  core.status !== "built" ||
  core.build?.success !== true ||
  core.builder?.version !== policy.artifact.bunVersion ||
  core.dceAssertions?.status !== "passed" ||
  core.dceAssertions?.violations?.length !== 0 ||
  core.resolution?.edgeGapCount !== 0 ||
  core.resolution?.uniqueGapCount !== 0
) {
  fail("core build/DCE/resolution gate is not passed");
}
if (
  gaps.schemaVersion !== "ink-core-resolution-gaps/v1" ||
  gaps.edgeCount !== 0 ||
  gaps.uniqueGapCount !== 0 ||
  gaps.gaps?.length !== 0 ||
  gaps.uniqueGaps?.length !== 0
) {
  fail("packaged resolution gaps are not empty");
}
assertDigest(core.sourceDigest?.digest, "core source digest");
if (!policy.artifact?.supportedTargets?.includes(core.runtimeTarget)) {
  fail("core Runtime target is unsupported");
}
const requiredTransforms = [...(core.mcpCompatibility?.requiredTransformIds ?? [])].sort();
const appliedTransforms = [...(core.mcpCompatibility?.appliedTransformIds ?? [])].sort();
if (requiredTransforms.length === 0 || JSON.stringify(requiredTransforms) !== JSON.stringify(appliedTransforms)) {
  fail("packaged MCP compatibility transforms are incomplete");
}

const coreEntrypoint = path.join(packageRoot, policy.artifact.coreEntrypoint);
const coreEntrypointInfo = await lstat(coreEntrypoint).catch(() => null);
if (!coreEntrypointInfo?.isFile() || coreEntrypointInfo.isSymbolicLink()) fail("core entrypoint is missing");
const coreDigest = sha256(await readFile(coreEntrypoint));
assertDigest(coreDigest, "core bundle digest");
const subject = qualifications.subject;
if (
  qualifications.schemaVersion !== "ink-core-local-qualification-summary/v1" ||
  subject?.runtime !== policy.artifact.name ||
  subject?.version !== policy.artifact.version ||
  subject?.coreBundleSha256 !== coreDigest ||
  subject?.sourceDigest !== core.sourceDigest.digest ||
  subject?.runtimeTarget !== core.runtimeTarget ||
  qualifications.qualificationReceiptsBundled !== false
) {
  fail("qualification subject/bundling contract mismatch");
}
const expectedGateIds = policy.qualificationGates.map(gate => gate.id);
if (
  JSON.stringify(Object.keys(qualifications.gates).sort()) !==
  JSON.stringify([...expectedGateIds].sort())
) {
  fail("qualification summary gate set/order mismatch");
}
for (const gate of policy.qualificationGates) {
  const evidence = qualifications.gates[gate.id];
  if (!evidence || !["missing", "passed"].includes(evidence.status)) {
    fail(`invalid ${gate.id} qualification status`);
  }
  if (evidence.status === "passed") {
    if (!gate.evidenceTypes.includes(evidence.evidenceType)) fail(`${gate.id} evidence type is not accepted`);
    assertDigest(evidence.receiptSha256, `${gate.id} receipt digest`);
    if (
      evidence.subject?.runtime !== subject.runtime ||
      evidence.subject?.version !== subject.version ||
      evidence.subject?.coreBundleSha256 !== subject.coreBundleSha256 ||
      evidence.subject?.sourceDigest !== subject.sourceDigest
      || evidence.subject?.runtimeTarget !== subject.runtimeTarget
    ) {
      fail(`${gate.id} qualification subject drift`);
    }
    if (gate.requiredEmbeddedEvidence) {
      if (
        evidence.mcpManagementIdentityQualified !== true ||
        evidence.mcpManagementEvidenceType !==
          gate.requiredEmbeddedEvidence.evidenceType ||
        !/^[a-f0-9]{64}$/.test(evidence.mcpManagementReceiptSha256 ?? "")
      ) {
        fail(`${gate.id} qualification lost MCP management evidence`);
      }
    }
  } else if (evidence.evidenceType !== null || evidence.receiptSha256 !== null) {
    fail(`${gate.id} missing qualification must not carry evidence`);
  }
}
const allQualificationsPassed = expectedGateIds.every(id => qualifications.gates[id].status === "passed");
if (qualifications.productionEligible !== allQualificationsPassed) {
  fail("productionEligible is not the conjunction of SDK/MCP/full qualifications");
}

if (
  release.schemaVersion !== policy.dreamManifestContract.schemaVersion ||
  release.runtime?.name !== policy.artifact.name ||
  release.runtime?.version !== policy.artifact.version ||
  release.runtime?.entrypoint !== policy.artifact.entrypoint ||
  release.runtime?.toolchain?.name !== "Bun" ||
  release.runtime?.toolchain?.version !== policy.artifact.bunVersion ||
  release.runtime?.toolchain?.delivery !== "separate-local-install" ||
  release.runtime?.toolchain?.executable !== policy.artifact.bunExecutableName ||
  release.runtime?.toolchain?.overrideEnvironment !== "INK_CLAUDE_CODE_BUN_PATH" ||
  release.runtime?.integration?.environment !== "CLAUDE_CODE_CLI_PATH" ||
  release.runtime?.integration?.sdkOption !== "ClaudeAgentOptions.cli_path" ||
  release.runtime?.integration?.sdkDistribution !== "ink-claude-dream-agent-sdk" ||
  release.runtime?.integration?.sdkVersion !== "0.2.144" ||
  release.runtime?.integration?.sdkModified !== false ||
  release.core?.entrypoint !== policy.artifact.coreEntrypoint ||
  release.core?.corePruned !== true ||
  release.core?.productionEligible !== allQualificationsPassed ||
  release.core?.coreBundleSha256 !== coreDigest ||
  release.core?.sourceDigest?.digest !== core.sourceDigest.digest ||
  release.core?.runtimeTarget !== core.runtimeTarget ||
  release.status?.productionEligible !== allQualificationsPassed ||
  release.capabilityEvidence !== policy.dreamManifestContract.capabilityEvidence ||
  release.protocol?.name !== policy.dreamManifestContract.protocolName ||
  release.protocol?.version !== policy.dreamManifestContract.protocolVersion ||
  release.status?.publicationAllowed !== publicationAllowed ||
  release.status?.redistributionAllowed !== redistributionAllowed ||
  release.legalGate?.publicationAllowed !== publicationAllowed ||
  release.legalGate?.redistributionAllowed !== redistributionAllowed ||
  release.legalGate?.restoredSourceIncluded !== false
) {
  fail("release identity/integration/legal/qualification contract mismatch");
}
if (
  JSON.stringify(release.core.mcpCompatibility?.requiredTransformIds) !== JSON.stringify(requiredTransforms) ||
  JSON.stringify(release.core.mcpCompatibility?.appliedTransformIds) !== JSON.stringify(appliedTransforms)
) {
  fail("release MCP compatibility receipt drift");
}

const capabilityIds = capabilities.requiredCapabilities?.map(capability => capability.id) ?? [];
const dreamCapabilityIds = capabilities.capabilities?.map(capability => capability.id) ?? [];
if (
  capabilities.schemaVersion !== "ink-core-local-capabilities/v1" ||
  capabilities.runtime?.name !== policy.artifact.name ||
  capabilities.runtime?.version !== policy.artifact.version ||
  capabilities.runtime?.corePruned !== true ||
  capabilities.runtime?.productionEligible !== allQualificationsPassed ||
  capabilities.runtime?.runtimeTarget !== core.runtimeTarget ||
  JSON.stringify(capabilityIds) !== JSON.stringify(core.requiredCapabilities) ||
  JSON.stringify(dreamCapabilityIds) !==
    JSON.stringify(policy.dreamManifestContract.requiredCapabilities) ||
  capabilities.qualification?.productionEligible !== allQualificationsPassed ||
  expectedGateIds.some(id => capabilities.qualification?.[id] !== qualifications.gates[id].status)
) {
  fail("capability evidence drift");
}
for (const capability of capabilities.requiredCapabilities) {
  if (
    !Array.isArray(capability.inputs) ||
    capability.inputs.length === 0 ||
    JSON.stringify(capability.inputs) !== JSON.stringify(core.capabilityInputAssertions?.[capability.id])
  ) {
    fail(`capability input evidence mismatch: ${capability.id}`);
  }
}
for (const capability of capabilities.capabilities) {
  const expectedStatus =
    capability.id === "mcp.management.identity"
      ? qualifications.gates.full?.mcpManagementIdentityQualified === true
        ? "qualified-process-contract"
        : "unqualified"
      : "retained-build-input";
  if (capability.status !== expectedStatus) {
    fail(`Dream capability qualification status mismatch: ${capability.id}`);
  }
  if (!core.requiredCapabilities.includes(capability.buildCapability)) {
    fail(`Dream capability build root mismatch: ${capability.id}`);
  }
  if (!Array.isArray(capability.inputs) || capability.inputs.length === 0) {
    fail(`Dream capability has no packaged input evidence: ${capability.id}`);
  }
  if (
    JSON.stringify(capability.inputs) !==
    JSON.stringify(core.capabilityInputAssertions?.[capability.buildCapability])
  ) {
    fail(`Dream capability packaged input evidence mismatch: ${capability.id}`);
  }
}

if (
  artifact.schemaVersion !== "ink-core-local-artifact-manifest/v1" ||
  artifact.artifact?.name !== policy.artifact.name ||
  artifact.artifact?.version !== policy.artifact.version ||
  artifact.artifact?.productionEligible !== allQualificationsPassed ||
  artifact.artifact?.publicationAllowed !== publicationAllowed ||
  artifact.artifact?.redistributionAllowed !== redistributionAllowed ||
  artifact.coreBundleSha256 !== coreDigest ||
  artifact.sourceDigest !== core.sourceDigest.digest
  || artifact.artifact?.runtimeTarget !== core.runtimeTarget
) {
  fail("artifact manifest contract mismatch");
}
const currentPayload = await treeEntries(
  packageRoot,
  new Set([
    "manifest/artifact-manifest.json",
    "manifest/reproducible-build.json",
    "manifest/checksums.sha256",
  ]),
);
if (
  stableJson(artifact.payload) !== stableJson(currentPayload) ||
  artifact.payloadTreeSha256 !== treeDigest(currentPayload)
) {
  fail("artifact payload inventory mismatch");
}

if (
  reproducibility.schemaVersion !== "ink-core-local-reproducible-build/v1" ||
  reproducibility.passCount !== 2 ||
  reproducibility.byteIdentical !== true ||
  !Number.isSafeInteger(reproducibility.sourceDateEpoch) ||
  reproducibility.sourceDateEpoch <= 0 ||
  reproducibility.generatedAt !== new Date(reproducibility.sourceDateEpoch * 1000).toISOString()
) {
  fail("reproducibility receipt contract mismatch");
}
const preReceiptEntries = await treeEntries(
  packageRoot,
  new Set(["manifest/reproducible-build.json", "manifest/checksums.sha256"]),
);
if (reproducibility.preReceiptTreeSha256 !== treeDigest(preReceiptEntries)) {
  fail("reproducibility pre-receipt tree digest mismatch");
}
const [releaseTemplate, capabilityTemplate] = await Promise.all([
  readJson(path.join(repositoryRoot, "runtime", "local-release-manifest.json"), "release template"),
  readJson(path.join(repositoryRoot, "runtime", "local-capabilities.json"), "capability template"),
]);
const expectedInputDigests = {
  coreBuildReceiptSha256: sha256(Buffer.from(stableJson(core))),
  coreResolutionGapsSha256: sha256(Buffer.from(stableJson(gaps))),
  localArtifactPolicySha256: sha256(Buffer.from(stableJson(policy))),
  localReleaseTemplateSha256: sha256(Buffer.from(stableJson(releaseTemplate))),
  localCapabilitiesTemplateSha256: sha256(Buffer.from(stableJson(capabilityTemplate))),
};
if (stableJson(reproducibility.inputs) !== stableJson(expectedInputDigests)) {
  fail("reproducibility input digests drift");
}

const checksumBody = await readFile(paths.checksums, "utf8");
const checksumLines = checksumBody.trim().split("\n");
const checksumMap = new Map();
for (const line of checksumLines) {
  const match = line.match(/^([a-f0-9]{64})  ([^\0]+)$/);
  if (!match || checksumMap.has(match[2]) || match[2] === "manifest/checksums.sha256") {
    fail(`invalid checksum inventory line: ${line}`);
  }
  checksumMap.set(match[2], match[1]);
}
const expectedChecksumEntries = await treeEntries(packageRoot, new Set(["manifest/checksums.sha256"]));
if (
  JSON.stringify([...checksumMap.keys()]) !== JSON.stringify(expectedChecksumEntries.map(entry => entry.path))
) {
  fail("checksum inventory does not exactly cover artifact files");
}
for (const entry of expectedChecksumEntries) {
  if (checksumMap.get(entry.path) !== entry.sha256) fail(`checksum mismatch: ${entry.path}`);
}

if (
  sbom.bomFormat !== "CycloneDX" ||
  sbom.specVersion !== "1.6" ||
  sbom.metadata?.component?.name !== policy.artifact.name ||
  sbom.metadata?.component?.version !== policy.artifact.version
) {
  fail("CycloneDX SBOM identity mismatch");
}
const sbomProperties = Object.fromEntries(
  (sbom.metadata.component.properties ?? []).map(property => [property.name, property.value]),
);
if (
  sbomProperties["ink:delivery"] !== "local-derived-bun-bundle" ||
  sbomProperties["ink:publicationAllowed"] !== String(publicationAllowed) ||
  sbomProperties["ink:redistributionAllowed"] !== String(redistributionAllowed) ||
  sbomProperties["ink:coreBundleSha256"] !== coreDigest ||
  sbomProperties["ink:sourceDigest"] !== core.sourceDigest.digest
) {
  fail("SBOM provenance/legal properties mismatch");
}
if (
  licenses.schemaVersion !== "ink-core-local-license-report/v1" ||
  licenses.legalGate?.publicationAllowed !== publicationAllowed ||
  licenses.legalGate?.redistributionAllowed !== redistributionAllowed ||
  !licenses.components?.some(
    component =>
      component.name === "derived Claude Runtime core" &&
      component.license === "LicenseRef-Anthropic-All-Rights-Reserved" &&
      component.redistribution === (redistributionAllowed
        ? `authorized-by:${policy.legalGate.authorizationReference}`
        : "blocked-without-separate-written-authorization"),
  )
) {
  fail("dependency license/local redistribution gate mismatch");
}
for (const [name, dependency] of Object.entries(core.dependencyRoots ?? {})) {
  const component = licenses.components.find(candidate => candidate.name === name);
  if (
    component?.version !== dependency.version ||
    component?.license !== dependency.license ||
    component?.treeSha256 !== dependency.treeSha256
  ) {
    fail(`dependency license evidence drift: ${name}`);
  }
}

const allFiles = await filesUnder(packageRoot);
const expectedRootEntries = new Set(["bin", "lib", "manifest", "release-manifest.json"]);
for (const entry of await readdir(packageRoot)) {
  if (!expectedRootEntries.has(entry)) fail(`unexpected package root entry: ${entry}`);
}
const forbiddenSegments = new Set(policy.materialPolicy.forbiddenPathSegments);
for (const file of allFiles) {
  const relative = relativePosix(packageRoot, file);
  const lower = relative.toLowerCase();
  if (lower.split("/").some(segment => forbiddenSegments.has(segment))) {
    fail(`mutable/user Runtime data path found: ${relative}`);
  }
  if (
    relative.startsWith("lib/core/") &&
    policy.materialPolicy.forbiddenBundleSuffixes.some(suffix => lower.endsWith(suffix))
  ) {
    fail(`restored source/source-map file found: ${relative}`);
  }
  const info = await stat(file);
  if (info.size > 512 * 1024 * 1024) fail(`unexpected oversized artifact file: ${relative}`);
  assertNoSensitiveContent(await readFile(file), relative);
}
if (
  allFiles.some(file => /(?:qualification|differential).*receipt/i.test(path.basename(file))) ||
  policy.materialPolicy.qualificationReceiptsBundled !== false ||
  policy.materialPolicy.restoredSourceBundled !== false ||
  policy.materialPolicy.userRuntimeDataBundled !== false
) {
  fail("raw qualification/source/user Runtime data must not be bundled");
}

const wrapper = path.join(packageRoot, policy.artifact.entrypoint);
await access(wrapper, fsConstants.X_OK).catch(() => fail("Bun entry wrapper is not executable"));
const wrapperText = await readFile(wrapper, "utf8");
if (
  !wrapperText.startsWith("#!/bin/sh\nset -eu\n") ||
  !wrapperText.includes("CLAUDE_SECURESTORAGE_CONFIG_DIR") ||
  !wrapperText.includes('while [ -L "$INK_ENTRYPOINT" ]') ||
  !wrapperText.includes('INK_ENTRYPOINT_TARGET=$(readlink "$INK_ENTRYPOINT")') ||
  !wrapperText.includes('$(dirname -- "$INK_ENTRYPOINT")/..') ||
  !wrapperText.includes('if [ -n "${INK_CLAUDE_CODE_BUN_PATH:-}" ]') ||
  !wrapperText.includes(`command -v ${policy.artifact.bunExecutableName}`) ||
  !wrapperText.includes("INK_BUN_BIN=bun") ||
  !wrapperText.includes(`requires Bun ${policy.artifact.bunVersion}`) ||
  !wrapperText.includes('exec "$INK_BUN_BIN" "$INK_RUNTIME_DIR/lib/core/cli.js" "$@"')
) {
  fail("Bun entry wrapper contract mismatch");
}

process.stdout.write(
  `${JSON.stringify({
    status: "verified",
    artifact: packageRoot,
    files: allFiles.length,
    checksums: checksumMap.size,
    coreBundleSha256: coreDigest,
    productionEligible: allQualificationsPassed,
    publicationAllowed,
    redistributionAllowed,
    reproduciblePasses: reproducibility.passCount,
  })}\n`,
);
