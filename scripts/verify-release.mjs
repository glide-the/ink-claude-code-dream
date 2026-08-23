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
const manifest = JSON.parse(await readFile(releaseManifestPath, "utf8"));
if (
  manifest.schemaVersion !== "ink-claude-cli-envelope/v1" ||
  manifest.runtime?.version !== "0.1.0" ||
  manifest.runtime?.integration?.environment !== "CLAUDE_CODE_CLI_PATH" ||
  manifest.runtime?.integration?.sdkOption !== "ClaudeAgentOptions.cli_path" ||
  manifest.runtime?.integration?.sdkVersion !== "0.2.140" ||
  manifest.runtime?.integration?.sdkModified !== false ||
  manifest.core?.version !== "2.1.235" ||
  manifest.core?.delivery !== "external-not-bundled" ||
  manifest.core?.loadingReduction !== 0 ||
  manifest.protocol?.name !== "claude-code-stream-json" ||
  manifest.protocol?.version !== 1
) {
  throw new Error("Runtime-owned release manifest contract mismatch");
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
  discovery.sdk?.modified !== false
) {
  throw new Error("release discovery does not match the unchanged cli_path contract");
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
