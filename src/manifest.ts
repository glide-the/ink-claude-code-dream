// [Input] Read the immutable, release-relative Runtime manifest beside the built launcher.
// [Output] Return an exact-version, digest-bound evidence envelope for diagnostics and the one-shot version probe.
// [Pos] Lazy diagnostic reader; callers cannot replace the release trust root through environment configuration.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { ReleaseManifest } from "./contracts.js";

function manifestUrl(): URL {
  return new URL("../release-manifest.json", import.meta.url);
}

function validateManifest(value: unknown): asserts value is ReleaseManifest {
  if (!value || typeof value !== "object") {
    throw new Error("runtime manifest must be a JSON object");
  }
  const manifest = value as Partial<ReleaseManifest>;
  if (
    manifest.schemaVersion !== "ink-claude-cli-envelope/v1" ||
    manifest.runtime?.name !== "ink-runtime-envelope" ||
    manifest.runtime.version !== "0.1.0" ||
    manifest.runtime.entrypoint !== "bin/ink-claude-runtime.mjs" ||
    manifest.runtime?.integration.environment !== "CLAUDE_CODE_CLI_PATH" ||
    manifest.runtime.integration.sdkOption !== "ClaudeAgentOptions.cli_path" ||
    manifest.runtime.integration.sdkVersion !== "0.2.143" ||
    manifest.runtime.integration.sdkModified !== false ||
    manifest.core?.version !== "2.1.241" ||
    manifest.core?.delivery !== "external-not-bundled" ||
    manifest.core.execution !== "unmodified-as-published" ||
    manifest.core.loadingReduction !== 0 ||
    manifest.protocol?.name !== "claude-code-stream-json" ||
    manifest.protocol?.version !== 1 ||
    !Array.isArray(manifest.mcpVersionsRegressed) ||
    !manifest.mcpVersionsRegressed.every((value) => typeof value === "string") ||
    !Array.isArray(manifest.claudeCodeMcpChangelogVersions) ||
    manifest.claudeCodeMcpChangelogVersions.join(",") !== "2.1.239,2.1.238" ||
    manifest.legalGate?.binary !== "unmodified-as-published" ||
    manifest.legalGate.authentication !== "unaltered-opaque-pass-through" ||
    manifest.legalGate.branding !== "wrapper-is-not-Claude-Code" ||
    !manifest.contracts?.artifact ||
    !manifest.contracts.entrypointPolicy ||
    !manifest.contracts.runtimeData ||
    !manifest.contracts.bareProfile ||
    !manifest.contracts.licenses
  ) {
    throw new Error("runtime manifest is incomplete or unsupported");
  }
}

export async function readManifestEnvelope(): Promise<{
  manifest: ReleaseManifest;
  sha256: string;
}> {
  const raw = await readFile(manifestUrl());
  const parsed: unknown = JSON.parse(raw.toString("utf8"));
  validateManifest(parsed);
  return {
    manifest: parsed,
    sha256: createHash("sha256").update(raw).digest("hex"),
  };
}
