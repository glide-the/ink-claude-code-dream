// [Input] Headless transformer result IDs and emitted bundle/source reachability evidence.
// [Output] Assertions that applied=true is emitted only for a complete reachable headless patch set.
// [Pos] Bun contract tests for the builder-facing MCP compatibility artifact receipt helper.

import { describe, expect, test } from "bun:test";

import { buildHeadlessMcpCompatibilityArtifactReceipt } from "../src/artifact-receipt.ts";
import {
  getMcpCompatibilityTransformsForArtifact,
  MCP_COMPATIBILITY_TRANSFORMS,
} from "../src/patch-spec.ts";
import { resolveEffectivePatchApplication } from "../src/source-identity.ts";

const manifestSha256 = "a".repeat(64);
const sourceCommit = "reviewed-commit";
const sourcePackageVersion = "2.1.88";
const headless = getMcpCompatibilityTransformsForArtifact("headless");
const requiredPaths = [...new Set(headless.map(transform => transform.targetPath))];
const transformerResults = requiredPaths.map(targetPath => ({
  targetPath,
  appliedIds: headless
    .filter(transform => transform.targetPath === targetPath)
    .map(transform => transform.id),
}));

describe("headless artifact receipt builder", () => {
  test("returns applied=true for complete transformed and reachable headless sources", () => {
    const built = buildHeadlessMcpCompatibilityArtifactReceipt({
      manifestSha256,
      sourceCommit,
      sourcePackageVersion,
      transformerResults,
      reachableSourcePaths: requiredPaths,
    });

    expect(built).toMatchObject({
      wired: true,
      applied: true,
      status: "applied-by-artifact-receipt",
      receipt: { artifactKind: "headless" },
    });
    expect(built.receipt.transforms.map(transform => transform.id)).toEqual(
      headless.map(transform => transform.id),
    );
    expect(resolveEffectivePatchApplication({
      integration: { wired: true, applied: false, status: "wired-build-required" },
      sourceTarget: { commit: sourceCommit, packageVersion: sourcePackageVersion },
    }, manifestSha256, MCP_COMPATIBILITY_TRANSFORMS, built.receipt)).toMatchObject({
      applied: true,
      artifactKind: "headless",
    });
  });

  test("accepts only output-level metafile inputs with emitted bytes", () => {
    const sourceRoot = "/reviewed/restored-src";
    const built = buildHeadlessMcpCompatibilityArtifactReceipt({
      manifestSha256,
      sourceCommit,
      sourcePackageVersion,
      transformerResults,
      sourceRoot,
      bundleMetafile: {
        outputs: {
          "dist/headless.js": {
            inputs: Object.fromEntries(requiredPaths.map(path => [
              `${sourceRoot}/${path}`,
              { bytesInOutput: 1 },
            ])),
          },
        },
      },
    });
    expect(built.applied).toBe(true);

    expect(() => buildHeadlessMcpCompatibilityArtifactReceipt({
      manifestSha256,
      sourceCommit,
      sourcePackageVersion,
      transformerResults,
      bundleMetafile: {
        outputs: {
          "dist/headless.js": {
            inputs: Object.fromEntries(requiredPaths.map((path, index) => [
              path,
              { bytesInOutput: index === 0 ? 0 : 1 },
            ])),
          },
        },
      },
    })).toThrow("bundle metafile outputs is missing required headless source");
  });

  test("rejects missing transforms or unreachable required source classes", () => {
    expect(() => buildHeadlessMcpCompatibilityArtifactReceipt({
      manifestSha256,
      sourceCommit,
      sourcePackageVersion,
      transformerResults: transformerResults.map((result, index) => index === 0
        ? { ...result, appliedIds: result.appliedIds.slice(1) }
        : result),
      reachableSourcePaths: requiredPaths,
    })).toThrow("headless artifact is missing applied transform");

    expect(() => buildHeadlessMcpCompatibilityArtifactReceipt({
      manifestSha256,
      sourceCommit,
      sourcePackageVersion,
      transformerResults,
      reachableSourcePaths: requiredPaths.slice(1),
    })).toThrow("reachable source paths is missing required headless source");
  });

  test("rejects interactive-only transform claims in a headless artifact", () => {
    const interactive = MCP_COMPATIBILITY_TRANSFORMS.find(
      transform => transform.artifactReachability === "interactive-only",
    )!;
    expect(() => buildHeadlessMcpCompatibilityArtifactReceipt({
      manifestSha256,
      sourceCommit,
      sourcePackageVersion,
      transformerResults: [
        ...transformerResults,
        { targetPath: interactive.targetPath, appliedIds: [interactive.id] },
      ],
      reachableSourcePaths: [...requiredPaths, interactive.targetPath],
    })).toThrow("headless artifact cannot claim interactive-only transform");
  });
});
