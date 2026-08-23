// [Input] Headless transformer applied IDs, output-level bundle reachability, and manifest/source identity.
// [Output] A complete artifact receipt with applied=true, or a fail-closed validation error.
// [Pos] Builder-facing evidence gate; it does not bundle code, mutate source, or implement MCP state.

import { isAbsolute, relative, resolve, sep } from "node:path";

import {
  getMcpCompatibilityTransformsForArtifact,
  MCP_COMPATIBILITY_TRANSFORMS,
} from "./patch-spec.ts";
import type { McpCompatibilityArtifactReceipt } from "./source-identity.ts";

export interface BundleMetafileReachability {
  outputs: Record<string, {
    inputs?: Record<string, { bytesInOutput?: number }>;
  }>;
}

export interface TransformerApplicationEvidence {
  targetPath: string;
  appliedIds: readonly string[];
}

export interface BuildHeadlessArtifactReceiptOptions {
  manifestSha256: string;
  sourceCommit: string;
  sourcePackageVersion: string;
  transformerResults: readonly TransformerApplicationEvidence[];
  /** Canonical source paths proven reachable in the emitted artifact. */
  reachableSourcePaths?: readonly string[];
  /** Esbuild-compatible output-level metafile evidence. Inputs with zero bytes do not count. */
  bundleMetafile?: BundleMetafileReachability;
  /** Required when reachability evidence contains absolute paths. */
  sourceRoot?: string;
}

export interface BuiltHeadlessArtifactReceipt {
  wired: true;
  applied: true;
  status: "applied-by-artifact-receipt";
  receipt: McpCompatibilityArtifactReceipt;
}

export function buildHeadlessMcpCompatibilityArtifactReceipt(
  options: BuildHeadlessArtifactReceiptOptions,
): BuiltHeadlessArtifactReceipt {
  if (!/^[a-f0-9]{64}$/.test(options.manifestSha256)) {
    throw new Error("headless artifact receipt requires a manifest sha256");
  }
  if (!options.sourceCommit || !options.sourcePackageVersion) {
    throw new Error("headless artifact receipt requires source identity");
  }
  if (!options.reachableSourcePaths && !options.bundleMetafile) {
    throw new Error("headless artifact receipt requires reachability evidence");
  }

  const headlessTransforms = getMcpCompatibilityTransformsForArtifact("headless");
  const headlessIds = new Set(headlessTransforms.map(transform => transform.id));
  const allTransformsById = new Map(
    MCP_COMPATIBILITY_TRANSFORMS.map(transform => [transform.id, transform]),
  );
  const seenResultPaths = new Set<string>();
  const appliedIds = new Set<string>();

  for (const result of options.transformerResults) {
    if (seenResultPaths.has(result.targetPath)) {
      throw new Error(`duplicate transformer result path: ${result.targetPath}`);
    }
    seenResultPaths.add(result.targetPath);
    for (const id of result.appliedIds) {
      const transform = allTransformsById.get(id);
      if (!transform) throw new Error(`unknown compatibility transform id: ${id}`);
      if (transform.artifactReachability === "interactive-only") {
        throw new Error(`headless artifact cannot claim interactive-only transform: ${id}`);
      }
      if (transform.targetPath !== result.targetPath) {
        throw new Error(`transform ${id} was attributed to the wrong source path`);
      }
      if (appliedIds.has(id)) throw new Error(`duplicate applied transform id: ${id}`);
      appliedIds.add(id);
    }
  }

  for (const transform of headlessTransforms) {
    if (!appliedIds.has(transform.id)) {
      throw new Error(`headless artifact is missing applied transform: ${transform.id}`);
    }
  }
  if ([...appliedIds].some(id => !headlessIds.has(id))) {
    throw new Error("headless artifact contains a non-headless transform");
  }

  const requiredPaths = new Set(headlessTransforms.map(transform => transform.targetPath));
  const reachabilitySets: Array<{ label: string; paths: Set<string> }> = [];
  if (options.reachableSourcePaths) {
    reachabilitySets.push({
      label: "reachable source paths",
      paths: normalizeEvidencePaths(options.reachableSourcePaths, options.sourceRoot),
    });
  }
  if (options.bundleMetafile) {
    reachabilitySets.push({
      label: "bundle metafile outputs",
      paths: normalizeEvidencePaths(
        collectEmittedMetafileInputs(options.bundleMetafile),
        options.sourceRoot,
      ),
    });
  }
  for (const evidence of reachabilitySets) {
    for (const path of requiredPaths) {
      if (!evidence.paths.has(path)) {
        throw new Error(`${evidence.label} is missing required headless source: ${path}`);
      }
    }
  }

  const receipt: McpCompatibilityArtifactReceipt = {
    schemaVersion: "ink-mcp-auth-compat-artifact/v1",
    artifactKind: "headless",
    manifestSha256: options.manifestSha256,
    sourceCommit: options.sourceCommit,
    sourcePackageVersion: options.sourcePackageVersion,
    transforms: headlessTransforms.map(transform => ({
      id: transform.id,
      targetPath: transform.targetPath,
      sourceSha256: transform.sourceSha256,
      sourceAssertionsPassed: true,
      applied: true,
    })),
  };
  return {
    wired: true,
    applied: true,
    status: "applied-by-artifact-receipt",
    receipt,
  };
}

function collectEmittedMetafileInputs(metafile: BundleMetafileReachability): string[] {
  const emitted = new Set<string>();
  for (const output of Object.values(metafile.outputs)) {
    for (const [path, contribution] of Object.entries(output.inputs ?? {})) {
      if (typeof contribution.bytesInOutput === "number" && contribution.bytesInOutput > 0) {
        emitted.add(path);
      }
    }
  }
  return [...emitted];
}

function normalizeEvidencePaths(paths: readonly string[], sourceRoot?: string): Set<string> {
  if (sourceRoot && (!isAbsolute(sourceRoot) || resolve(sourceRoot) !== sourceRoot)) {
    throw new Error("sourceRoot must be a normalized absolute path");
  }
  const normalized = new Set<string>();
  for (const rawPath of paths) {
    let path = rawPath.replaceAll("\\", "/");
    if (isAbsolute(rawPath)) {
      if (!sourceRoot) throw new Error("absolute reachability paths require sourceRoot");
      const candidate = relative(sourceRoot, rawPath);
      if (!candidate || candidate === ".." || candidate.startsWith(`..${sep}`) || isAbsolute(candidate)) {
        throw new Error(`reachability path escaped sourceRoot: ${rawPath}`);
      }
      path = candidate.replaceAll("\\", "/");
    } else if (path.startsWith("./")) {
      path = path.slice(2);
    }
    if (!path || path.startsWith("/") || path.split("/").some(part => part === "" || part === "." || part === "..")) {
      throw new Error(`invalid reachability source path: ${rawPath}`);
    }
    normalized.add(path);
  }
  return normalized;
}
