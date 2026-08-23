// [Input] Read the immutable Runtime-owned release manifest from the release directory.
// [Output] Return a digest-bound evidence envelope for diagnostics and the one-shot version probe.
// [Pos] Lazy diagnostic reader; the unchanged Agent SDK does not discover or parse this file.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ReleaseManifest } from "./contracts.js";

function manifestUrl(): URL {
  const override = process.env.INK_CLAUDE_RUNTIME_MANIFEST_PATH;
  if (override) {
    return pathToFileURL(resolve(override));
  }
  return new URL("../release-manifest.json", import.meta.url);
}

function validateManifest(value: unknown): asserts value is ReleaseManifest {
  if (!value || typeof value !== "object") {
    throw new Error("runtime manifest must be a JSON object");
  }
  const manifest = value as Partial<ReleaseManifest>;
  if (
    manifest.schemaVersion !== "ink-claude-cli-envelope/v1" ||
    manifest.runtime?.integration.environment !== "CLAUDE_CODE_CLI_PATH" ||
    manifest.runtime.integration.sdkOption !== "ClaudeAgentOptions.cli_path" ||
    manifest.runtime.integration.sdkModified !== false ||
    manifest.core?.delivery !== "external-not-bundled" ||
    manifest.core.loadingReduction !== 0 ||
    manifest.protocol?.name !== "claude-code-stream-json" ||
    manifest.protocol?.version !== 1 ||
    !Array.isArray(manifest.mcpVersionsRegressed) ||
    !manifest.mcpVersionsRegressed.every((value) => typeof value === "string")
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
