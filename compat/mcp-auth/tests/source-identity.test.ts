// [Input] Isolated source fixtures, path/symlink attacks, compatibility definitions, and artifact receipts.
// [Output] Assertions for source-root identity and receipt-only applied status derivation.
// [Pos] Bun security-contract tests for the MCP compatibility source and artifact gates.

import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { McpCompatibilityTransformDefinition } from "../src/patch-spec.ts";
import {
  getMcpCompatibilityTransformsForArtifact,
  MCP_COMPATIBILITY_TRANSFORMS,
} from "../src/patch-spec.ts";
import {
  type McpCompatibilityArtifactReceipt,
  resolveEffectivePatchApplication,
  verifyAuthorizedSourceTargets,
} from "../src/source-identity.ts";

const cleanupRoots: string[] = [];

afterEach(async () => {
  for (const root of cleanupRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

async function sourceFixture(source = "export const anchor = true;\n") {
  const created = await mkdtemp(join(tmpdir(), "ink-mcp-auth-source-"));
  const root = await realpath(created);
  cleanupRoots.push(root);
  await mkdir(join(root, "src"));
  await writeFile(join(root, "src", "target.ts"), source);
  const sha256 = createHash("sha256").update(source).digest("hex");
  const transform: McpCompatibilityTransformDefinition = {
    id: "fixture-v1",
    targetPath: "src/target.ts",
    sourceSha256: sha256,
    strategy: "assert-existing-contract",
    boundarySymbol: "anchor",
    helperExports: [],
    sourceAssertions: [{
      id: "fixture-anchor",
      contains: "export const anchor = true;",
      occurrenceCount: 1,
    }],
    postconditions: ["fixture"],
    artifactReachability: "headless",
    mutatesSource: false,
  };
  return { root, transform };
}

describe("authorized source identity", () => {
  test("accepts an exact real root, contained regular file, hash, and assertion", async () => {
    const { root, transform } = await sourceFixture();
    await expect(verifyAuthorizedSourceTargets(root, [transform])).resolves.toEqual([{
      path: "src/target.ts",
      sha256: transform.sourceSha256,
      bytes: 28,
    }]);
  });

  test("rejects a symlink root and a symlink in the target path", async () => {
    const { root, transform } = await sourceFixture();
    const linkRoot = `${root}-link`;
    cleanupRoots.push(linkRoot);
    await symlink(root, linkRoot);
    await expect(verifyAuthorizedSourceTargets(linkRoot, [transform])).rejects.toThrow("not a symlink");

    const other = await mkdtemp(join(tmpdir(), "ink-mcp-auth-other-"));
    cleanupRoots.push(other);
    await writeFile(join(other, "target.ts"), "export const anchor = true;\n");
    await rm(join(root, "src"), { recursive: true });
    await symlink(other, join(root, "src"));
    await expect(verifyAuthorizedSourceTargets(root, [transform])).rejects.toThrow("contains symlink");
  });

  test("rejects traversal, hash drift, and assertion drift", async () => {
    const { root, transform } = await sourceFixture();
    await expect(verifyAuthorizedSourceTargets(root, [{
      ...transform,
      targetPath: "../target.ts",
    }])).rejects.toThrow("portable and relative");
    await expect(verifyAuthorizedSourceTargets(root, [{
      ...transform,
      sourceSha256: "0".repeat(64),
    }])).rejects.toThrow("sha256 mismatch");
    await expect(verifyAuthorizedSourceTargets(root, [{
      ...transform,
      sourceAssertions: [{ id: "missing", contains: "not present", occurrenceCount: 1 }],
    }])).rejects.toThrow("expected 1 exact occurrence");
  });
});

describe("artifact receipt application state", () => {
  const manifest = {
    sourceTarget: {
      commit: "a8a678cb6244e6770e1e421767ff0987a1d95549",
      packageVersion: "2.1.88",
    },
    integration: {
      wired: true as const,
      applied: false as const,
      status: "wired-build-required" as const,
    },
  };
  const manifestSha256 = "a".repeat(64);

  function completeReceipt(
    artifactKind: "headless" | "interactive-full" = "interactive-full",
  ): McpCompatibilityArtifactReceipt {
    const expected = getMcpCompatibilityTransformsForArtifact(artifactKind);
    return {
      schemaVersion: "ink-mcp-auth-compat-artifact/v1",
      artifactKind,
      manifestSha256,
      sourceCommit: manifest.sourceTarget.commit,
      sourcePackageVersion: manifest.sourceTarget.packageVersion,
      transforms: expected.map(transform => ({
        id: transform.id,
        targetPath: transform.targetPath,
        sourceSha256: transform.sourceSha256,
        sourceAssertionsPassed: true,
        applied: true,
      })),
    };
  }

  test("manifest alone remains unapplied", () => {
    expect(resolveEffectivePatchApplication(
      manifest,
      manifestSha256,
      MCP_COMPATIBILITY_TRANSFORMS,
    )).toEqual(manifest.integration);
  });

  test("only a complete digest-bound receipt derives applied=true", () => {
    expect(resolveEffectivePatchApplication(
      manifest,
      manifestSha256,
      MCP_COMPATIBILITY_TRANSFORMS,
      completeReceipt(),
    )).toEqual({
      wired: true,
      applied: true,
      status: "applied-by-artifact-receipt",
      artifactKind: "interactive-full",
      appliedTransformIds: MCP_COMPATIBILITY_TRANSFORMS.map(transform => transform.id),
    });

    const incomplete = completeReceipt();
    incomplete.transforms.pop();
    expect(() => resolveEffectivePatchApplication(
      manifest,
      manifestSha256,
      MCP_COMPATIBILITY_TRANSFORMS,
      incomplete,
    )).toThrow("cover every reachable compatibility transform");

    const wrongManifest = completeReceipt();
    wrongManifest.manifestSha256 = "b".repeat(64);
    expect(() => resolveEffectivePatchApplication(
      manifest,
      manifestSha256,
      MCP_COMPATIBILITY_TRANSFORMS,
      wrongManifest,
    )).toThrow("manifest sha256 mismatch");
  });

  test("headless receipts cover only headers/client/print and reject interactive claims", () => {
    const receipt = completeReceipt("headless");
    expect(new Set(receipt.transforms.map(transform => transform.targetPath))).toEqual(new Set([
      "src/services/mcp/headersHelper.ts",
      "src/services/mcp/client.ts",
      "src/cli/print.ts",
    ]));
    expect(receipt.transforms.some(transform =>
      transform.id === "managed-reconnect-backoff-v1" ||
      transform.id === "mcp-list-get-disabled-guard-v1"
    )).toBe(false);

    expect(resolveEffectivePatchApplication(
      manifest,
      manifestSha256,
      MCP_COMPATIBILITY_TRANSFORMS,
      receipt,
    )).toMatchObject({
      applied: true,
      artifactKind: "headless",
      appliedTransformIds: receipt.transforms.map(transform => transform.id),
    });

    const falseClaim = completeReceipt("headless");
    const interactive = MCP_COMPATIBILITY_TRANSFORMS.find(
      transform => transform.artifactReachability === "interactive-only",
    )!;
    falseClaim.transforms.push({
      id: interactive.id,
      targetPath: interactive.targetPath,
      sourceSha256: interactive.sourceSha256,
      sourceAssertionsPassed: true,
      applied: true,
    });
    expect(() => resolveEffectivePatchApplication(
      manifest,
      manifestSha256,
      MCP_COMPATIBILITY_TRANSFORMS,
      falseClaim,
    )).toThrow("reachable compatibility transform");
  });
});
