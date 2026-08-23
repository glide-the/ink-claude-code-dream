// [Input] Consume the generated immutable release directory, inventory, Runtime manifest, and material policy.
// [Output] Fail closed on checksum/contract/target drift, unsafe content, missing maps, or a bundled Claude core.
// [Pos] Post-build executable acceptance gate; it validates no SDK-specific manifest protocol.

import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access, readFile, readdir, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

const releaseRoot = resolve("dist/release/ink-claude-runtime-0.1.0");
const checksumPath = join(releaseRoot, "manifest", "checksums.sha256");
const checksumLines = (await readFile(checksumPath, "utf8")).trim().split("\n");
const checksummedPaths = new Set();
for (const line of checksumLines) {
  const match = line.match(/^([a-f0-9]{64})  (.+)$/);
  if (!match) throw new Error(`invalid checksum line: ${line}`);
  checksummedPaths.add(match[2]);
  const body = await readFile(join(releaseRoot, match[2]));
  const actual = createHash("sha256").update(body).digest("hex");
  if (actual !== match[1]) throw new Error(`checksum mismatch: ${match[2]}`);
}

const releaseManifestPath = join(releaseRoot, "release-manifest.json");
if (!checksummedPaths.has("release-manifest.json")) {
  throw new Error("release-manifest.json is not in the checksum inventory");
}
const buildReceipt = JSON.parse(
  await readFile(join(releaseRoot, "manifest", "build.json"), "utf8"),
);
if (
  buildReceipt.packageManager !== "bun@1.2.20" ||
  buildReceipt.archivePackerNode !== "24.13.0" ||
  buildReceipt.deterministicArchivePacker !== "tar-stream@3.1.7 plus node:zlib"
) {
  throw new Error("release build toolchain receipt mismatch");
}
const manifest = JSON.parse(await readFile(releaseManifestPath, "utf8"));
if (
  manifest.schemaVersion !== "ink-claude-cli-envelope/v1" ||
  manifest.runtime?.version !== "0.1.0" ||
  manifest.runtime?.integration?.environment !== "CLAUDE_CODE_CLI_PATH" ||
  manifest.runtime?.integration?.sdkOption !== "ClaudeAgentOptions.cli_path" ||
  manifest.runtime?.integration?.sdkVersion !== "0.2.143" ||
  manifest.runtime?.integration?.dreamObservedSdkVersion !== "0.2.140" ||
  manifest.runtime?.integration?.sdkModified !== false ||
  manifest.core?.version !== "2.1.241" ||
  manifest.core?.delivery !== "external-not-bundled" ||
  manifest.core?.execution !== "unmodified-as-published" ||
  manifest.core?.loadingReduction !== 0 ||
  manifest.protocol?.name !== "claude-code-stream-json" ||
  manifest.protocol?.version !== 1
) {
  throw new Error("Runtime-owned release manifest contract mismatch");
}
if (
  manifest.legalGate?.binary !== "unmodified-as-published" ||
  manifest.legalGate?.authentication !== "unaltered-opaque-pass-through" ||
  manifest.legalGate?.branding !== "wrapper-is-not-Claude-Code"
) {
  throw new Error("legal gate contract mismatch");
}
if (isAbsolute(manifest.runtime.entrypoint)) {
  throw new Error("release entrypoint must be relative to its immutable release");
}
const rootReal = await realpath(releaseRoot);
const target = resolve(releaseRoot, manifest.runtime.entrypoint);
const targetReal = await realpath(target);
const targetRelative = relative(rootReal, targetReal);
if (!targetRelative || targetRelative.startsWith("..") || isAbsolute(targetRelative)) {
  throw new Error("release entrypoint escapes or aliases the release root");
}
if (!(await stat(targetReal)).isFile()) throw new Error("release entrypoint is not a file");
await access(targetReal, fsConstants.X_OK);
if (!checksummedPaths.has(manifest.runtime.entrypoint)) {
  throw new Error("release entrypoint is not in the checksum inventory");
}

const discovery = JSON.parse(
  await readFile(join(releaseRoot, "manifest", "discovery.json"), "utf8"),
);
if (
  discovery.executable !== manifest.runtime.entrypoint ||
  discovery.releaseManifest !== "release-manifest.json" ||
  discovery.sdk?.option !== "ClaudeAgentOptions.cli_path" ||
  discovery.sdk?.discoveryEnvironment !== "CLAUDE_CODE_CLI_PATH" ||
  discovery.sdk?.modified !== false ||
  discovery.sdk?.version !== "0.2.143" ||
  discovery.sdk?.dreamObservedVersion !== "0.2.140"
) {
  throw new Error("release discovery does not match the unchanged cli_path contract");
}

