// [Input] Explicit authorized source root, exact target hashes/assertions, manifest digest, and optional build receipt.
// [Output] Verified source identities and an applied status derived only from a complete artifact receipt.
// [Pos] Filesystem identity and artifact-evidence gate for MCP compatibility transforms; it never mutates source.

import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import {
  assertSourceAssertions,
  getMcpCompatibilityTransformsForArtifact,
  type McpCompatibilityTransformDefinition,
} from "./patch-spec.ts";

export interface VerifiedSourceTarget {
  path: string;
  sha256: string;
  bytes: number;
}

export interface McpCompatibilityArtifactReceipt {
  schemaVersion: "ink-mcp-auth-compat-artifact/v1";
  artifactKind: "headless" | "interactive-full";
  manifestSha256: string;
  sourceCommit: string;
  sourcePackageVersion: string;
  transforms: Array<{
    id: string;
    targetPath: string;
    sourceSha256: string;
    sourceAssertionsPassed: true;
    applied: true;
  }>;
}

export interface PatchManifestIdentity {
  sourceTarget: { commit: string; packageVersion: string };
  integration: { wired: true; applied: false; status: "wired-build-required" };
}

export type EffectivePatchApplication =
  | { wired: true; applied: false; status: "wired-build-required" }
  | {
      wired: true;
      applied: true;
      status: "applied-by-artifact-receipt";
      artifactKind: "headless" | "interactive-full";
      appliedTransformIds: string[];
    };

export async function verifyAuthorizedSourceTargets(
  configuredRoot: string,
  transforms: readonly McpCompatibilityTransformDefinition[],
): Promise<VerifiedSourceTarget[]> {
  if (!configuredRoot || !isAbsolute(configuredRoot)) {
    throw new Error("authorized source root must be an explicit absolute path");
  }
  if (resolve(configuredRoot) !== configuredRoot) {
    throw new Error("authorized source root must be normalized");
  }

  const rootInfo = await lstat(configuredRoot);
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) {
    throw new Error("authorized source root must be a real directory, not a symlink");
  }
  if (await realpath(configuredRoot) !== configuredRoot) {
    throw new Error("authorized source root must equal its realpath");
  }

  const byPath = new Map<string, McpCompatibilityTransformDefinition>();
  for (const transform of transforms) {
    const existing = byPath.get(transform.targetPath);
    if (existing && existing.sourceSha256 !== transform.sourceSha256) {
      throw new Error(`conflicting source hashes for ${transform.targetPath}`);
    }
    byPath.set(transform.targetPath, transform);
  }

  const verified: VerifiedSourceTarget[] = [];
  for (const [path, transform] of byPath) {
    assertPortableRelativePath(path);
    const target = resolve(configuredRoot, ...path.split("/"));
    assertContained(configuredRoot, target, path);
    await assertNoSymlinkPath(configuredRoot, path);

    const targetInfo = await lstat(target);
    if (targetInfo.isSymbolicLink() || !targetInfo.isFile()) {
      throw new Error(`authorized source target is not a regular file: ${path}`);
    }
    if (await realpath(target) !== target) {
      throw new Error(`authorized source target does not equal its realpath: ${path}`);
    }

    const source = await readFile(target, "utf8");
    const sha256 = createHash("sha256").update(source).digest("hex");
    if (sha256 !== transform.sourceSha256) {
      throw new Error(`authorized source target sha256 mismatch: ${path}`);
    }

    const assertions = transforms
      .filter(candidate => candidate.targetPath === path)
      .flatMap(candidate => candidate.sourceAssertions);
    assertSourceAssertions(source, assertions, path);
    verified.push({ path, sha256, bytes: Buffer.byteLength(source) });
  }
  return verified.sort((left, right) => left.path.localeCompare(right.path));
}

export function resolveEffectivePatchApplication(
  manifest: PatchManifestIdentity,
  manifestSha256: string,
  transforms: readonly McpCompatibilityTransformDefinition[],
  receipt?: McpCompatibilityArtifactReceipt,
): EffectivePatchApplication {
  if (
    manifest.integration.wired !== true ||
    manifest.integration.applied !== false ||
    manifest.integration.status !== "wired-build-required"
  ) {
    throw new Error("patch manifest integration state must remain wired-build-required");
  }
  if (!receipt) return manifest.integration;
  if (!/^[a-f0-9]{64}$/.test(manifestSha256) || receipt.manifestSha256 !== manifestSha256) {
    throw new Error("artifact receipt manifest sha256 mismatch");
  }
  if (
    receipt.schemaVersion !== "ink-mcp-auth-compat-artifact/v1" ||
    (receipt.artifactKind !== "headless" && receipt.artifactKind !== "interactive-full") ||
    receipt.sourceCommit !== manifest.sourceTarget.commit ||
    receipt.sourcePackageVersion !== manifest.sourceTarget.packageVersion
  ) {
    throw new Error("artifact receipt source identity mismatch");
  }
  const knownIds = new Set(transforms.map(transform => transform.id));
  const expectedTransforms = getMcpCompatibilityTransformsForArtifact(receipt.artifactKind);
  if (expectedTransforms.some(transform => !knownIds.has(transform.id))) {
    throw new Error("artifact receipt transform catalog mismatch");
  }
  if (receipt.transforms.length !== expectedTransforms.length) {
    throw new Error("artifact receipt must cover every reachable compatibility transform exactly once");
  }

  const receiptById = new Map(receipt.transforms.map(item => [item.id, item]));
  if (receiptById.size !== receipt.transforms.length) {
    throw new Error("artifact receipt contains duplicate transform ids");
  }
  for (const transform of expectedTransforms) {
    const applied = receiptById.get(transform.id);
    if (
      !applied ||
      applied.targetPath !== transform.targetPath ||
      applied.sourceSha256 !== transform.sourceSha256 ||
      applied.sourceAssertionsPassed !== true ||
      applied.applied !== true
    ) {
      throw new Error(`artifact receipt does not prove transform: ${transform.id}`);
    }
  }
  return {
    wired: true,
    applied: true,
    status: "applied-by-artifact-receipt",
    artifactKind: receipt.artifactKind,
    appliedTransformIds: expectedTransforms.map(transform => transform.id),
  };
}

function assertPortableRelativePath(path: string): void {
  if (
    !path ||
    path.includes("\\") ||
    path.startsWith("/") ||
    path.split("/").some(part => part === "" || part === "." || part === "..")
  ) {
    throw new Error(`source target path must be portable and relative: ${path}`);
  }
}

function assertContained(root: string, target: string, label: string): void {
  const candidate = relative(root, target);
  if (!candidate || candidate === ".." || candidate.startsWith(`..${sep}`) || isAbsolute(candidate)) {
    throw new Error(`source target escaped authorized root: ${label}`);
  }
}

async function assertNoSymlinkPath(root: string, portablePath: string): Promise<void> {
  let current = root;
  for (const segment of portablePath.split("/")) {
    current = resolve(current, segment);
    const info = await lstat(current);
    if (info.isSymbolicLink()) {
      throw new Error(`authorized source path contains symlink: ${portablePath}`);
    }
  }
}
