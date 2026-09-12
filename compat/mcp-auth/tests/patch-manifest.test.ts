// [Input] Compatibility manifest, local transform definitions/helpers, and optionally authorized restored source.
// [Output] Assertions for exact integration state, source hashes/assertions, transform wiring, and official evidence.
// [Pos] Fail-closed Bun contract test for the clean-room MCP compatibility patch specification.

import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  MCP_COMPATIBILITY_TRANSFORMS,
  MCP_COMPATIBILITY_VIRTUAL_MODULE_IDS,
} from "../src/patch-spec.ts";
import { verifyAuthorizedSourceTargets } from "../src/source-identity.ts";

interface ManifestSourceAssertion {
  id: string;
  contains: string;
  occurrenceCount: number;
}

interface ManifestTarget {
  path: string;
  sha256: string;
  sourceAssertions: ManifestSourceAssertion[];
}

interface ManifestTransform {
  id: string;
  targetPath: string;
  sourceSha256: string;
  strategy: string;
  boundarySymbol: string;
  helperExports: string[];
  sourceAssertionIds: string[];
  artifactReachability: string;
  mutatesSource: boolean;
}

interface PatchManifest {
  schemaVersion: string;
  integration: { wired: boolean; applied: boolean; status: string };
  artifactReceipt: {
    schemaVersion: string;
    requiredForApplied: boolean;
    derivedAppliedStatus: string;
    artifactKinds: Record<string, unknown>;
  };
  virtualModuleIds: Record<string, string>;
  sourceTarget: {
    implementationRoot: string;
    implementationSource: string;
    commit: string;
    packageVersion: string;
    classification: string;
    files: ManifestTarget[];
  };
  transforms: ManifestTransform[];
  officialEvidence: Array<{ version: string; url: string; section: string }>;
}

const moduleRoot = resolve(import.meta.dir, "..");
const manifestText = await readFile(resolve(moduleRoot, "patch-manifest.json"), "utf8");
const manifest = JSON.parse(manifestText) as PatchManifest;
const authorizedSourceRoot = resolve(moduleRoot, "../..");
const externalEvidenceTest = test;

describe("patch manifest", () => {
  test("is wired but can only be applied by a build artifact receipt", () => {
    expect(manifest.schemaVersion).toBe("ink-mcp-auth-compat-patch/v2");
    expect(manifest.integration).toEqual(expect.objectContaining({
      wired: true,
      applied: false,
      status: "wired-build-required",
    }));
    expect(manifest.artifactReceipt).toEqual(expect.objectContaining({
      schemaVersion: "ink-mcp-auth-compat-artifact/v1",
      requiredForApplied: true,
      derivedAppliedStatus: "applied-by-artifact-receipt",
    }));
    expect(manifest.virtualModuleIds).toEqual(MCP_COMPATIBILITY_VIRTUAL_MODULE_IDS);
    expect(manifestText).not.toMatch(/"applied"\s*:\s*true/);
    expect(manifest.sourceTarget.classification).toBe("canonical-original-module-target");
  });

  test("binds the reviewed restored source commit and package version", () => {
    expect(manifest.sourceTarget.commit).toBe("a8a678cb6244e6770e1e421767ff0987a1d95549");
    expect(manifest.sourceTarget.packageVersion).toBe("2.1.88");
    expect(manifest.sourceTarget.implementationRoot).toBe("src");
    expect(manifest.sourceTarget.implementationSource).toBe("repository");
  });

  test("declares an exact headless reachability boundary", () => {
    expect(manifest.artifactReceipt.artifactKinds).toEqual({
      headless: {
        reachableTargetPaths: [
          "src/services/mcp/headersHelper.ts",
          "src/services/mcp/client.ts",
          "src/cli/print.ts",
        ],
        forbiddenTransformReachability: "interactive-only",
      },
      "interactive-full": {
        includesAllTransforms: true,
      },
    });
  });

  test("matches every local hash-bound transform and exact source assertion", async () => {
    expect(manifest.transforms).toHaveLength(MCP_COMPATIBILITY_TRANSFORMS.length);
    const manifestTargets = new Map(manifest.sourceTarget.files.map(target => [target.path, target]));
    const manifestTransforms = new Map(manifest.transforms.map(transform => [transform.id, transform]));
    expect(manifestTransforms.size).toBe(manifest.transforms.length);
    expect([...manifestTargets.keys()].sort()).toEqual(
      [...new Set(MCP_COMPATIBILITY_TRANSFORMS.map(transform => transform.targetPath))].sort(),
    );

    const helperFiles = [
      "src/headers-helper-policy.ts",
      "src/reconnect-policy.ts",
      "src/redaction.ts",
    ];
    const helperSources = await Promise.all(
      helperFiles.map(path => readFile(resolve(moduleRoot, path), "utf8")),
    );

    for (const definition of MCP_COMPATIBILITY_TRANSFORMS) {
      const target = manifestTargets.get(definition.targetPath);
      const transform = manifestTransforms.get(definition.id);
      expect(target, definition.targetPath).toBeDefined();
      expect(transform, definition.id).toBeDefined();
      expect(target!.sha256).toBe(definition.sourceSha256);
      expect(definition.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(transform).toEqual(expect.objectContaining({
        id: definition.id,
        targetPath: definition.targetPath,
        sourceSha256: definition.sourceSha256,
        strategy: definition.strategy,
        boundarySymbol: definition.boundarySymbol,
        helperExports: [...definition.helperExports],
        sourceAssertionIds: definition.sourceAssertions.map(assertion => assertion.id),
        artifactReachability: definition.artifactReachability,
        mutatesSource: definition.mutatesSource,
      }));

      const targetAssertions = new Map(target!.sourceAssertions.map(assertion => [assertion.id, assertion]));
      for (const assertion of definition.sourceAssertions) {
        expect(targetAssertions.get(assertion.id), assertion.id).toEqual(assertion);
      }
      for (const helperExport of definition.helperExports) {
        const exportPattern = new RegExp(`export\\s+(?:async\\s+)?function\\s+${helperExport}\\b`);
        expect(
          helperSources.some(source => exportPattern.test(source)),
          helperExport,
        ).toBe(true);
      }
    }
  });

  externalEvidenceTest(
    "verifies authorized source realpath, containment, no-symlink identity, sha256, and assertions",
    async () => {
      const verified = await verifyAuthorizedSourceTargets(
        authorizedSourceRoot!,
        MCP_COMPATIBILITY_TRANSFORMS,
      );
      expect(verified.map(target => target.path)).toEqual(
        manifest.sourceTarget.files.map(target => target.path).sort(),
      );
      expect(verified.every(target => target.bytes > 0)).toBe(true);
    },
  );

  test("records immutable official 2.1.238 and 2.1.239 evidence", () => {
    expect(manifest.officialEvidence.map(({ version }) => version)).toEqual([
      "2.1.238",
      "2.1.239",
    ]);
    for (const evidence of manifest.officialEvidence) {
      expect(evidence.url).toStartWith("https://raw.githubusercontent.com/anthropics/claude-code/v2.1.239/");
      expect(evidence.section).toBe(`## ${evidence.version}`);
    }
  });
});