const contractSchemas = {
  "artifact-manifest.json": "ink-external-artifact/v1",
  "entrypoint-policy.json": "ink-entrypoint-policy/v1",
  "runtime-data-contract.json": "ink-runtime-data/v1",
  "bare-profile.json": "ink-claude-bare-profile/v1",
  "dependency-licenses.json": "ink-license-report/v1",
};
for (const [name, schemaVersion] of Object.entries(contractSchemas)) {
  const expectedPath = `manifest/${name}`;
  if (!manifest.contracts || !Object.values(manifest.contracts).includes(expectedPath)) {
    throw new Error(`release manifest does not reference ${expectedPath}`);
  }
  const contract = JSON.parse(await readFile(join(releaseRoot, expectedPath), "utf8"));
  if (contract.schemaVersion !== schemaVersion) {
    throw new Error(`contract schema mismatch: ${name}`);
  }
}
const artifactContract = JSON.parse(
  await readFile(join(releaseRoot, "manifest", "artifact-manifest.json"), "utf8"),
);
if (
  artifactContract.artifact?.version !== "2.1.241" ||
  artifactContract.artifact?.bundled !== false ||
  artifactContract.artifact?.patched !== false ||
  artifactContract.artifact?.renamed !== false ||
  artifactContract.artifact?.execution !== "unmodified-as-published"
) {
  throw new Error("external artifact legal/provenance contract mismatch");
}
const entrypointPolicy = JSON.parse(
  await readFile(join(releaseRoot, "manifest", "entrypoint-policy.json"), "utf8"),
);
if (
  entrypointPolicy.child?.mustBeUnmodified !== true ||
  entrypointPolicy.child?.authenticationPolicy !==
    "preserve-all-built-in-methods-and-auth-environment" ||
  entrypointPolicy.bare?.automaticInjection !== false
) {
  throw new Error("entrypoint/legal/bare policy mismatch");
}
const licenseReport = JSON.parse(
  await readFile(join(releaseRoot, "manifest", "dependency-licenses.json"), "utf8"),
);
if (
  licenseReport.legalGate?.officialBinaryMustBeUnmodified !== true ||
  licenseReport.legalGate?.builtInAuthenticationMustRemainAvailable !== true ||
  licenseReport.legalGate?.vendorOrRestoredSourceMayBeCommitted !== false
) {
  throw new Error("license report legal gate mismatch");
}

async function filesUnder(root) {
  const results = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const absolute = join(root, entry.name);
    if (entry.isDirectory()) results.push(...(await filesUnder(absolute)));
    else if (entry.isFile()) results.push(absolute);
  }
  return results;
}

const files = await filesUnder(releaseRoot);
const forbiddenPaths = [
  "/projects/",
  "/workspace/",
  "/plugins/",
  "/oauth/",
  "/settings/",
  "/credentials/",
  "/secrets/",
];
const forbiddenContent = [
  /sk-ant-[A-Za-z0-9_-]+/,
  /ANTHROPIC_(?:API_KEY|AUTH_TOKEN)\s*=/,
  /"(?:access_token|refresh_token|client_secret)"\s*:/,
  /\.claude\/projects\//,
  new RegExp(`claude-agent-${"runtime"}/v1`),
  new RegExp(`CLAUDE_AGENT_SDK_${"RUNTIME_MANIFEST"}`),
  new RegExp(`ClaudeAgentOptions\\.${"runtime_manifest"}`),
];
for (const path of files) {
  const normalized = path.replaceAll("\\", "/").toLowerCase();
  if (forbiddenPaths.some((fragment) => normalized.includes(fragment))) {
    throw new Error(`excluded material path found: ${path}`);
  }
  const info = await stat(path);
  if (info.size > 10 * 1024 * 1024) {
    throw new Error(`unexpected large file (possible bundled core): ${path}`);
  }
  const body = await readFile(path, "utf8");
  if (forbiddenContent.some((pattern) => pattern.test(body))) {
    throw new Error(`excluded/obsolete material content found: ${path}`);
  }
}
if (!files.some((path) => path.endsWith(".mjs.map"))) {
  throw new Error("release is missing external source maps");
}
const sbom = JSON.parse(await readFile(join(releaseRoot, "manifest", "sbom.cdx.json"), "utf8"));
if (sbom.bomFormat !== "CycloneDX") throw new Error("CycloneDX SBOM is missing");
const core = sbom.components.find((item) => item.name === "@anthropic-ai/claude-code");
if (!core?.properties?.some((item) => item.name === "ink:delivery" && item.value === "external-not-bundled")) {
  throw new Error("SBOM does not identify the official core as external");
}
if (core.version !== "2.1.241") throw new Error("SBOM external core version mismatch");
process.stdout.write(
  `${JSON.stringify({
    ok: true,
    files: files.length,
    checksums: checksumLines.length,
    releaseManifest: "release-manifest.json",
    target: manifest.runtime.entrypoint,
    sdkModified: false,
    integration: "CLAUDE_CODE_CLI_PATH",
    coreBundled: false,
  })}\n`,
);
