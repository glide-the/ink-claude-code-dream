// src/manifest.ts
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
function manifestUrl() {
  const override = process.env.INK_CLAUDE_RUNTIME_MANIFEST_PATH;
  if (override) {
    return pathToFileURL(resolve(override));
  }
  return new URL("../release-manifest.json", import.meta.url);
}
function validateManifest(value) {
  if (!value || typeof value !== "object") {
    throw new Error("runtime manifest must be a JSON object");
  }
  const manifest = value;
  if (manifest.schemaVersion !== "ink-claude-cli-envelope/v1" || manifest.runtime?.integration.environment !== "CLAUDE_CODE_CLI_PATH" || manifest.runtime.integration.sdkOption !== "ClaudeAgentOptions.cli_path" || manifest.runtime.integration.sdkVersion !== "0.2.143" || manifest.runtime.integration.sdkModified !== false || manifest.core?.delivery !== "external-not-bundled" || manifest.core.execution !== "unmodified-as-published" || manifest.core.loadingReduction !== 0 || manifest.protocol?.name !== "claude-code-stream-json" || manifest.protocol?.version !== 1 || !Array.isArray(manifest.mcpVersionsRegressed) || !manifest.mcpVersionsRegressed.every((value2) => typeof value2 === "string") || !Array.isArray(manifest.claudeCodeMcpChangelogVersions) || manifest.claudeCodeMcpChangelogVersions.join(",") !== "2.1.240,2.1.238" || manifest.legalGate?.binary !== "unmodified-as-published" || manifest.legalGate.authentication !== "unaltered-opaque-pass-through" || manifest.legalGate.branding !== "wrapper-is-not-Claude-Code" || !manifest.contracts?.artifact || !manifest.contracts.entrypointPolicy || !manifest.contracts.runtimeData || !manifest.contracts.bareProfile || !manifest.contracts.licenses) {
    throw new Error("runtime manifest is incomplete or unsupported");
  }
}
async function readManifestEnvelope() {
  const raw = await readFile(manifestUrl());
  const parsed = JSON.parse(raw.toString("utf8"));
  validateManifest(parsed);
  return {
    manifest: parsed,
    sha256: createHash("sha256").update(raw).digest("hex")
  };
}
export {
  readManifestEnvelope
};
