#!/usr/bin/env node
// [Input] Verified dist/core-local bundle/receipt, optional digest-bound qualification receipts, local package policy, and SOURCE_DATE_EPOCH.
// [Output] Build a byte-reproducible, local-only Bun Runtime artifact with manifest, checksums, SBOM, license, and qualification evidence.
// [Pos] Fail-closed local derived-artifact packager; it never reads or copies restored source or mutable user Runtime data.
// [Sync] 2026-08-24: bind package and qualification evidence to one native darwin/linux target.

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimeRoot = path.join(repositoryRoot, "runtime");
const defaultInputRoot = path.join(repositoryRoot, "dist", "core-local");
const defaultOutputRoot = path.join(repositoryRoot, "dist", "core-package-local");
const defaultEpoch = 1_787_443_200;

function fail(message) {
  throw new Error(`[package-core-local] ${message}`);
}

function parseArguments(argv) {
  const options = {};
  const names = new Map([
    ["--input-root", "inputRoot"],
    ["--output-root", "outputRoot"],
    ["--sdk-receipt", "sdkReceipt"],
    ["--mcp-receipt", "mcpReceipt"],
    ["--full-receipt", "fullReceipt"],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const key = names.get(argv[index]);
    if (!key) fail(`unknown argument: ${argv[index]}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) fail(`${argv[index]} requires a path`);
    options[key] = path.resolve(value);
    index += 1;
  }
  return options;
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

async function readJson(file, label, maximumBytes = 2 * 1024 * 1024) {
  const info = await lstat(file).catch(() => null);
  if (!info?.isFile() || info.isSymbolicLink()) fail(`${label} must be a regular non-symlink file`);
  if (info.size > maximumBytes) fail(`${label} exceeds ${maximumBytes} bytes`);
  const body = await readFile(file);
  try {
    return { body, value: JSON.parse(body.toString("utf8")) };
  } catch {
    fail(`${label} is not valid JSON`);
  }
}

function assertDigest(value, label) {
  if (!/^[a-f0-9]{64}$/.test(value ?? "")) fail(`${label} must be a lowercase SHA-256 digest`);
}

function isWithin(parent, target) {
  const relative = path.relative(parent, target);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function assertDirectoryBoundary(directory, label) {
  const info = await lstat(directory).catch(() => null);
  if (!info?.isDirectory() || info.isSymbolicLink()) fail(`${label} must be a non-symlink directory`);
  return realpath(directory);
}

async function filesUnder(root) {
  const results = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isSymbolicLink()) fail(`symlink is forbidden in package input/output: ${absolute}`);
    if (entry.isDirectory()) results.push(...(await filesUnder(absolute)));
    else if (entry.isFile()) results.push(absolute);
    else fail(`non-regular package material is forbidden: ${absolute}`);
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

async function writeJson(file, value, mode = 0o644) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, stableJson(value), { mode });
  await chmod(file, mode);
}

function validatePolicy(policy) {
  if (policy.schemaVersion !== "ink-core-local-artifact-policy/v1") fail("unsupported local artifact policy");
  if (
    policy.artifact?.name !== "ink-claude-code-dream" ||
    policy.artifact?.version !== "0.1.5" ||
    policy.artifact?.entrypoint !== "bin/ink-claude-code-dream" ||
    policy.artifact?.coreEntrypoint !== "lib/core/cli.js" ||
    policy.artifact?.bunVersion !== "1.4.0" ||
    policy.artifact?.bunExecutableName !== "ink-claude-code-bun-1.4.0" ||
    JSON.stringify(policy.artifact?.supportedTargets) !==
      JSON.stringify(["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"])
  ) {
    fail("local artifact identity/toolchain policy drift");
  }
  if (
    policy.dreamManifestContract?.schemaVersion !== "ink-claude-cli-envelope/v1" ||
    policy.dreamManifestContract?.protocolName !== "claude-code-stream-json" ||
    policy.dreamManifestContract?.protocolVersion !== 1 ||
    policy.dreamManifestContract?.capabilityEvidence !== "manifest/capabilities.json" ||
    !Array.isArray(policy.dreamManifestContract?.requiredCapabilities) ||
    policy.dreamManifestContract.requiredCapabilities.length === 0
  ) {
    fail("Dream manifest interface contract drift");
  }
  const gateIds = policy.qualificationGates?.map(gate => gate.id);
  if (JSON.stringify(gateIds) !== JSON.stringify(["sdk", "mcp", "full"])) {
    fail("qualification gate set/order must be sdk, mcp, full");
  }
  const publicationAllowed = policy.legalGate?.publicationAllowed;
  const redistributionAllowed = policy.legalGate?.redistributionAllowed;
  if (
    typeof publicationAllowed !== "boolean" ||
    typeof redistributionAllowed !== "boolean" ||
    publicationAllowed !== redistributionAllowed ||
    policy.legalGate?.restoredSourceMayBeCommitted !== false ||
    typeof policy.legalGate?.derivedBundleMayBeCommitted !== "boolean"
  ) {
    fail("local legal/publish gate is incomplete or internally inconsistent");
  }
  if (
    publicationAllowed === true &&
    (!policy.legalGate.publicationLicense || !policy.legalGate.authorizationReference)
  ) {
    fail("authorized publication requires a checked license and authorization reference");
  }
  if (
    publicationAllowed === false &&
    (policy.legalGate.publicationLicense !== null || policy.legalGate.authorizationReference !== null)
  ) {
    fail("closed publication policy must not claim license/authorization evidence");
  }
}

function validateCoreReceipt(receipt, policy, gaps) {
  const gate = policy.coreGate;
  if (receipt.schemaVersion !== gate.receiptSchemaVersion) fail("core build receipt schema mismatch");
  if (receipt.status !== gate.requiredStatus || receipt.build?.success !== true) {
    fail("core build receipt is not built/successful");
  }
  if (receipt.builder?.version !== policy.artifact.bunVersion) fail("core Bun version drift");
  if (
    receipt.sourceVersionEvidence !== gate.sourceVersionEvidence ||
    receipt.cliCompatibilityVersion !== gate.cliCompatibilityVersion
  ) {
    fail("core source provenance or CLI compatibility version drift");
  }
  assertDigest(receipt.sourceDigest?.digest, "core source digest");
  if (!policy.artifact.supportedTargets.includes(receipt.runtimeTarget)) {
    fail("core Runtime target is unsupported");
  }
  if (
    receipt.dceAssertions?.status !== "passed" ||
    !Array.isArray(receipt.dceAssertions?.violations) ||
    receipt.dceAssertions.violations.length !== 0
  ) {
    fail("core DCE assertions did not pass");
  }
  if (
    receipt.resolution?.edgeGapCount !== 0 ||
    receipt.resolution?.uniqueGapCount !== 0 ||
    gaps.schemaVersion !== "ink-core-resolution-gaps/v1" ||
    gaps.edgeCount !== 0 ||
    gaps.uniqueGapCount !== 0 ||
    gaps.gaps?.length !== 0 ||
    gaps.uniqueGaps?.length !== 0
  ) {
    fail("core resolution is not zero-gap");
  }
  const required = [...(receipt.mcpCompatibility?.requiredTransformIds ?? [])].sort();
  const applied = [...(receipt.mcpCompatibility?.appliedTransformIds ?? [])].sort();
  if (required.length === 0 || JSON.stringify(required) !== JSON.stringify(applied)) {
    fail("required MCP compatibility transforms are not all applied");
  }
  if (!Array.isArray(receipt.requiredCapabilities) || receipt.requiredCapabilities.length === 0) {
    fail("core receipt lacks required capability evidence");
  }
}

function qualificationEnvironment(id) {
  const uppercase = id.toUpperCase();
  const preferred = process.env[`INK_CORE_${uppercase}_QUALIFICATION_RECEIPT`];
  const legacy = process.env[`INK_CORE_${uppercase}_RECEIPT`];
  if (preferred && legacy && path.resolve(preferred) !== path.resolve(legacy)) {
    fail(`conflicting ${id} qualification receipt environment paths`);
  }
  return preferred || legacy || null;
}

async function collectQualifications({ policy, arguments_, coreDigest, sourceDigest, runtimeTarget }) {
  const argumentPaths = {
    sdk: arguments_.sdkReceipt,
    mcp: arguments_.mcpReceipt,
    full: arguments_.fullReceipt,
  };
  const results = {};
  for (const gate of policy.qualificationGates) {
    const explicit = argumentPaths[gate.id] || qualificationEnvironment(gate.id);
    const receiptPath = explicit ? path.resolve(explicit) : path.resolve(repositoryRoot, gate.defaultReceipt);
    const info = await lstat(receiptPath).catch(() => null);
    if (!info) {
      if (explicit) fail(`${gate.id} qualification receipt does not exist`);
      results[gate.id] = { status: "missing", evidenceType: null, receiptSha256: null };
      continue;
    }
    let parsed;
    try {
      parsed = await readJson(receiptPath, `${gate.id} qualification receipt`);
    } catch (error) {
      if (explicit) throw error;
      results[gate.id] = { status: "missing", evidenceType: null, receiptSha256: null };
      continue;
    }
    const { body, value } = parsed;
    const binding = policy.qualificationBinding;
    if (
      value.schemaVersion !== binding.schemaVersion ||
      value.status !== binding.status ||
      !gate.evidenceTypes.includes(value.evidenceType)
    ) {
      if (explicit) fail(`${gate.id} qualification receipt schema/status/evidenceType mismatch`);
      results[gate.id] = { status: "missing", evidenceType: null, receiptSha256: null };
      continue;
    }
    if (
      value.subject?.runtime !== binding.subjectRuntime ||
      value.subject?.version !== binding.subjectVersion ||
      value.subject?.coreBundleSha256 !== coreDigest ||
      value.subject?.sourceDigest !== sourceDigest ||
      value.subject?.runtimeTarget !== runtimeTarget
    ) {
      if (explicit) fail(`${gate.id} qualification receipt is not bound to this core bundle/source`);
      results[gate.id] = { status: "missing", evidenceType: null, receiptSha256: null };
      continue;
    }
    let embeddedEvidence = {};
    if (gate.requiredEmbeddedEvidence) {
      const embedded = gate.requiredEmbeddedEvidence;
      const managementDigest = value.inputs?.[embedded.inputDigestField];
      if (
        !/^[a-f0-9]{64}$/.test(managementDigest ?? "") ||
        value.management?.evidenceType !== embedded.evidenceType ||
        value.management?.status !== "passed" ||
        value.management?.[embedded.qualifiedField] !== true
      ) {
        if (explicit) fail(`${gate.id} qualification lacks bound passing MCP management evidence`);
        results[gate.id] = { status: "missing", evidenceType: null, receiptSha256: null };
        continue;
      }
      embeddedEvidence = {
        mcpManagementIdentityQualified: true,
        mcpManagementReceiptSha256: managementDigest,
        mcpManagementEvidenceType: value.management.evidenceType,
      };
    }
    results[gate.id] = {
      status: "passed",
      evidenceType: value.evidenceType,
      receiptSha256: sha256(body),
      subject: {
        runtime: value.subject.runtime,
        version: value.subject.version,
        coreBundleSha256: value.subject.coreBundleSha256,
        sourceDigest: value.subject.sourceDigest,
        runtimeTarget: value.subject.runtimeTarget,
      },
      ...embeddedEvidence,
    };
  }
  return results;
}

function assertBundlePath(relative, policy) {
  const normalized = relative.toLowerCase();
  const segments = normalized.split("/");
  if (policy.materialPolicy.forbiddenPathSegments.some(segment => segments.includes(segment))) {
    fail(`mutable/user Runtime data path is forbidden: ${relative}`);
  }
  if (policy.materialPolicy.forbiddenBundleSuffixes.some(suffix => normalized.endsWith(suffix))) {
    fail(`source/source-map material is forbidden in the bundle: ${relative}`);
  }
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

function wrapperBody(bunVersion, bunExecutableName) {
  return `#!/bin/sh
set -eu
# Dream MCP identity capability marker; the selector remains server-owned and is passed through unchanged:
# CLAUDE_SECURESTORAGE_CONFIG_DIR
INK_ENTRYPOINT=$0
while [ -L "$INK_ENTRYPOINT" ]; do
  INK_ENTRYPOINT_DIR=$(CDPATH= cd -- "$(dirname -- "$INK_ENTRYPOINT")" && pwd)
  INK_ENTRYPOINT_TARGET=$(readlink "$INK_ENTRYPOINT")
  case "$INK_ENTRYPOINT_TARGET" in
    /*) INK_ENTRYPOINT=$INK_ENTRYPOINT_TARGET ;;
    *) INK_ENTRYPOINT=$INK_ENTRYPOINT_DIR/$INK_ENTRYPOINT_TARGET ;;
  esac
done
INK_RUNTIME_DIR=$(CDPATH= cd -- "$(dirname -- "$INK_ENTRYPOINT")/.." && pwd)
if [ -n "\${INK_CLAUDE_CODE_BUN_PATH:-}" ]; then
  INK_BUN_BIN=$INK_CLAUDE_CODE_BUN_PATH
elif command -v ${bunExecutableName} >/dev/null 2>&1; then
  INK_BUN_BIN=$(command -v ${bunExecutableName})
else
  INK_BUN_BIN=bun
fi
INK_BUN_VERSION=$("$INK_BUN_BIN" --version)
if [ "$INK_BUN_VERSION" != "${bunVersion}" ]; then
  echo "ink-claude-code-dream requires Bun ${bunVersion}; received $INK_BUN_VERSION" >&2
  exit 78
fi
exec "$INK_BUN_BIN" "$INK_RUNTIME_DIR/lib/core/cli.js" "$@"
`;
}

function deterministicUuid(digest) {
  const value = `${digest.slice(0, 12)}5${digest.slice(13, 16)}a${digest.slice(17, 32)}`;
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20, 32)}`;
}

function dependencyLicenseReport(receipt, policy) {
  const dependencyComponents = Object.entries(receipt.dependencyRoots ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, dependency]) => {
      assertDigest(dependency.treeSha256, `${name} dependency tree digest`);
      if (!dependency.version || !dependency.license) fail(`${name} dependency license evidence is incomplete`);
      return {
        name,
        version: dependency.version,
        license: dependency.license,
        scope: dependency.fallbackOnly ? "bundled-core-fallback-build-input" : "bundled-core-build-input",
        treeSha256: dependency.treeSha256,
      };
    });
  return {
    schemaVersion: "ink-core-local-license-report/v1",
    artifact: {
      name: policy.artifact.name,
      version: policy.artifact.version,
      license: policy.legalGate.publicationLicense ?? "UNLICENSED",
    },
    components: [
      {
        name: "derived Claude Runtime core",
        version: receipt.sourceVersionEvidence,
        license: "LicenseRef-Anthropic-All-Rights-Reserved",
        scope: "bundled-local-derived-core",
        redistribution: policy.legalGate.redistributionAllowed
          ? `authorized-by:${policy.legalGate.authorizationReference}`
          : "blocked-without-separate-written-authorization",
      },
      ...dependencyComponents,
      { name: "Bun", version: policy.artifact.bunVersion, license: "MIT", scope: "external-runtime" },
      {
        name: "ink-claude-dream-agent-sdk",
        version: "0.2.145",
        license: "MIT",
        scope: "external-integration-not-bundled",
      },
    ],
    legalGate: policy.legalGate,
  };
}

function cyclonedx(receipt, policy, coreDigest, licenses) {
  const components = licenses.components.map(component => ({
    type: component.scope.includes("runtime") ? "framework" : "library",
    name: component.name,
    version: String(component.version),
    "bom-ref": `pkg:generic/${encodeURIComponent(component.name)}@${encodeURIComponent(String(component.version))}`,
    licenses: [{ license: component.license.startsWith("LicenseRef-") || component.license === "UNLICENSED"
      ? { name: component.license }
      : { id: component.license } }],
    properties: [
      { name: "ink:scope", value: component.scope },
      ...(component.redistribution ? [{ name: "ink:redistribution", value: component.redistribution }] : []),
      ...(component.treeSha256 ? [{ name: "ink:treeSha256", value: component.treeSha256 }] : []),
    ],
  }));
  return {
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    serialNumber: `urn:uuid:${deterministicUuid(sha256(`${receipt.sourceDigest.digest}:${coreDigest}`))}`,
    version: 1,
    metadata: {
      component: {
        type: "application",
        name: policy.artifact.name,
        version: policy.artifact.version,
        "bom-ref": `pkg:generic/${policy.artifact.name}@${policy.artifact.version}`,
        properties: [
          { name: "ink:delivery", value: "local-derived-bun-bundle" },
          { name: "ink:publicationAllowed", value: String(policy.legalGate.publicationAllowed) },
          { name: "ink:redistributionAllowed", value: String(policy.legalGate.redistributionAllowed) },
          { name: "ink:coreBundleSha256", value: coreDigest },
          { name: "ink:sourceDigest", value: receipt.sourceDigest.digest },
        ],
      },
    },
    components,
  };
}

async function buildArtifact({ destination, inputRoot, policy, releaseTemplate, capabilityTemplate, receipt, gaps, qualifications, epoch }) {
  const bundleRoot = path.join(inputRoot, "bundle");
  await assertDirectoryBoundary(bundleRoot, "core bundle root");
  const bundleFiles = await filesUnder(bundleRoot);
  if (bundleFiles.length === 0) fail("core bundle is empty");
  const cliInput = path.join(bundleRoot, "cli.js");
  if (!bundleFiles.includes(cliInput)) fail("core bundle is missing cli.js");

  await mkdir(path.join(destination, "bin"), { recursive: true });
  await mkdir(path.join(destination, "lib", "core"), { recursive: true });
  await mkdir(path.join(destination, "manifest"), { recursive: true });
  const runtimeAssetModes = new Map(
    (receipt.runtimeAssets ?? []).map(asset => [asset.output, asset.mode]),
  );
  for (const file of bundleFiles) {
    const relative = relativePosix(bundleRoot, file);
    assertBundlePath(relative, policy);
    const body = await readFile(file);
    assertNoSensitiveContent(body, `core bundle/${relative}`);
    const target = path.join(destination, "lib", "core", ...relative.split("/"));
    if (!isWithin(path.join(destination, "lib", "core"), target)) fail("bundle path escaped package root");
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(file, target);
    await chmod(target, runtimeAssetModes.get(relative) ?? 0o644);
  }

  const coreDigest = sha256(await readFile(cliInput));
  const productionEligible = ["sdk", "mcp", "full"].every(id => qualifications[id]?.status === "passed");
  const qualificationSummary = {
    schemaVersion: "ink-core-local-qualification-summary/v1",
    subject: {
      runtime: policy.artifact.name,
      version: policy.artifact.version,
      coreBundleSha256: coreDigest,
      sourceDigest: receipt.sourceDigest.digest,
      runtimeTarget: receipt.runtimeTarget,
    },
    gates: qualifications,
    productionEligible,
    qualificationReceiptsBundled: false,
  };
  const releaseManifest = structuredClone(releaseTemplate);
  releaseManifest.core.sourceVersionEvidence = receipt.sourceVersionEvidence;
  releaseManifest.core.cliCompatibilityVersion = receipt.cliCompatibilityVersion;
  releaseManifest.core.runtimeTarget = receipt.runtimeTarget;
  releaseManifest.core.sourceDigest = receipt.sourceDigest;
  releaseManifest.core.coreBundleSha256 = coreDigest;
  releaseManifest.core.mcpCompatibility = {
    requiredTransformIds: [...receipt.mcpCompatibility.requiredTransformIds].sort(),
    appliedTransformIds: [...receipt.mcpCompatibility.appliedTransformIds].sort(),
  };
  releaseManifest.core.productionEligible = productionEligible;
  releaseManifest.status.productionEligible = productionEligible;
  releaseManifest.status.publicationAllowed = policy.legalGate.publicationAllowed;
  releaseManifest.status.redistributionAllowed = policy.legalGate.redistributionAllowed;
  releaseManifest.legalGate.publicationAllowed = policy.legalGate.publicationAllowed;
  releaseManifest.legalGate.redistributionAllowed = policy.legalGate.redistributionAllowed;
  releaseManifest.legalGate.use = policy.legalGate.publicationAllowed
    ? "publication-authorized-by-checked-policy"
    : "local-derived-evaluation-only-until-separately-authorized";
  releaseManifest.status.qualification = Object.fromEntries(
    Object.entries(qualifications).map(([id, result]) => [id, result.status]),
  );
  const capabilities = structuredClone(capabilityTemplate);
  capabilities.runtime.sourceVersionEvidence = receipt.sourceVersionEvidence;
  capabilities.runtime.cliCompatibilityVersion = receipt.cliCompatibilityVersion;
  capabilities.runtime.runtimeTarget = receipt.runtimeTarget;
  capabilities.runtime.corePruned = true;
  capabilities.runtime.productionEligible = productionEligible;
  capabilities.requiredCapabilities = capabilities.requiredCapabilities.map(capability => ({
    ...capability,
    inputs: receipt.capabilityInputAssertions?.[capability.id] ?? [],
  }));
  capabilities.capabilities = capabilities.capabilities.map(capability => {
    const inputs = receipt.capabilityInputAssertions?.[capability.buildCapability] ?? [];
    if (inputs.length === 0) {
      fail(`Dream capability has no retained build evidence: ${capability.id}`);
    }
    const managementQualified =
      qualifications.full?.mcpManagementIdentityQualified === true;
    return {
      ...capability,
      status:
        capability.id === "mcp.management.identity"
          ? managementQualified
            ? "qualified-process-contract"
            : "unqualified"
          : "retained-build-input",
      inputs,
    };
  });
  capabilities.qualification = {
    sdk: qualifications.sdk.status,
    mcp: qualifications.mcp.status,
    full: qualifications.full.status,
    productionEligible,
  };

  const wrapper = wrapperBody(
    policy.artifact.bunVersion,
    policy.artifact.bunExecutableName,
  );
  await writeFile(path.join(destination, policy.artifact.entrypoint), wrapper, { mode: 0o755 });
  await chmod(path.join(destination, policy.artifact.entrypoint), 0o755);
  await writeJson(path.join(destination, "release-manifest.json"), releaseManifest);
  await writeJson(path.join(destination, "manifest", "capabilities.json"), capabilities);
  await writeJson(path.join(destination, "manifest", "core-build-receipt.json"), receipt);
  await writeJson(path.join(destination, "manifest", "core-resolution-gaps.json"), gaps);
  await writeJson(path.join(destination, "manifest", "local-artifact-policy.json"), policy);
  await writeJson(path.join(destination, "manifest", "qualification-summary.json"), qualificationSummary);

  const licenseReport = dependencyLicenseReport(receipt, policy);
  await writeJson(path.join(destination, "manifest", "dependency-licenses.json"), licenseReport);
  await writeJson(
    path.join(destination, "manifest", "sbom.cdx.json"),
    cyclonedx(receipt, policy, coreDigest, licenseReport),
  );

  const inventoryBeforeArtifact = await treeEntries(destination);
  const artifactManifest = {
    schemaVersion: "ink-core-local-artifact-manifest/v1",
    artifact: {
      name: policy.artifact.name,
      version: policy.artifact.version,
      entrypoint: policy.artifact.entrypoint,
      coreEntrypoint: policy.artifact.coreEntrypoint,
      productionEligible,
      runtimeTarget: receipt.runtimeTarget,
      publicationAllowed: policy.legalGate.publicationAllowed,
      redistributionAllowed: policy.legalGate.redistributionAllowed,
    },
    sourceDateEpoch: epoch,
    coreBundleSha256: coreDigest,
    sourceDigest: receipt.sourceDigest.digest,
    payload: inventoryBeforeArtifact,
    payloadTreeSha256: treeDigest(inventoryBeforeArtifact),
    exclusions: releaseManifest.dataBoundary.excluded,
  };
  await writeJson(path.join(destination, "manifest", "artifact-manifest.json"), artifactManifest);

  const preReceiptEntries = await treeEntries(destination);
  const reproducibilityReceipt = {
    schemaVersion: "ink-core-local-reproducible-build/v1",
    sourceDateEpoch: epoch,
    generatedAt: new Date(epoch * 1000).toISOString(),
    algorithm: "sha256-over-sorted-mode-digest-size-path-lines",
    preReceiptTreeSha256: treeDigest(preReceiptEntries),
    passCount: 2,
    byteIdentical: true,
    inputs: {
      coreBuildReceiptSha256: sha256(Buffer.from(stableJson(receipt))),
      coreResolutionGapsSha256: sha256(Buffer.from(stableJson(gaps))),
      localArtifactPolicySha256: sha256(Buffer.from(stableJson(policy))),
      localReleaseTemplateSha256: sha256(Buffer.from(stableJson(releaseTemplate))),
      localCapabilitiesTemplateSha256: sha256(Buffer.from(stableJson(capabilityTemplate))),
    },
  };
  await writeJson(path.join(destination, "manifest", "reproducible-build.json"), reproducibilityReceipt);

  const checksumEntries = await treeEntries(destination);
  await writeFile(
    path.join(destination, "manifest", "checksums.sha256"),
    checksumEntries.map(entry => `${entry.sha256}  ${entry.path}\n`).join(""),
    { mode: 0o644 },
  );
  const timestamp = new Date(epoch * 1000);
  for (const file of await filesUnder(destination)) await utimes(file, timestamp, timestamp);
  return { productionEligible, coreDigest };
}

async function compareBuilds(left, right) {
  const leftEntries = await treeEntries(left);
  const rightEntries = await treeEntries(right);
  if (JSON.stringify(leftEntries) !== JSON.stringify(rightEntries)) {
    fail("two-pass reproducible build comparison failed");
  }
  return { files: leftEntries.length, sha256: treeDigest(leftEntries) };
}

const arguments_ = parseArguments(process.argv.slice(2));
let inputRoot = arguments_.inputRoot ?? defaultInputRoot;
let outputRoot = arguments_.outputRoot ?? defaultOutputRoot;
inputRoot = await assertDirectoryBoundary(inputRoot, "core input root");
await mkdir(outputRoot, { recursive: true });
outputRoot = await assertDirectoryBoundary(outputRoot, "package output root");
if (inputRoot === outputRoot || isWithin(inputRoot, outputRoot) || isWithin(outputRoot, inputRoot)) {
  fail("core input and package output roots must be disjoint");
}
if (!arguments_.outputRoot) {
  const ignored = spawnSync("git", ["check-ignore", "-q", "dist/core-package-local/.probe"], {
    cwd: repositoryRoot,
  });
  if (ignored.status !== 0) fail("dist/core-package-local must be ignored by Git");
}

const epoch = Number(process.env.SOURCE_DATE_EPOCH ?? defaultEpoch);
if (!Number.isSafeInteger(epoch) || epoch <= 0) fail("SOURCE_DATE_EPOCH must be a positive integer");
const [{ value: policy }, { value: releaseTemplate }, { value: capabilityTemplate }] = await Promise.all([
  readJson(path.join(runtimeRoot, "local-artifact-policy.json"), "local artifact policy"),
  readJson(path.join(runtimeRoot, "local-release-manifest.json"), "local release manifest template"),
  readJson(path.join(runtimeRoot, "local-capabilities.json"), "local capabilities template"),
]);
validatePolicy(policy);
if (
  releaseTemplate.schemaVersion !== policy.dreamManifestContract.schemaVersion ||
  releaseTemplate.capabilityEvidence !== policy.dreamManifestContract.capabilityEvidence ||
  releaseTemplate.protocol?.name !== policy.dreamManifestContract.protocolName ||
  releaseTemplate.protocol?.version !== policy.dreamManifestContract.protocolVersion ||
  capabilityTemplate.schemaVersion !== "ink-core-local-capabilities/v1"
) {
  fail("local release/capability template schema mismatch");
}
const dreamCapabilityIds = capabilityTemplate.capabilities?.map(capability => capability.id);
if (
  JSON.stringify(dreamCapabilityIds) !==
  JSON.stringify(policy.dreamManifestContract.requiredCapabilities)
) {
  fail("local capability template does not match Dream's required capability contract");
}

const [{ value: receipt }, { value: gaps }] = await Promise.all([
  readJson(path.join(inputRoot, "build-receipt.json"), "core build receipt", 8 * 1024 * 1024),
  readJson(path.join(inputRoot, "resolution-gaps.json"), "core resolution gaps"),
]);
validateCoreReceipt(receipt, policy, gaps);
const cliPath = path.join(inputRoot, "bundle", "cli.js");
const cliInfo = await lstat(cliPath).catch(() => null);
if (!cliInfo?.isFile() || cliInfo.isSymbolicLink()) fail("core bundle cli.js must be a regular file");
const coreDigest = sha256(await readFile(cliPath));
const qualifications = await collectQualifications({
  policy,
  arguments_,
  coreDigest,
  sourceDigest: receipt.sourceDigest.digest,
  runtimeTarget: receipt.runtimeTarget,
});

const artifactId = `${policy.artifact.name}-${policy.artifact.version}`;
const finalRoot = path.join(outputRoot, artifactId);
if (!isWithin(outputRoot, finalRoot) || path.basename(finalRoot) !== artifactId) fail("unsafe artifact target");
const stagingRoot = await mkdtemp(path.join(outputRoot, ".core-package-stage-"));
const firstRoot = path.join(stagingRoot, "pass-a", artifactId);
const secondRoot = path.join(stagingRoot, "pass-b", artifactId);
try {
  const first = await buildArtifact({
    destination: firstRoot,
    inputRoot,
    policy,
    releaseTemplate,
    capabilityTemplate,
    receipt,
    gaps,
    qualifications,
    epoch,
  });
  await buildArtifact({
    destination: secondRoot,
    inputRoot,
    policy,
    releaseTemplate,
    capabilityTemplate,
    receipt,
    gaps,
    qualifications,
    epoch,
  });
  const reproducible = await compareBuilds(firstRoot, secondRoot);
  await rm(finalRoot, { recursive: true, force: true });
  await rename(firstRoot, finalRoot);
  const verification = spawnSync(
    process.execPath,
    [path.join(repositoryRoot, "scripts", "verify-core-package-local.mjs"), "--package-root", finalRoot],
    { cwd: repositoryRoot, encoding: "utf8" },
  );
  if (verification.status !== 0) {
    fail(`post-package verification failed\n${verification.stdout}${verification.stderr}`);
  }
  process.stdout.write(
    `${JSON.stringify({
      status: "packaged",
      artifact: finalRoot,
      files: reproducible.files,
      artifactTreeSha256: reproducible.sha256,
      coreBundleSha256: first.coreDigest,
      productionEligible: first.productionEligible,
      publicationAllowed: policy.legalGate.publicationAllowed,
      redistributionAllowed: policy.legalGate.redistributionAllowed,
      reproduciblePasses: 2,
    })}\n`,
  );
} finally {
  await rm(stagingRoot, { recursive: true, force: true });
}
