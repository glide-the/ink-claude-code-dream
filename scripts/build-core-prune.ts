// [Input] Canonical repository src, explicit recovered dependency/package assets, reviewed transforms, and Bun 1.4.0.
// [Output] Write only local ignored bundle/assets, source digest, sanitized metafile, resolution gaps, and DCE receipt under dist/core-local.
// [Pos] The single Runtime compiler reads original project modules from src; external roots supply dependencies/assets only.
// [Sync] 2026-08-30: restore the 2.1.88 Linux sandbox-runtime seccomp assets from an exact locked Apache dependency.
// [Sync] 2026-09-13: remove the parallel implementation and compile the aligned project module tree.

import { createHash } from "node:crypto";
import { builtinModules } from "node:module";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  opendir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import {
  dirname,
  extname,
  isAbsolute,
  join,
  normalize,
  relative,
  resolve,
  sep,
} from "node:path";
import { spawnSync } from "node:child_process";
import {
  applyMcpCompatibilityTransforms,
  getMcpCompatibilityTransformsForArtifact,
  MCP_COMPATIBILITY_VIRTUAL_MODULE_RESOLUTIONS,
} from "../compat/mcp-auth/src/patch-spec.ts";
import { applyDreamSourceTransform, DREAM_SOURCE_TARGETS } from "../compat/dream-runtime/source-transforms.ts";

type JsonObject = Record<string, unknown>;

type CorePruneProfile = {
  schemaVersion: string;
  sourceVersionEvidence: string;
  cliCompatibilityVersion: string;
  sourceDirectory: string;
  recoveredDependencyRootEnvironment: string;
  repositoryDependencyRootEnvironment: string;
  packageRootEnvironment: string;
  targetEnvironment: string;
  outputDirectory: string;
  entrypoints: string[];
  runtimeAssets: Array<{
    sourceRoot?: "authorized-package" | "repository";
    sourceIdentity?: string;
    source: string;
    output: string;
    sha256: string;
    mode: number;
    license: string;
  }>;
  runtimeAssetTargets: Record<string, Array<{
    sourceRoot?: "authorized-package" | "repository";
    sourceIdentity?: string;
    source: string;
    output: string;
    sha256: string;
    mode: number;
    license: string;
  }>>;
  builder: {
    runtime: string;
    version: string;
    target: "bun";
    format: "esm";
    splitting: boolean;
    sourcemap: "none";
    minifySyntax: boolean;
  };
  features: { enabled: string[]; disabled: string[] };
  defines: Record<string, string>;
  requiredCapabilities: string[];
  capabilityInputAssertions: Record<string, string[]>;
  featureDisposition: Record<string, string>;
  emptyModuleAllowlist: Array<{
    target: string;
    reason: string;
    sourceDigest: string;
    importers: Array<{ path: string; sha256: string }>;
  }>;
  mcpCompatibility: {
    artifactKind: "headless";
    requiredTransformIds: string[];
  };
  sourceTransforms: Array<{
    path: string;
    sha256: string;
    transform:
      | "headless-cli-entry-v1"
      | "headless-main-v1"
      | "headless-agent-tool-v1"
      | "headless-tool-v1"
      | "headless-commands-v1"
      | "headless-runtime-ui-v1"
      | "headless-provider-v1"
      | "headless-closure-v1";
    reason: string;
  }>;
  dceAssertions: {
    forbiddenInputPrefixes: string[];
    forbiddenInputSuffixes: string[];
    forbiddenResolutionSpecifiers: string[];
    forbiddenOutputSubstrings: string[];
  };
};

type ResolutionMap = {
  schemaVersion: string;
  dependencyRoots: Record<
    string,
    {
      version: string;
      root: string;
      entry: string;
      packageJsonSha256: string;
      license: string;
      licenseFile: string;
      licenseSha256: string;
      treeSha256: string;
      fallbackOnly: boolean;
    }
  >;
  dependencyTransforms: Array<{
    dependency: string;
    path: string;
    sha256: string;
    transform: "sharp-optional-runtime-v1";
    reason: string;
  }>;
  runtimeFacades: Record<
    string,
    { target: string; sha256: string; reason: string }
  >;
  exact: Record<string, string>;
  prefix: Record<string, string>;
  virtualFacades: Record<
    string,
    {
      reason: string;
      sourceDigest: string;
      exports: Record<string, { target: string; sha256: string; importName: string }>;
    }
  >;
};

type ResolutionGap = {
  kind: "missing-local" | "unmapped-bare" | "missing-map-target";
  specifier: string;
  importer: string;
  mappedTarget?: string;
};

const repositoryRoot = resolve(import.meta.dir, "..");
const profilePath = join(repositoryRoot, "runtime", "core-prune-profile.json");
const resolutionMapPath = join(
  repositoryRoot,
  "runtime",
  "core-resolution-map.json",
);
const dependencyLicensesPath = join(repositoryRoot, "runtime", "dependency-licenses.json");

const profile = JSON.parse(await readFile(profilePath, "utf8")) as CorePruneProfile;
const resolutionMap = JSON.parse(
  await readFile(resolutionMapPath, "utf8"),
) as ResolutionMap;

function fail(message: string): never {
  throw new Error(`[core-prune] ${message}`);
}

function assertStringArray(value: unknown, label: string): asserts value is string[] {
  if (
    !Array.isArray(value) ||
    value.some(item => typeof item !== "string" || item.length === 0)
  ) {
    fail(`${label} must be a non-empty-string array`);
  }
}

function assertRelativeRepositoryPath(value: string, label: string): void {
  if (isAbsolute(value) || normalize(value).startsWith(`..${sep}`) || value === "..") {
    fail(`${label} must remain repository-relative`);
  }
}

if (profile.schemaVersion !== "ink-core-prune-profile/v1") {
  fail("unsupported profile schema");
}
if (
  !/^\d+\.\d+\.\d+$/.test(profile.sourceVersionEvidence) ||
  !/^\d+\.\d+\.\d+$/.test(profile.cliCompatibilityVersion) ||
  profile.defines["MACRO.VERSION"] !== profile.cliCompatibilityVersion
) {
  fail("source provenance and CLI compatibility versions must be explicit and independently bound");
}
if (resolutionMap.schemaVersion !== "ink-core-resolution-map/v1") {
  fail("unsupported resolution-map schema");
}
if (
  profile.builder.runtime !== "bun" ||
  profile.builder.version !== "1.4.0" ||
  Bun.version !== profile.builder.version
) {
  fail(`Bun ${profile.builder.version} is required; running ${Bun.version}`);
}
if (profile.outputDirectory !== "dist/core-local") {
  fail("outputDirectory must be exactly dist/core-local");
}
if (profile.targetEnvironment !== "INK_CLAUDE_CODE_BUILD_TARGET") {
  fail("targetEnvironment must be exactly INK_CLAUDE_CODE_BUILD_TARGET");
}
const supportedRuntimeTargets = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"];
if (
  JSON.stringify(Object.keys(profile.runtimeAssetTargets).sort()) !==
  JSON.stringify([...supportedRuntimeTargets].sort())
) {
  fail("runtimeAssetTargets must cover exactly darwin/linux arm64/x64");
}
const hostRuntimeTarget = `${process.platform}-${process.arch}`;
const runtimeTarget = process.env[profile.targetEnvironment]?.trim() || hostRuntimeTarget;
if (!supportedRuntimeTargets.includes(runtimeTarget)) {
  fail(`unsupported Runtime target: ${runtimeTarget}`);
}
if (runtimeTarget !== hostRuntimeTarget) {
  fail(`cross-target core build is forbidden: host=${hostRuntimeTarget}, requested=${runtimeTarget}`);
}
const selectedRuntimeAssets = [
  ...profile.runtimeAssets,
  ...profile.runtimeAssetTargets[runtimeTarget],
];
if (profile.mcpCompatibility.artifactKind !== "headless") {
  fail("core-prune MCP compatibility artifact must be headless");
}
assertStringArray(
  profile.mcpCompatibility.requiredTransformIds,
  "mcpCompatibility.requiredTransformIds",
);
const headlessMcpTransformDefinitions = getMcpCompatibilityTransformsForArtifact("headless");
const headlessMcpTransformIds = headlessMcpTransformDefinitions.map(definition => definition.id);
if (
  [...profile.mcpCompatibility.requiredTransformIds].sort().join("\0") !==
  [...headlessMcpTransformIds].sort().join("\0")
) {
  fail("profile MCP compatibility IDs must match the executable headless transform set");
}
const mcpTransformsByPath = new Map<string, string[]>();
for (const definition of headlessMcpTransformDefinitions) {
  const current = mcpTransformsByPath.get(definition.targetPath) ?? [];
  current.push(definition.id);
  mcpTransformsByPath.set(definition.targetPath, current);
}
assertStringArray(profile.entrypoints, "entrypoints");
assertStringArray(profile.features.disabled, "features.disabled");
assertStringArray(profile.requiredCapabilities, "requiredCapabilities");
if (
  Object.keys(profile.capabilityInputAssertions).sort().join("\0") !==
  [...profile.requiredCapabilities].sort().join("\0")
) {
  fail("capabilityInputAssertions must cover every required capability exactly");
}
for (const [capability, inputs] of Object.entries(profile.capabilityInputAssertions)) {
  assertStringArray(inputs, `capabilityInputAssertions.${capability}`);
  for (const input of inputs) assertRelativeRepositoryPath(input, `capability input ${input}`);
}
for (const feature of Object.keys(profile.featureDisposition)) {
  if (!profile.features.disabled.includes(feature)) {
    fail(`feature disposition must describe a disabled feature: ${feature}`);
  }
}
for (const feature of profile.features.enabled) {
  if (profile.features.disabled.includes(feature)) {
    fail(`feature cannot be both enabled and disabled: ${feature}`);
  }
}
for (const entrypoint of profile.entrypoints) {
  assertRelativeRepositoryPath(entrypoint, `entrypoint ${entrypoint}`);
}
for (const [specifier, target] of [
  ...Object.entries(resolutionMap.exact),
  ...Object.entries(resolutionMap.prefix),
]) {
  if (!specifier || !target) fail("resolution-map entries cannot be empty");
  assertRelativeRepositoryPath(target, `resolution target for ${specifier}`);
}
for (const [name, dependency] of Object.entries(resolutionMap.dependencyRoots)) {
  if (
    !name ||
    !dependency.version ||
    !dependency.entry ||
    !dependency.license ||
    !/^[a-f0-9]{64}$/.test(dependency.packageJsonSha256) ||
    !/^[a-f0-9]{64}$/.test(dependency.licenseSha256) ||
    !/^[a-f0-9]{64}$/.test(dependency.treeSha256)
  ) {
    fail(`invalid dependency-root metadata: ${name}`);
  }
  assertRelativeRepositoryPath(dependency.root, `dependency root ${name}`);
  assertRelativeRepositoryPath(dependency.entry, `dependency entry ${name}`);
  assertRelativeRepositoryPath(dependency.licenseFile, `dependency license ${name}`);
}
if (!Array.isArray(resolutionMap.dependencyTransforms)) {
  fail("dependencyTransforms must be an array");
}
for (const transform of resolutionMap.dependencyTransforms) {
  if (
    !resolutionMap.dependencyRoots[transform.dependency] ||
    transform.transform !== "sharp-optional-runtime-v1" ||
    !transform.reason ||
    !/^[a-f0-9]{64}$/.test(transform.sha256)
  ) {
    fail(`invalid dependency transform metadata: ${transform.dependency}:${transform.path}`);
  }
  assertRelativeRepositoryPath(
    transform.path,
    `dependency transform ${transform.dependency}:${transform.path}`,
  );
}
for (const [id, facade] of Object.entries(resolutionMap.runtimeFacades)) {
  if (
    !/^[a-z0-9-]+$/.test(id) ||
    !facade.reason ||
    !/^[a-f0-9]{64}$/.test(facade.sha256)
  ) {
    fail(`invalid runtime facade metadata: ${id}`);
  }
  assertRelativeRepositoryPath(facade.target, `runtime facade ${id}`);
}
for (const [specifier, facade] of Object.entries(resolutionMap.virtualFacades)) {
  if (!specifier || !facade.reason || !/^[a-f0-9]{64}$/.test(facade.sourceDigest)) {
    fail(`invalid virtual facade metadata: ${specifier}`);
  }
  if (Object.keys(facade.exports).length === 0) fail(`virtual facade has no exports: ${specifier}`);
  for (const [exportName, target] of Object.entries(facade.exports)) {
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(exportName)) {
      fail(`invalid virtual facade export: ${specifier}.${exportName}`);
    }
    assertRelativeRepositoryPath(target.target, `virtual facade target ${specifier}.${exportName}`);
    if (!/^(?:default|[A-Za-z_$][A-Za-z0-9_$]*)$/.test(target.importName)) {
      fail(`invalid virtual facade import: ${specifier}.${exportName}`);
    }
    if (!/^[a-f0-9]{64}$/.test(target.sha256)) {
      fail(`invalid virtual facade target digest: ${specifier}.${exportName}`);
    }
  }
}
for (const emptyModule of profile.emptyModuleAllowlist) {
  assertRelativeRepositoryPath(emptyModule.target, `empty module target ${emptyModule.target}`);
  if (!emptyModule.reason || !/^[a-f0-9]{64}$/.test(emptyModule.sourceDigest)) {
    fail(`invalid empty module metadata: ${emptyModule.target}`);
  }
  if (!Array.isArray(emptyModule.importers) || emptyModule.importers.length === 0) {
    fail(`empty module must name verified importers: ${emptyModule.target}`);
  }
  for (const importer of emptyModule.importers) {
    assertRelativeRepositoryPath(importer.path, `empty module importer ${importer.path}`);
    if (!/^[a-f0-9]{64}$/.test(importer.sha256)) {
      fail(`invalid empty module importer digest: ${importer.path}`);
    }
  }
}

if (profile.sourceDirectory !== "src") fail("the implementation must be repository src");
const sourceRoot = repositoryRoot;
const sourceRootRaw = process.env[profile.recoveredDependencyRootEnvironment]?.trim();
if (!sourceRootRaw || !isAbsolute(sourceRootRaw)) {
  fail(`${profile.recoveredDependencyRootEnvironment} must be an explicit absolute path for recovered dependencies, not implementation source`);
}
if (resolve(sourceRootRaw) !== sourceRootRaw) {
  fail(`${profile.recoveredDependencyRootEnvironment} must be normalized`);
}
const dependencySourceRoot = await realpath(sourceRootRaw);
if (dependencySourceRoot !== sourceRootRaw) {
  fail(`${profile.recoveredDependencyRootEnvironment} must not traverse a symlink`);
}
const toolchainRootRaw = process.env[profile.repositoryDependencyRootEnvironment]?.trim() || repositoryRoot;
if (!isAbsolute(toolchainRootRaw) || resolve(toolchainRootRaw) !== toolchainRootRaw) {
  fail(`${profile.repositoryDependencyRootEnvironment} must be a normalized absolute path`);
}
const toolchainRoot = await realpath(toolchainRootRaw);
if (toolchainRoot !== toolchainRootRaw) fail("toolchain root must not traverse a symlink");
function sourcePath(logicalPath: string): string {
  if (isAbsolute(logicalPath)) return logicalPath;
  const normalized = normalize(logicalPath).replace(/^\.\//, "");
  if (normalized === "src" || normalized.startsWith(`src${sep}`)) return join(repositoryRoot, normalized);
  if (normalized === "node_modules" || normalized.startsWith(`node_modules${sep}`) ||
      normalized === "vendor" || normalized.startsWith(`vendor${sep}`)) return join(dependencySourceRoot, normalized);
  fail(`logical source path is outside the original module/dependency layout: ${logicalPath}`);
}

const packageRootRaw = process.env[profile.packageRootEnvironment]?.trim();
if (!packageRootRaw || !isAbsolute(packageRootRaw) || resolve(packageRootRaw) !== packageRootRaw) {
  fail(`${profile.packageRootEnvironment} must be an explicit normalized absolute path`);
}
const packageRoot = await realpath(packageRootRaw);
if (packageRoot !== packageRootRaw || !(await stat(packageRoot)).isDirectory()) {
  fail(`${profile.packageRootEnvironment} must be a real directory without symlink traversal`);
}
const runtimeAssetSourcePaths = new Map<(typeof selectedRuntimeAssets)[number], string>();
for (const asset of selectedRuntimeAssets) {
  assertRelativeRepositoryPath(asset.source, `runtime asset source ${asset.source}`);
  assertRelativeRepositoryPath(asset.output, `runtime asset output ${asset.output}`);
  const sourceRoot = asset.sourceRoot ?? "authorized-package";
  if (
    !["authorized-package", "repository"].includes(sourceRoot) ||
    (sourceRoot === "repository" && !asset.sourceIdentity) ||
    !/^[a-f0-9]{64}$/.test(asset.sha256) ||
    !asset.license ||
    ![0o644, 0o755].includes(asset.mode)
  ) {
    fail(`invalid runtime asset metadata: ${asset.output}`);
  }
  const source = join(sourceRoot === "repository" ? (asset.source.startsWith("node_modules/") ? toolchainRoot : repositoryRoot) : packageRoot, asset.source);
  if ((await realpath(source)) !== source || !(await stat(source)).isFile()) {
    fail(`runtime asset must be a real regular file: ${asset.source}`);
  }
  const digest = createHash("sha256").update(await readFile(source)).digest("hex");
  if (digest !== asset.sha256) fail(`runtime asset digest drift: ${asset.source}`);
  runtimeAssetSourcePaths.set(asset, source);
}
for (const requiredDirectory of ["src", "node_modules", "vendor"]) {
  if (!(await stat(sourcePath(requiredDirectory))).isDirectory()) {
    fail(`source root is missing ${requiredDirectory}/`);
  }
}

const outputRoot = join(repositoryRoot, profile.outputDirectory);
if (resolve(outputRoot) !== join(repositoryRoot, "dist", "core-local")) {
  fail("output escaped dist/core-local");
}
const ignoreProbe = spawnSync(
  "git",
  ["check-ignore", "-q", "dist/core-local/.probe"],
  { cwd: repositoryRoot, stdio: "ignore" },
);
if (ignoreProbe.status !== 0) {
  fail("dist/core-local must be ignored by git before the builder may write");
}

await rm(outputRoot, { recursive: true, force: true });
await mkdir(join(outputRoot, "bundle"), { recursive: true });

function portablePath(value: string): string {
  return value.split(sep).join("/");
}

function sourceRelative(value: string): string {
  if (!value) return "<entry>";
  const absolute = isAbsolute(value) ? value : resolve(value);
  const candidate = relative(repositoryRoot, absolute);
  if (candidate.startsWith(`src${sep}`)) {
    return portablePath(candidate);
  }
  const dependencyCandidate = relative(dependencySourceRoot, absolute);
  if (!dependencyCandidate.startsWith("..") && !isAbsolute(dependencyCandidate)) return portablePath(dependencyCandidate);
  const toolchainCandidate = relative(toolchainRoot, absolute);
  if (toolchainCandidate.startsWith(`node_modules${sep}`)) return `<TOOLCHAIN_ROOT>/${portablePath(toolchainCandidate)}`;
  if (absolute === sourceRoot) return ".";
  return value.replaceAll(dependencySourceRoot, "<DEPENDENCY_ROOT>").replaceAll(outputRoot, "<CORE_OUTPUT>").replaceAll(sourceRoot, "<SOURCE_ROOT>");
}

async function filesUnder(root: string): Promise<string[]> {
  const results: string[] = [];
  async function visit(directory: string): Promise<void> {
    const handle = await opendir(directory);
    for await (const entry of handle) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) fail(`source tree contains symlink: ${sourceRelative(path)}`);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) results.push(path);
    }
  }
  await visit(root);
  return results.sort((left, right) =>
    portablePath(relative(root, left)).localeCompare(portablePath(relative(root, right))),
  );
}

async function digestSourceTree(): Promise<{
  algorithm: "sha256";
  digest: string;
  fileCount: number;
  bytes: number;
}> {
  const hash = createHash("sha256");
  // The exact original logical tree is reconstructed without reading external src or
  // any other repository files, and without materializing a second implementation.
  const files = (await Promise.all(["src", "node_modules", "vendor"].map(directory => filesUnder(sourcePath(directory)))))
    .flat().sort((left, right) => sourceRelative(left).localeCompare(sourceRelative(right)));
  let bytes = 0;
  for (const file of files) {
    const body = await readFile(file);
    const rel = sourceRelative(file);
    hash.update(`${rel}\0${body.byteLength}\0`);
    hash.update(body);
    bytes += body.byteLength;
  }
  return { algorithm: "sha256", digest: hash.digest("hex"), fileCount: files.length, bytes };
}

const sourceDigest = await digestSourceTree();
const runtimeFacadeIdsByTarget = new Map<string, string>();
for (const [id, facade] of Object.entries(resolutionMap.runtimeFacades)) {
  const target = sourcePath(facade.target);
  const body = await readFile(target);
  if (createHash("sha256").update(body).digest("hex") !== facade.sha256) {
    fail(`runtime facade target digest drift: ${id}`);
  }
  runtimeFacadeIdsByTarget.set(target, id);
}
const emptyModules = new Map(profile.emptyModuleAllowlist.map(entry => [entry.target, entry]));
for (const [specifier, facade] of Object.entries(resolutionMap.virtualFacades)) {
  if (facade.sourceDigest !== sourceDigest.digest) {
    fail(`virtual facade source digest drift: ${specifier}`);
  }
  for (const [exportName, target] of Object.entries(facade.exports)) {
    const file = sourcePath(target.target);
    const body = await readFile(file);
    if (createHash("sha256").update(body).digest("hex") !== target.sha256) {
      fail(`virtual facade target digest drift: ${specifier}.${exportName}`);
    }
  }
}
for (const emptyModule of profile.emptyModuleAllowlist) {
  if (emptyModule.sourceDigest !== sourceDigest.digest) {
    fail(`empty module source digest drift: ${emptyModule.target}`);
  }
  for (const importer of emptyModule.importers) {
    const body = await readFile(sourcePath(importer.path));
    if (createHash("sha256").update(body).digest("hex") !== importer.sha256) {
      fail(`empty module importer digest drift: ${importer.path}`);
    }
  }
}
const sourceTransforms = new Map(profile.sourceTransforms.map(entry => [entry.path, entry]));
const dreamSourceTransforms = new Map(DREAM_SOURCE_TARGETS.map(entry => [entry.path, entry]));
const dreamHelperPath = join(repositoryRoot, "compat/dream-runtime/policy.ts");
const dreamTransformerPath = join(repositoryRoot, "compat/dream-runtime/source-transforms.ts");
for (const target of DREAM_SOURCE_TARGETS) {
  const body = await readFile(sourcePath(target.path));
  if (createHash("sha256").update(body).digest("hex") !== target.sha256) {
    fail(`Dream compatibility original-source digest drift: ${target.path}`);
  }
}
for (const file of [dreamHelperPath, dreamTransformerPath]) {
  if (await realpath(file) !== file || !(await lstat(file)).isFile()) fail("Dream compatibility source must be a regular canonical file");
}
const dreamHelperSha256 = createHash("sha256").update(await readFile(dreamHelperPath)).digest("hex");
const dreamTransformerSha256 = createHash("sha256").update(await readFile(dreamTransformerPath)).digest("hex");
if (sourceTransforms.size !== profile.sourceTransforms.length) {
  fail("source transforms must have unique paths");
}
for (const sourceTransform of profile.sourceTransforms) {
  assertRelativeRepositoryPath(sourceTransform.path, `source transform ${sourceTransform.path}`);
  if (!sourceTransform.reason || !/^[a-f0-9]{64}$/.test(sourceTransform.sha256)) {
    fail(`invalid source transform metadata: ${sourceTransform.path}`);
  }
  const body = await readFile(sourcePath(sourceTransform.path));
  if (createHash("sha256").update(body).digest("hex") !== sourceTransform.sha256) {
    fail(`source transform target digest drift: ${sourceTransform.path}`);
  }
}
const headlessManualOAuthTransform = {
  path: "src/services/mcp/auth.ts",
  sha256: "fce615a24470f433b43976917a83db8ff388caeeb75a50ac543c48a70ea4a2e8",
};
const headlessManualOAuthBody = await readFile(
  sourcePath(headlessManualOAuthTransform.path),
);
if (
  createHash("sha256").update(headlessManualOAuthBody).digest("hex") !==
  headlessManualOAuthTransform.sha256
) {
  fail(`headless manual OAuth transform target digest drift: ${headlessManualOAuthTransform.path}`);
}
const secureStorageSelectorTransforms = [
  {
    path: "src/utils/secureStorage/macOsKeychainHelpers.ts",
    sha256: "4909e3a8a1a374f1a2183887087ae23c1859e6882fc8b2bfb070c02b8e2ec17d",
  },
  {
    path: "src/utils/secureStorage/plainTextStorage.ts",
    sha256: "5be4533db9ed637c7c3ed6d521554906ec0601ef66ed46ba74f0d8becaec2bf7",
  },
  {
    path: "src/utils/secureStorage/index.ts",
    sha256: "e73e784ce18ba8f5e2b1d8c8fc6877662257b9d8df0ee3f89c9118670c79ab51",
  },
];
for (const transform of secureStorageSelectorTransforms) {
  const body = await readFile(sourcePath(transform.path));
  if (createHash("sha256").update(body).digest("hex") !== transform.sha256) {
    fail(`secure-storage selector transform target digest drift: ${transform.path}`);
  }
}
const secureStorageSelectorTransformsByPath = new Map(
  secureStorageSelectorTransforms.map(transform => [transform.path, transform]),
);
const gaps = new Map<string, ResolutionGap>();
const appliedTransforms = new Set<string>();
const appliedDreamSourceTransforms = new Set<string>();
let appliedHeadlessManualOAuthTransform = false;
const appliedSecureStorageSelectorTransforms = new Set<string>();
const appliedMcpCompatibilityIds = new Set<string>();
const mcpCompatibilityAssertions: unknown[] = [];
const removedStaticImports = new Map<string, { path: string; specifier: string; bindings: string[] }>();
const removedToolRenderProperties = new Map<string, string[]>();

function recordGap(gap: ResolutionGap): void {
  const normalized = { ...gap, importer: sourceRelative(gap.importer) };
  gaps.set(JSON.stringify(normalized), normalized);
}

function isInsideSourceRoot(path: string): boolean {
  return [sourcePath("src"), sourcePath("node_modules"), sourcePath("vendor")].some(root => {
    const rel = relative(root, path);
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
  });
}

const dependencyRootPaths = new Map<string, string>();
const dependencyTransformsByPath = new Map<
  string,
  ResolutionMap["dependencyTransforms"][number]
>();
const appliedDependencyTransforms = new Set<string>();
const dependencyLicenseReport = JSON.parse(
  await readFile(dependencyLicensesPath, "utf8"),
) as { components?: Array<Record<string, unknown>> };
for (const [name, dependency] of Object.entries(resolutionMap.dependencyRoots)) {
  const configuredRoot = join(toolchainRoot, dependency.root);
  const root = await realpath(configuredRoot);
  if (root !== configuredRoot || !(await stat(root)).isDirectory()) {
    fail(`dependency root must be a real directory without symlink traversal: ${name}`);
  }
  const packageJsonPath = join(root, "package.json");
  const licensePath = join(root, dependency.licenseFile);
  const packageJsonBody = await readFile(packageJsonPath);
  const licenseBody = await readFile(licensePath);
  if (createHash("sha256").update(packageJsonBody).digest("hex") !== dependency.packageJsonSha256) {
    fail(`dependency package manifest digest drift: ${name}`);
  }
  if (createHash("sha256").update(licenseBody).digest("hex") !== dependency.licenseSha256) {
    fail(`dependency license digest drift: ${name}`);
  }
  const packageManifest = JSON.parse(packageJsonBody.toString()) as {
    name?: string;
    version?: string;
    license?: string;
  };
  if (
    packageManifest.name !== name ||
    packageManifest.version !== dependency.version ||
    packageManifest.license !== dependency.license
  ) {
    fail(`dependency package identity drift: ${name}`);
  }
  const files = await filesUnder(root);
  const treeHash = createHash("sha256");
  for (const file of files) {
    const body = await readFile(file);
    treeHash.update(`${portablePath(relative(root, file))}\0${body.byteLength}\0`);
    treeHash.update(body);
  }
  if (treeHash.digest("hex") !== dependency.treeSha256) {
    fail(`dependency tree digest drift: ${name}`);
  }
  const licenseEntry = dependencyLicenseReport.components?.find(
    component => component.name === name && component.version === dependency.version,
  );
  if (
    !licenseEntry ||
    licenseEntry.license !== dependency.license ||
    licenseEntry.treeSha256 !== dependency.treeSha256
  ) {
    fail(`dependency license report mismatch: ${name}`);
  }
  dependencyRootPaths.set(name, root);
}
for (const transform of resolutionMap.dependencyTransforms) {
  const root = dependencyRootPaths.get(transform.dependency);
  if (!root) fail(`dependency transform root was not validated: ${transform.dependency}`);
  const path = join(root, transform.path);
  if (dependencyTransformsByPath.has(path)) {
    fail(`duplicate dependency transform target: ${transform.dependency}:${transform.path}`);
  }
  const body = await readFile(path);
  if (createHash("sha256").update(body).digest("hex") !== transform.sha256) {
    fail(`dependency transform target digest drift: ${transform.dependency}:${transform.path}`);
  }
  dependencyTransformsByPath.set(path, transform);
}

function dependencyForPath(path: string): { name: string; root: string } | null {
  for (const [name, root] of dependencyRootPaths) {
    const rel = relative(root, path);
    if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) return { name, root };
  }
  return null;
}

async function existingFile(path: string): Promise<string | null> {
  if (!isInsideSourceRoot(path) && !dependencyForPath(path)) {
    fail(`resolver escaped authorized roots: ${path}`);
  }
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink()) fail(`resolver target is a symlink: ${sourceRelative(path)}`);
    return info.isFile() ? path : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function resolveSourceFile(base: string): Promise<string | null> {
  for (const [name, root] of dependencyRootPaths) {
    if (base !== root) continue;
    const manifestEntry = join(root, resolutionMap.dependencyRoots[name].entry);
    const found = await existingFile(manifestEntry);
    if (found) return found;
    fail(`validated dependency manifest entry is missing: ${name}`);
  }
  const extension = extname(base);
  const candidates = [base];
  if (extension === ".js" || extension === ".mjs" || extension === ".jsx") {
    const stem = base.slice(0, -extension.length);
    candidates.push(`${stem}.ts`, `${stem}.tsx`, `${stem}.mts`);
  } else if (
    !extension ||
    !new Set([".ts", ".tsx", ".mts", ".cjs", ".json", ".node", ".txt", ".md"]).has(
      extension,
    )
  ) {
    candidates.push(
      `${base}.ts`,
      `${base}.tsx`,
      `${base}.js`,
      `${base}.mjs`,
      `${base}.cjs`,
      `${base}.json`,
    );
  }
  candidates.push(
    join(base, "index.ts"),
    join(base, "index.tsx"),
    join(base, "index.js"),
    join(base, "index.mjs"),
    join(base, "index.cjs"),
    join(base, "index.json"),
  );
  for (const candidate of candidates) {
    const found = await existingFile(candidate);
    if (found) return found;
  }
  return null;
}

const builtins = new Set(
  builtinModules.flatMap(name => [name, name.startsWith("node:") ? name.slice(5) : `node:${name}`]),
);
const orderedPrefixes = Object.entries(resolutionMap.prefix).sort(
  ([left], [right]) => right.length - left.length,
);

function mappedBareTarget(specifier: string): string | null {
  const exact = resolutionMap.exact[specifier];
  if (exact) return exact;
  for (const [prefix, targetPrefix] of orderedPrefixes) {
    if (specifier.startsWith(prefix)) return `${targetPrefix}${specifier.slice(prefix.length)}`;
  }
  return null;
}

function dependencyTargetForSpecifier(specifier: string): string | null {
  for (const [name, dependency] of Object.entries(resolutionMap.dependencyRoots)) {
    if (dependency.fallbackOnly) continue;
    if (specifier !== name && !specifier.startsWith(`${name}/`)) continue;
    const root = dependencyRootPaths.get(name);
    if (!root) fail(`validated dependency root missing: ${name}`);
    return specifier === name
      ? join(root, dependency.entry)
      : join(root, specifier.slice(name.length + 1));
  }
  return null;
}

async function resolveDependencyFallback(base: string): Promise<string | null> {
  const sourceNodeModules = sourcePath("node_modules");
  const rel = relative(sourceNodeModules, base);
  if (rel.startsWith("..") || isAbsolute(rel)) return null;
  for (const [name, root] of dependencyRootPaths) {
    if (rel !== name && !rel.startsWith(`${name}${sep}`)) continue;
    const packageRelative = rel === name ? "" : rel.slice(name.length + 1);
    return resolveSourceFile(join(root, packageRelative));
  }
  return null;
}

function replaceUnique(source: string, marker: string, replacement: string, label: string): string {
  const first = source.indexOf(marker);
  if (first === -1 || source.indexOf(marker, first + marker.length) !== -1) {
    fail(`source transform marker must occur exactly once: ${label}`);
  }
  return `${source.slice(0, first)}${replacement}${source.slice(first + marker.length)}`;
}

function replaceUniqueSpan(
  source: string,
  startMarker: string,
  endMarker: string,
  replacement: string,
  label: string,
): string {
  const start = source.indexOf(startMarker);
  if (
    start === -1 ||
    source.indexOf(startMarker, start + startMarker.length) !== -1
  ) {
    fail(`source transform start marker must occur exactly once: ${label}`);
  }
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (end === -1 || source.indexOf(endMarker, end + endMarker.length) !== -1) {
    fail(`source transform end marker must occur exactly once after start: ${label}`);
  }
  return `${source.slice(0, start)}${replacement}${source.slice(end)}`;
}

function replaceUniqueTail(
  source: string,
  startMarker: string,
  replacement: string,
  label: string,
): string {
  const start = source.indexOf(startMarker);
  if (start === -1 || source.indexOf(startMarker, start + startMarker.length) !== -1) {
    fail(`source transform tail marker must occur exactly once: ${label}`);
  }
  return `${source.slice(0, start)}${replacement}`;
}

function importBindings(clause: string): string[] {
  const bindings: string[] = [];
  let rest = clause.replace(/^type\s+/, "").trim();
  if (!rest.startsWith("{") && !rest.startsWith("*")) {
    const comma = rest.indexOf(",");
    bindings.push((comma === -1 ? rest : rest.slice(0, comma)).trim());
    rest = comma === -1 ? "" : rest.slice(comma + 1).trim();
  }
  const namespace = rest.match(/^\*\s+as\s+([A-Za-z_$][A-Za-z0-9_$]*)$/);
  if (namespace) bindings.push(namespace[1]);
  const named = rest.match(/^\{([\s\S]*)\}$/);
  if (named) {
    for (const entry of named[1].split(",")) {
      const normalized = entry.trim().replace(/^type\s+/, "");
      if (!normalized) continue;
      bindings.push(normalized.split(/\s+as\s+/).at(-1)!.trim());
    }
  }
  return bindings.filter(Boolean);
}

function pruneUnusedBoundImports(source: string, path: string): string {
  // Match only syntactically bound imports. In particular, never let a
  // semicolon-free side-effect import become part of the following clause.
  const importPattern = /^(import(?:\s+type)?\s+((?:[A-Za-z_$][A-Za-z0-9_$]*\s*,\s*)?(?:[A-Za-z_$][A-Za-z0-9_$]*|\*\s+as\s+[A-Za-z_$][A-Za-z0-9_$]*|\{[^}]*\}))\s+from\s+(['"])([^'"\r\n]+)\3;?\r?\n)/gm;
  const usageCorpus = source
    .replace(importPattern, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  return source.replace(
    importPattern,
    (declaration, _whole, clause: string, _quote, specifier: string) => {
      const bindings = importBindings(clause);
      if (
        specifier.includes("\n") ||
        bindings.some(binding => !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(binding))
      ) {
        fail(`invalid static import parse: ${path} -> ${specifier}`);
      }
      if (
        bindings.length === 0 ||
        bindings.some(binding =>
          new RegExp(`(^|[^A-Za-z0-9_$])${binding.replaceAll("$", "\\$")}([^A-Za-z0-9_$]|$)`).test(
            usageCorpus,
          ),
        )
      ) {
        return declaration;
      }
      const key = `${path}\0${specifier}\0${bindings.join(",")}`;
      if (removedStaticImports.has(key)) fail(`duplicate removed static import: ${path} -> ${specifier}`);
      removedStaticImports.set(key, { path, specifier, bindings });
      return "";
    },
  );
}

const headlessRenderProperties = new Set([
  "getActivityDescription",
  "getToolUseSummary",
  "userFacingName",
  "userFacingNameBackgroundColor",
  "renderToolResultMessage",
  "renderToolUseMessage",
  "renderToolUseTag",
  "renderToolUseProgressMessage",
  "renderToolUseQueuedMessage",
  "renderToolUseRejectedMessage",
  "renderToolUseErrorMessage",
  "renderGroupedToolUse",
]);

function removeHeadlessToolRenderProperties(source: string, path: string): string {
  const toolObjectStart = source.indexOf("buildTool({");
  if (toolObjectStart === -1) fail(`headless tool object marker missing: ${path}`);
  const lines = [...source.matchAll(/^.*(?:\n|$)/gm)]
    .filter(match => match[0].length > 0)
    .map(match => ({ text: match[0], offset: match.index! }));
  const propertyPattern = /^(\s+)(?:(?:async|get)\s+)?([A-Za-z_$][A-Za-z0-9_$]*)\s*(?:[:(,])/;
  const candidates = lines
    .filter(line => line.offset > toolObjectStart)
    .map(line => ({ line, match: line.text.match(propertyPattern) }))
    .filter(candidate => candidate.match && headlessRenderProperties.has(candidate.match[2]));
  if (candidates.length === 0) fail(`headless tool transform removed no render properties: ${path}`);
  const propertyIndent = Math.min(...candidates.map(candidate => candidate.match![1].length));
  const ranges: Array<{ start: number; end: number; property: string }> = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].offset <= toolObjectStart) continue;
    const match = lines[index].text.match(propertyPattern);
    const property = match?.[2];
    if (
      !match ||
      match[1].length !== propertyIndent ||
      !property ||
      !headlessRenderProperties.has(property)
    ) continue;
    let end: number | undefined;
    for (let next = index + 1; next < lines.length; next += 1) {
      const nextMatch = lines[next].text.match(propertyPattern);
      const nextIndent = lines[next].text.match(/^(\s*)/)![1].length;
      if (
        (nextMatch && nextMatch[1].length === propertyIndent) ||
        (nextIndent < propertyIndent && lines[next].text.trimStart().startsWith("}"))
      ) {
        end = lines[next].offset;
        break;
      }
    }
    if (end === undefined) fail(`headless tool render property has no boundary: ${path}.${property}`);
    ranges.push({ start: lines[index].offset, end, property });
  }
  for (let index = 1; index < ranges.length; index += 1) {
    if (ranges[index].start < ranges[index - 1].end) {
      fail(`overlapping headless tool render properties: ${path}`);
    }
  }
  let transformed = source;
  for (const range of [...ranges].reverse()) {
    transformed = `${transformed.slice(0, range.start)}${transformed.slice(range.end)}`;
  }
  removedToolRenderProperties.set(path, ranges.map(range => range.property));
  return transformed;
}

function transformHeadlessCliEntry(source: string): string {
  const startMarker = "  // For all other paths, load the startup profiler";
  const endMarker = "\n}\n\n// eslint-disable-next-line custom-rules/no-top-level-side-effects";
  const replacement = `  const optionEquals = (name: string, value: string): boolean => {
    const index = args.indexOf(name)
    return index >= 0 && args[index + 1] === value
  }
  const explicitPrint = args.includes('-p') || args.includes('--print')
  const pythonSdkStreamJson =
    optionEquals('--input-format', 'stream-json') &&
    optionEquals('--output-format', 'stream-json') &&
    process.env.CLAUDE_CODE_ENTRYPOINT === 'sdk-py' &&
    typeof process.env.CLAUDE_AGENT_SDK_VERSION === 'string' &&
    process.env.CLAUDE_AGENT_SDK_VERSION.length > 0
  const mcpManagement = args[0] === 'mcp'
  if (!explicitPrint && !pythonSdkStreamJson && !mcpManagement) {
    process.stderr.write('Error: this local core accepts only print, authenticated Python SDK stream-json, or MCP management mode\\n');
    process.exitCode = 2;
    return;
  }

  if (mcpManagement) {
    const { runMcpManagement } = await import('../cli/handlers/autoMode.js')
    await runMcpManagement(args.slice(1))
    return
  }

  const { main: cliMain } = await import('../main.js');
  await cliMain();`;
  return replaceUniqueSpan(
    source,
    startMarker,
    endMarker,
    replacement,
    "headless-cli-entry-v1.dispatchSpan",
  );
}

function transformHeadlessMain(source: string): string {
  let transformed = replaceUnique(
    source,
    "const getTeammateModeSnapshot = () => require('./utils/swarm/backends/teammateModeSnapshot.js') as typeof import('./utils/swarm/backends/teammateModeSnapshot.js');\n",
    "",
    "headless-main-v1.teammateSnapshotImport",
  );
  transformed = replaceUnique(
    transformed,
    "        getTeammateModeSnapshot().setCliTeammateModeOverride?.(teammateOpts.teammateMode);\n",
    "",
    "headless-main-v1.teammateSnapshotOverride",
  );
  transformed = replaceUnique(
    transformed,
    "import { computeInitialTeamContext } from './utils/swarm/reconnection.js';\n",
    "",
    "headless-main-v1.teamContextImport",
  );
  transformed = replaceUnique(
    transformed,
    "const getTeammateUtils = () => require('./utils/teammate.js') as typeof import('./utils/teammate.js');\n",
    "",
    "headless-main-v1.teammateUtilsImport",
  );
  transformed = replaceUnique(
    transformed,
    "const getTeammatePromptAddendum = () => require('./utils/swarm/teammatePromptAddendum.js') as typeof import('./utils/swarm/teammatePromptAddendum.js');\n",
    "",
    "headless-main-v1.teammatePromptImport",
  );
  transformed = replaceUniqueSpan(
    transformed,
    "    // Declared outside the if block so it's accessible later for system prompt addendum",
    "    // Extract remote sdk options",
    "",
    "headless-main-v1.teammateOptions",
  );
  transformed = replaceUniqueSpan(
    transformed,
    "    // Add teammate-specific system prompt addendum for tmux teammates",
    "    const {\n      mode: permissionMode,",
    "",
    "headless-main-v1.teammatePrompt",
  );
  transformed = replaceUnique(
    transformed,
    "      teamContext: feature('KAIROS') ? assistantTeamContext ?? computeInitialTeamContext?.() : computeInitialTeamContext?.()",
    "      teamContext: undefined",
    "headless-main-v1.teamContextState",
  );
  transformed = replaceUnique(
    transformed,
    "import { migrateReplBridgeEnabledToRemoteControlAtStartup } from './migrations/migrateReplBridgeEnabledToRemoteControlAtStartup.js';\n",
    "",
    "headless-main-v1.remoteMigrationImport",
  );
  transformed = replaceUnique(
    transformed,
    "    migrateReplBridgeEnabledToRemoteControlAtStartup();\n",
    "",
    "headless-main-v1.remoteMigrationCall",
  );
  for (const [marker, label] of [
    ["import { migrateAutoUpdatesToSettings } from './migrations/migrateAutoUpdatesToSettings.js';\n", "autoUpdateMigrationImport"],
    ["    migrateAutoUpdatesToSettings();\n", "autoUpdateMigrationCall"],
    ["import { assertMinVersion } from './utils/autoUpdater.js';\n", "minimumVersionImport"],
    ["    void assertMinVersion();\n", "minimumVersionCall"],
    ["import { initBuiltinPlugins } from './plugins/bundled/index.js';\n", "builtinPluginImport"],
    ["import { initBundledSkills } from './skills/bundled/index.js';\n", "bundledSkillImport"],
    ["      initBuiltinPlugins();\n", "builtinPluginInit"],
    ["      initBundledSkills();\n", "bundledSkillInit"],
  ] as const) {
    transformed = replaceUnique(
      transformed,
      marker,
      "",
      `headless-main-v1.${label}`,
    );
  }
  transformed = replaceUnique(
    transformed,
    "  const hasPrintFlag = cliArgs.includes('-p') || cliArgs.includes('--print');",
    "  const hasPrintFlag = true;",
    "headless-main-v1.hasPrintFlag",
  );
  transformed = replaceUnique(
    transformed,
    "  const isNonInteractive = hasPrintFlag || hasInitOnlyFlag || hasSdkUrl || !process.stdout.isTTY;",
    "  const isNonInteractive = true;",
    "headless-main-v1.isNonInteractive",
  );
  transformed = replaceUnique(
    transformed,
    `    // Get isNonInteractiveSession from state (was set before init())
    const isNonInteractiveSession = getIsNonInteractiveSession();`,
    `    // SDK-headless build invariant; bound to the reviewed main.tsx digest.
    const isNonInteractiveSession = true;`,
    "headless-main-v1.actionSession",
  );
  transformed = replaceUnique(
    transformed,
    "  void getRelevantTips();",
    "  // Interactive tip prewarming is not part of SDK print mode.",
    "headless-main-v1.tipPrewarm",
  );
  transformed = replaceUnique(
    transformed,
    "        void import('./utils/backgroundHousekeeping.js').then(m => m.startBackgroundHousekeeping());\n",
    "",
    "headless-main-v1.backgroundHousekeeping",
  );
  transformed = replaceUnique(
    transformed,
    `  if (isEnvTruthy(process.env.CLAUDE_CODE_USE_BEDROCK) && !isEnvTruthy(process.env.CLAUDE_CODE_SKIP_BEDROCK_AUTH)) {
    void prefetchAwsCredentialsAndBedRockInfoIfSafe();
  }`,
    "  // Bedrock credential prefetch is outside the authorized gateway topology.",
    "headless-main-v1.bedrockCredentialPrefetch",
  );
  transformed = replaceUnique(
    transformed,
    `  if (isEnvTruthy(process.env.CLAUDE_CODE_USE_VERTEX) && !isEnvTruthy(process.env.CLAUDE_CODE_SKIP_VERTEX_AUTH)) {
    void prefetchGcpCredentialsIfSafe();
  }`,
    "  // Vertex credential prefetch is outside the authorized gateway topology.",
    "headless-main-v1.vertexCredentialPrefetch",
  );
  transformed = replaceUnique(
    transformed,
    `  const isPrintMode = process.argv.includes('-p') || process.argv.includes('--print');
  const isCcUrl = process.argv.some(a => a.startsWith('cc://') || a.startsWith('cc+unix://'));
  if (isPrintMode && !isCcUrl) {
    profileCheckpoint('run_before_parse');
    await program.parseAsync(process.argv);
    profileCheckpoint('run_after_parse');
    return program;
  }`,
    `  // SDK-headless build invariant: management registration below is unreachable.
  profileCheckpoint('run_before_parse');
  await program.parseAsync(process.argv);
  profileCheckpoint('run_after_parse');
  return program;`,
    "headless-main-v1.unconditionalParseReturn",
  );
  transformed = replaceUnique(
    transformed,
    "import { filterCommandsForRemoteMode, getCommands } from './commands.js';",
    "import { getCommands } from './commands.js';",
    "headless-main-v1.commandImport",
  );
  transformed = replaceUniqueSpan(
    transformed,
    "\n    // Log model config at startup",
    "\n  }).version(`${MACRO.VERSION} (Claude Code)`, '-v, --version', 'Output the version number');",
    "",
    "headless-main-v1.interactiveActionSpan",
  );
  transformed = replaceUniqueSpan(
    transformed,
    "\n    // Ink root is only needed for interactive sessions",
    "\n    // If gracefulShutdown was initiated",
    "",
    "headless-main-v1.interactiveSetupSpan",
  );
  transformed = replaceUniqueSpan(
    transformed,
    "\n    // Show settings validation errors after trust is established",
    "\n    // Check quota status, fast mode, passes eligibility, and bootstrap data",
    "",
    "headless-main-v1.settingsDialogSpan",
  );
  transformed = replaceUniqueSpan(
    transformed,
    "\n  // claude mcp\n",
    "\n}\nasync function logTenguInit",
    "\n",
    "headless-main-v1.managementRegistrationSpan",
  );
  return pruneUnusedBoundImports(transformed, "src/main.tsx");
}

function transformHeadlessAgentTool(source: string): string {
  let transformed = replaceUnique(
    source,
    "import * as React from 'react';\n",
    "",
    "headless-agent-tool-v1.reactImport",
  );
  transformed = replaceUnique(
    transformed,
    `const isBackgroundTasksDisabled =
// eslint-disable-next-line custom-rules/no-process-env-top-level -- Intentional: schema must be defined at module load
isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS);`,
    `// SDK-headless core omits TaskOutput/TaskStop, so asynchronous agents are
// unavailable by construction while ordinary synchronous Agent calls remain.
const isBackgroundTasksDisabled = true;`,
    "headless-agent-tool-v1.backgroundTasksDisabled",
  );
  transformed = replaceUnique(
    transformed,
    "import { BackgroundHint } from '../BashTool/UI.js';\n",
    "",
    "headless-agent-tool-v1.backgroundHintImport",
  );
  transformed = replaceUnique(
    transformed,
    "import { renderGroupedAgentToolUse, renderToolResultMessage, renderToolUseErrorMessage, renderToolUseMessage, renderToolUseProgressMessage, renderToolUseRejectedMessage, renderToolUseTag, userFacingName, userFacingNameBackgroundColor } from './UI.js';\n",
    "",
    "headless-agent-tool-v1.uiImport",
  );
  for (const [specifier, label] of [
    ["import { isAgentSwarmsEnabled } from '../../utils/agentSwarmsEnabled.js';\n", "swarmGateImport"],
    ["import { getParentSessionId, isTeammate } from '../../utils/teammate.js';\n", "teammateImport"],
    ["import { isInProcessTeammate } from '../../utils/teammateContext.js';\n", "teammateContextImport"],
    ["import { spawnTeammate } from '../shared/spawnMultiAgent.js';\n", "spawnImport"],
    ["import { checkRemoteAgentEligibility, formatPreconditionError, getRemoteTaskSessionUrl, registerRemoteAgentTask } from '../../tasks/RemoteAgentTask/RemoteAgentTask.js';\n", "remoteTaskImport"],
    ["import { teleportToRemote } from '../../utils/teleport.js';\n", "teleportImport"],
  ] as const) {
    transformed = replaceUnique(
      transformed,
      specifier,
      label === "teammateImport"
        ? "import { getParentSessionId } from '../../utils/teammate.js';\n"
        : "",
      `headless-agent-tool-v1.${label}`,
    );
  }
  transformed = transformed
    .replaceAll("isInProcessTeammate()", "false")
    .replaceAll("isTeammate()", "false");
  if (/\bis(?:InProcess)?Teammate\s*\(/.test(transformed)) {
    fail("headless-agent-tool-v1 retained teammate predicate calls");
  }
  transformed = replaceUniqueSpan(
    transformed,
    "    // Check if user is trying to use agent teams without access",
    "    // Fork subagent experiment routing:",
    "",
    "headless-agent-tool-v1.teammateSpawn",
  );
  transformed = replaceUniqueSpan(
    transformed,
    "    // Multi-agent spawn result",
    "    if ('status' in internalData && internalData.status === 'remote_launched') {",
    "",
    "headless-agent-tool-v1.teammateResult",
  );
  transformed = replaceUniqueSpan(
    transformed,
    "    // Remote isolation: delegate to CCR.",
    "    // System prompt + prompt messages: branch on fork path.",
    "",
    "headless-agent-tool-v1.remoteIsolation",
  );
  transformed = replaceUniqueSpan(
    transformed,
    "    if ('status' in internalData && internalData.status === 'remote_launched') {",
    "    if (data.status === 'async_launched') {",
    "",
    "headless-agent-tool-v1.remoteResult",
  );
  transformed = replaceUniqueTail(
    transformed,
    "function resolveTeamName(input:",
    "",
    "headless-agent-tool-v1.teamResolver",
  );
  transformed = replaceUnique(
    transformed,
    `            // Show background hint after threshold (but task is already registered)
            // Skip if background tasks are disabled
            if (!isBackgroundTasksDisabled && !backgroundHintShown && elapsed >= PROGRESS_THRESHOLD_MS && toolUseContext.setToolJSX) {
              backgroundHintShown = true;
              toolUseContext.setToolJSX({
                jsx: <BackgroundHint />,
                shouldHidePromptInput: false,
                shouldContinueAnimation: true,
                showSpinner: true
              });
            }

`,
    "",
    "headless-agent-tool-v1.progressJsx",
  );
  transformed = replaceUnique(
    transformed,
    `  userFacingName,
  userFacingNameBackgroundColor,
`,
    "",
    "headless-agent-tool-v1.userFacingNames",
  );
  transformed = replaceUnique(
    transformed,
    `  renderToolResultMessage,
  renderToolUseMessage,
  renderToolUseTag,
  renderToolUseProgressMessage,
  renderToolUseRejectedMessage,
  renderToolUseErrorMessage,
  renderGroupedToolUse: renderGroupedAgentToolUse
`,
    "",
    "headless-agent-tool-v1.renderProperties",
  );
  return transformed;
}

function transformHeadlessTool(source: string, path: string): string {
  let transformed = source;
  if (
    path === "src/tools/BashTool/BashTool.tsx" ||
    path === "src/tools/PowerShellTool/PowerShellTool.tsx"
  ) {
    transformed = replaceUnique(
      transformed,
      `const isBackgroundTasksDisabled =
// eslint-disable-next-line custom-rules/no-process-env-top-level -- Intentional: schema must be defined at module load
isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS);`,
      `// SDK-headless core omits TaskOutput/TaskStop, so shell backgrounding is
// unavailable by construction while ordinary foreground commands remain.
const isBackgroundTasksDisabled = true;`,
      `headless-tool-v1.${path.includes("PowerShell") ? "powerShell" : "bash"}.backgroundTasksDisabled`,
    );
  }
  if (path === "src/tools/AskUserQuestionTool/AskUserQuestionTool.tsx") {
    transformed = replaceUniqueSpan(
      transformed,
      "function AskUserQuestionResultMessage",
      "export const AskUserQuestionTool",
      "",
      "headless-tool-v1.askUserResultUiHelpers",
    );
  }
  if (path === "src/tools/BashTool/BashTool.tsx") {
    transformed = replaceUniqueSpan(
      transformed,
      "      // Show minimal backgrounding UI if available",
      "      yield {",
      "",
      "headless-tool-v1.bashProgressJsx",
    );
  }
  if (path === "src/tools/PowerShellTool/PowerShellTool.tsx") {
    transformed = replaceUniqueSpan(
      transformed,
      "      // Show backgrounding UI hint after threshold",
      "      yield {",
      "",
      "headless-tool-v1.powerShellProgressJsx",
    );
  }
  transformed = removeHeadlessToolRenderProperties(transformed, path);
  if (path === "src/tools/TaskOutputTool/TaskOutputTool.tsx") {
    transformed = replaceUniqueSpan(
      transformed,
      "function TaskOutputResultDisplay",
      "//# sourceMappingURL=",
      "",
      "headless-tool-v1.taskOutputResultUiHelper",
    );
  }
  return pruneUnusedBoundImports(transformed, path);
}

function transformHeadlessCommands(source: string): string {
  const headlessImportsAndRegistry = `import { feature } from 'bun:bundle'
import { logError } from './utils/log.js'
import { toError } from './utils/errors.js'
import { logForDebugging } from './utils/debug.js'
import { getSkillDirCommands, clearSkillCaches, getDynamicSkills } from './skills/loadSkillsDir.js'
import { getPluginCommands, clearPluginCommandCache, getPluginSkills, clearPluginSkillsCache } from './utils/plugins/loadPluginCommands.js'
import memoize from 'lodash-es/memoize.js'
import { isUsing3PServices, isClaudeAISubscriber } from './utils/auth.js'
import { isFirstPartyAnthropicBaseUrl } from './utils/model/providers.js'
import { type Command, getCommandName, isCommandEnabled } from './types/command.js'

export type { Command, CommandBase, CommandResultDisplay, LocalCommandResult, LocalJSXCommandContext, PromptCommand, ResumeEntrypoint } from './types/command.js'
export { getCommandName, isCommandEnabled } from './types/command.js'

const clearSkillIndexCache = feature('EXPERIMENTAL_SKILL_SEARCH')
  ? (require('./services/skillSearch/localSearch.js') as typeof import('./services/skillSearch/localSearch.js')).clearSkillIndexCache
  : null

export const INTERNAL_ONLY_COMMANDS: Command[] = []
const COMMANDS = memoize((): Command[] => [])
export const builtInCommandNames = memoize((): Set<string> => new Set())

export function findCommand(commandName: string, commands: Command[]): Command | undefined {
  return commands.find(
    command =>
      command.name === commandName ||
      getCommandName(command) === commandName ||
      command.aliases?.includes(commandName),
  )
}

export function hasCommand(commandName: string, commands: Command[]): boolean {
  return findCommand(commandName, commands) !== undefined
}

export function getCommand(commandName: string, commands: Command[]): Command {
  const command = findCommand(commandName, commands)
  if (!command) {
    throw new ReferenceError(\`Command \${commandName} not found\`)
  }
  return command
}

export function isBridgeSafeCommand(command: Command): boolean {
  return command.type === 'prompt'
}

export function formatDescriptionWithSource(command: Command): string {
  if (command.type !== 'prompt') return command.description
  if (command.kind === 'workflow') return \`\${command.description} (workflow)\`
  if (command.source === 'plugin') {
    const pluginName = command.pluginInfo?.pluginManifest.name
    return pluginName
      ? \`(\${pluginName}) \${command.description}\`
      : \`\${command.description} (plugin)\`
  }
  if (command.source === 'bundled') return \`\${command.description} (bundled)\`
  return command.description
}

`;
  let transformed = replaceUniqueSpan(
    source,
    "import addDir from './commands/add-dir/index.js'",
    "async function getSkills",
    headlessImportsAndRegistry,
    "headless-commands-v1.builtinRegistrySpan",
  );
  transformed = replaceUniqueTail(
    transformed,
    "\n/**\n * Commands that are safe to use in remote mode",
    "",
    "headless-commands-v1.remoteUiCommandsSpan",
  );
  transformed = replaceUnique(
    transformed,
    "    const bundledSkills = getBundledSkills()",
    "    const bundledSkills: Command[] = []",
    "headless-commands-v1.noBundledSkills",
  );
  transformed = replaceUnique(
    transformed,
    "    const builtinPluginSkills = getBuiltinPluginSkillCommands()",
    "    const builtinPluginSkills: Command[] = []",
    "headless-commands-v1.noBuiltinPluginSkills",
  );
  return transformed;
}

function transformHeadlessRuntimeUi(source: string, path: string): string {
  if (path === "src/cli/print.ts") {
    let transformed = replaceUniqueSpan(
      source,
      "  // Bridge handle for remote-control (SDK control message).",
      "  // Helper to apply MCP server changes",
      "",
      "headless-runtime-ui-v1.print.bridgeState",
    );
    transformed = replaceUniqueSpan(
      transformed,
      "import {\n  downloadUserSettings,",
      "import { waitForRemoteManagedSettingsToLoad } from 'src/services/remoteManagedSettings/index.js'",
      "",
      "headless-runtime-ui-v1.print.remoteSettingsSyncImport",
    );
    transformed = replaceUniqueSpan(
      transformed,
      "  // Fire user settings download now so it overlaps with the MCP/tool setup",
      "  // In headless mode there is no React tree",
      "",
      "headless-runtime-ui-v1.print.remoteSettingsSyncPreload",
    );
    transformed = replaceUniqueSpan(
      transformed,
      "      await Promise.all([\n        feature('DOWNLOAD_USER_SETTINGS')",
      "\n\n      const pluginsInstalled = await installPluginsForHeadless()",
      `      await withDiagnosticsTiming('headless_managed_settings_wait', () =>
        waitForRemoteManagedSettingsToLoad(),
      )`,
      "headless-runtime-ui-v1.print.remoteSettingsSyncInstallWait",
    );
    transformed = replaceUniqueSpan(
      transformed,
      "            if (\n              feature('DOWNLOAD_USER_SETTINGS')",
      "\n\n            const r = await refreshActivePlugins(setAppState)",
      "",
      "headless-runtime-ui-v1.print.remoteSettingsSyncReload",
    );
    transformed = replaceUnique(
      transformed,
      "import { RemoteIO } from 'src/cli/remoteIO.js'\n",
      "",
      "headless-runtime-ui-v1.print.remoteIoImport",
    );
    transformed = replaceUnique(
      transformed,
      `          if (structuredIO instanceof RemoteIO && command.mode === 'prompt') {
            logEvent('tengu_bridge_message_received', {
              is_repl: false,
            })
          }

`,
      "",
      "headless-runtime-ui-v1.print.remoteIoEvent",
    );
    transformed = replaceUnique(
      transformed,
      `  // Use RemoteIO if sdkUrl is provided, otherwise use regular StructuredIO
  return options.sdkUrl
    ? new RemoteIO(options.sdkUrl, inputStream, options.replayUserMessages)
    : new StructuredIO(inputStream, options.replayUserMessages)`,
      `  if (options.sdkUrl) throw new Error('Remote SDK transport is unavailable')
  return new StructuredIO(inputStream, options.replayUserMessages)`,
      "headless-runtime-ui-v1.print.remoteIoFactory",
    );
    transformed = replaceUnique(
      transformed,
      "        value: await resolveAndPrepend(message, message.message.content),",
      "        value: message.message.content,",
      "headless-runtime-ui-v1.print.bridgeAttachment",
    );
    transformed = replaceUniqueSpan(
      transformed,
      "    // Check for unread teammate messages and process them",
      "    if (inputClosed) {",
      "",
      "headless-runtime-ui-v1.print.teammatePoll",
    );
    transformed = replaceUnique(
      transformed,
      "          // Forward messages to bridge after each turn\n          forwardMessagesToBridge()\n          bridgeHandle?.sendResult()\n\n",
      "",
      "headless-runtime-ui-v1.print.bridgeForward",
    );
    transformed = replaceUnique(
      transformed,
      "              forwardMessagesToBridge()\n",
      "",
      "headless-runtime-ui-v1.print.bridgeProgressForward",
    );
    transformed = replaceUniqueSpan(
      transformed,
      "        } else if (message.request.subtype === 'remote_control') {",
      "        } else {\n          // Unknown control request subtype",
      "",
      "headless-runtime-ui-v1.print.remoteControl",
    );
    transformed = replaceUniqueSpan(
      transformed,
      "  // Handle teleport in print mode",
      "  // Handle resume in print mode",
      `  if (options.teleport) {
    logError(new Error('Remote sessions are unavailable in the local SDK-headless core'))
    gracefulShutdownSync(1)
    return { messages: [] }
  }

`,
      "headless-runtime-ui-v1.print.teleport",
    );
    return pruneUnusedBoundImports(transformed, path);
  }
  if (path === "src/QueryEngine.ts") {
    let transformed = replaceUniqueSpan(
      source,
      "// Lazy: MessageSelector.tsx pulls React/ink; only needed for message filtering at query time",
      "import {\n  localCommandOutputToSDKAssistantMessage,",
      `// SDK-headless copy of the pure message predicate; the React selector is excluded.
const selectableUserMessagesFilter = (message: Message): boolean => {
  if (message.type !== 'user') return false
  if (Array.isArray(message.message.content) && message.message.content[0]?.type === 'tool_result') return false
  if (isSyntheticMessage(message) || message.isMeta || message.isCompactSummary || message.isVisibleInTranscriptOnly) return false
  const content = message.message.content
  const lastBlock = typeof content === 'string' ? null : content[content.length - 1]
  const text = typeof content === 'string'
    ? content.trim()
    : lastBlock?.type === 'text' ? lastBlock.text.trim() : ''
  return ![
    LOCAL_COMMAND_STDOUT_TAG, LOCAL_COMMAND_STDERR_TAG, BASH_STDOUT_TAG,
    BASH_STDERR_TAG, TASK_NOTIFICATION_TAG, TICK_TAG, TEAMMATE_MESSAGE_TAG,
  ].some(tag => text.includes(\`<\${tag}\`))
}

`,
      "headless-runtime-ui-v1.messageSelector",
    );
    transformed = replaceUnique(
      transformed,
      `  LOCAL_COMMAND_STDERR_TAG,
  LOCAL_COMMAND_STDOUT_TAG,`,
      `  LOCAL_COMMAND_STDERR_TAG,
  LOCAL_COMMAND_STDOUT_TAG,
  BASH_STDERR_TAG,
  BASH_STDOUT_TAG,
  TASK_NOTIFICATION_TAG,
  TEAMMATE_MESSAGE_TAG,
  TICK_TAG,`,
      "headless-runtime-ui-v1.messageSelectorTags",
    );
    transformed = replaceUnique(
      transformed,
      "import { countToolCalls, SYNTHETIC_MESSAGES } from './utils/messages.js'",
      "import { countToolCalls, isSyntheticMessage, SYNTHETIC_MESSAGES } from './utils/messages.js'",
      "headless-runtime-ui-v1.messageSelectorSynthetic",
    );
    transformed = transformed.replaceAll(
      "messageSelector().selectableUserMessagesFilter",
      "selectableUserMessagesFilter",
    );
    if (transformed.includes("messageSelector()")) {
      fail("headless-runtime-ui-v1.messageSelector retained a selector call");
    }
    return transformed;
  }
  if (path === "src/entrypoints/init.ts") {
    let transformed = replaceUniqueSpan(
      source,
      "      if (getIsNonInteractiveSession()) {",
      "      // Dialog itself handles process.exit, so we don't need additional cleanup here",
      `      process.stderr.write(
        \`Configuration error in \${error.filePath}: \${error.message}\\n\`,
      )
      gracefulShutdownSync(1)
      return

`,
      "headless-runtime-ui-v1.invalidConfigDialog",
    );
    for (const [specifier, label] of [
      ["import type { Attributes, MetricOptions } from '@opentelemetry/api'\n", "otelTypes"],
      ["import { getIsNonInteractiveSession } from 'src/bootstrap/state.js'\n", "sessionMode"],
      ["import type { AttributedCounter } from '../bootstrap/state.js'\n", "counterType"],
      ["import { getSessionCounter, setMeter } from '../bootstrap/state.js'\n", "meterState"],
      ["import { shutdownLspServerManager } from '../services/lsp/manager.js'\n", "lspShutdown"],
      ["import { detectCurrentRepository } from '../utils/detectRepository.js'\n", "repositoryDetection"],
      ["import { initJetBrainsDetection } from '../utils/envDynamic.js'\n", "jetbrains"],
      ["import { isEnvTruthy } from '../utils/envUtils.js'\n", "remoteEnv"],
      ["import { ConfigParseError, errorMessage } from '../utils/errors.js'\n", "telemetryError"],
      ["import { isBetaTracingEnabled } from '../utils/telemetry/betaSessionTracing.js'\n", "betaTracing"],
      ["import { getTelemetryAttributes } from '../utils/telemetryAttributes.js'\n", "telemetryAttributes"],
    ] as const) {
      transformed = replaceUnique(
        transformed,
        specifier,
        label === "telemetryError"
          ? "import { ConfigParseError } from '../utils/errors.js'\n"
          : "",
        `headless-runtime-ui-v1.init.${label}`,
      );
    }
    transformed = replaceUniqueSpan(
      transformed,
      "import {\n  initializePolicyLimitsLoadingPromise,",
      "import { applyExtraCACertsFromConfig } from '../utils/caCertsConfig.js'",
      "",
      "headless-runtime-ui-v1.init.remotePolicyImports",
    );
    transformed = replaceUniqueSpan(
      transformed,
      "import {\n  applyConfigEnvironmentVariables,",
      "import { configureGlobalMTLS } from '../utils/mtls.js'",
      "import { applySafeConfigEnvironmentVariables } from '../utils/managedEnv.js'\n",
      "headless-runtime-ui-v1.init.remoteEnvImport",
    );
    transformed = replaceUniqueSpan(
      transformed,
      "// initialize1PEventLogging is dynamically imported",
      "export const init = memoize",
      "",
      "headless-runtime-ui-v1.init.telemetryState",
    );
    transformed = replaceUniqueSpan(
      transformed,
      "    // Initialize 1P event logging",
      "    // Populate OAuth account info",
      "",
      "headless-runtime-ui-v1.init.firstPartyAnalytics",
    );
    transformed = replaceUniqueSpan(
      transformed,
      "    // Initialize JetBrains IDE detection asynchronously",
      "    // Record the first start time",
      "",
      "headless-runtime-ui-v1.init.ideRemotePolicy",
    );
    transformed = replaceUniqueSpan(
      transformed,
      "    // Preconnect to the Anthropic API",
      "    // Set up git-bash if relevant",
      "",
      "headless-runtime-ui-v1.init.preconnectRemoteRelay",
    );
    transformed = replaceUnique(
      transformed,
      "    // Register LSP manager cleanup (initialization happens in main.tsx after --plugin-dir is processed)\n    registerCleanup(shutdownLspServerManager)\n\n",
      "",
      "headless-runtime-ui-v1.init.lspCleanup",
    );
    transformed = replaceUniqueSpan(
      transformed,
      "    // gh-32730: teams created by subagents",
      "    // Initialize scratchpad directory if enabled",
      "",
      "headless-runtime-ui-v1.init.teamCleanup",
    );
    transformed = replaceUniqueTail(
      transformed,
      "/**\n * Initialize telemetry after trust has been granted.",
      `/** SDK-headless core intentionally exposes a telemetry no-op. */
export function initializeTelemetryAfterTrust(): void {}
`,
      "headless-runtime-ui-v1.init.telemetryTail",
    );
    return pruneUnusedBoundImports(transformed, path);
  }
  if (path === "src/services/mcp/client.ts") {
    let transformed = replaceUniqueSpan(
      source,
      "// Lazy: toolRendering.tsx pulls React/ink; only needed when Claude-in-Chrome MCP server is connected",
      "// Lazy: wrapper.tsx → hostAdapter.ts → executor.ts pulls both native modules",
      "",
      "headless-runtime-ui-v1.chromeMcpRenderingLoader",
    );
    transformed = replaceUniqueSpan(
      transformed,
      "            ...(isClaudeInChromeMCPServer(client.name) &&",
      "            ...(feature('CHICAGO_MCP') &&",
      "",
      "headless-runtime-ui-v1.chromeMcpRenderingOverrides",
    );
    transformed = replaceUniqueSpan(
      transformed,
      "      } else if (\n        (serverRef.type === 'stdio' || !serverRef.type) &&\n        isClaudeInChromeMCPServer(name)",
      "      } else if (\n        feature('CHICAGO_MCP') &&",
      "",
      "headless-runtime-ui-v1.chromeMcpInProcessServer",
    );
    return pruneUnusedBoundImports(transformed, path);
  }
  if (path === "src/cli/handlers/mcp.tsx") {
    let transformed = replaceUniqueSpan(
      source,
      "export async function mcpAddFromDesktopHandler",
      "export async function mcpResetChoicesHandler",
      "",
      "headless-runtime-ui-v1.mcp.desktopImportHandler",
    );
    for (const [specifier, label] of [
      ["import React from 'react';\n", "react"],
      ["import { MCPServerDesktopImportDialog } from '../../components/MCPServerDesktopImportDialog.js';\n", "dialog"],
      ["import { render } from '../../ink.js';\n", "ink"],
      ["import { KeybindingSetup } from '../../keybindings/KeybindingProviderSetup.js';\n", "keybindings"],
      ["import { AppStateProvider } from '../../state/AppState.js';\n", "appState"],
    ] as const) {
      transformed = replaceUnique(
        transformed,
        specifier,
        "",
        `headless-runtime-ui-v1.mcp.${label}`,
      );
    }
    return pruneUnusedBoundImports(transformed, path);
  }
  if (path === "src/cli/handlers/auth.ts") {
    const transformed = replaceUniqueTail(
      source,
      "export async function authLogin",
      "",
      "headless-runtime-ui-v1.authManagementTail",
    );
    return pruneUnusedBoundImports(transformed, path);
  }
  if (path === "src/commands/logout/logout.tsx") {
    let transformed = replaceUniqueSpan(
      source,
      "export async function call",
      "//# sourceMappingURL=",
      "",
      "headless-runtime-ui-v1.logoutRenderCall",
    );
    transformed = replaceUnique(
      transformed,
      "import { clearTrustedDeviceTokenCache } from '../../bridge/trustedDevice.js';\n",
      "",
      "headless-runtime-ui-v1.logoutTrustedDeviceImport",
    );
    transformed = replaceUnique(
      transformed,
      "  clearTrustedDeviceTokenCache();\n",
      "",
      "headless-runtime-ui-v1.logoutTrustedDeviceCache",
    );
    transformed = pruneUnusedBoundImports(transformed, path);
    return transformed;
  }
  if (path === "src/utils/processUserInput/processSlashCommand.tsx") {
    let transformed = replaceUnique(
      source,
      "import { renderToolUseProgressMessage } from '../../tools/AgentTool/UI.js';\n",
      "",
      "headless-runtime-ui-v1.slashAgentProgressImport",
    );
    transformed = replaceUniqueSpan(
      transformed,
      "  // Helper to update progress display using agent progress UI",
      "  // Run the sub-agent",
      "",
      "headless-runtime-ui-v1.slashAgentProgressSetup",
    );
    transformed = replaceUnique(
      transformed,
      `          progressMessages.push(createProgressMessage(message));
          updateProgress();`,
      "",
      "headless-runtime-ui-v1.slashAssistantProgress",
    );
    transformed = replaceUnique(
      transformed,
      `          progressMessages.push(createProgressMessage(normalizedMsg));
          updateProgress();`,
      "",
      "headless-runtime-ui-v1.slashUserProgress",
    );
    transformed = replaceUnique(
      transformed,
      `  } finally {
    // Clear the progress display
    setToolJSX(null);
  }`,
      "  } finally {\n    // Headless execution has no progress render target.\n  }",
      "headless-runtime-ui-v1.slashProgressFinally",
    );
    return transformed;
  }
  if (path === "src/tools/FileWriteTool/UI.tsx") {
    return `import type { Output } from './FileWriteTool.js';

const MAX_LINES_TO_RENDER = 10;
const EOL = '\\n';

export function isResultTruncated({ type, content }: Output): boolean {
  if (type !== 'create') return false;
  let pos = 0;
  for (let i = 0; i < MAX_LINES_TO_RENDER; i++) {
    pos = content.indexOf(EOL, pos);
    if (pos === -1) return false;
    pos++;
  }
  return pos < content.length;
}
`;
  }
  if (path === "src/components/CtrlOToExpand.tsx") {
    return `import chalk from 'chalk';
import { getShortcutDisplay } from '../keybindings/shortcutFormat.js';

export function ctrlOToExpand(): string {
  const shortcut = getShortcutDisplay('app:toggleTranscript', 'Global', 'ctrl+o');
  return chalk.dim(\`(\${shortcut} to expand)\`);
}
`;
  }
  if (path === "src/utils/teleport.tsx") {
    let transformed = replaceUnique(
      source,
      "import React from 'react';\n",
      "",
      "headless-runtime-ui-v1.teleportReactImport",
    );
    transformed = replaceUnique(
      transformed,
      "import { getTeleportErrors, TeleportError, type TeleportLocalErrorType } from '../components/TeleportError.js';\n",
      "",
      "headless-runtime-ui-v1.teleportErrorUiImport",
    );
    transformed = replaceUnique(
      transformed,
      "import type { Root } from '../ink.js';\n",
      "",
      "headless-runtime-ui-v1.teleportInkImport",
    );
    transformed = replaceUnique(
      transformed,
      "import { KeybindingSetup } from '../keybindings/KeybindingProviderSetup.js';\n",
      "",
      "headless-runtime-ui-v1.teleportKeybindingUiImport",
    );
    transformed = replaceUnique(
      transformed,
      "import { AppStateProvider } from '../state/AppState.js';\n",
      "",
      "headless-runtime-ui-v1.teleportAppStateUiImport",
    );
    return replaceUniqueSpan(
      transformed,
      "/**\n * Helper function to handle teleport prerequisites (authentication and git state)",
      "/**\n * Fetches session data from the session ingress API (/v1/session_ingress/)",
      "",
      "headless-runtime-ui-v1.teleportInteractiveRemoteWrapper",
    );
  }
  if (path === "src/services/remoteManagedSettings/securityCheck.tsx") {
    let transformed = source;
    for (const [specifier, label] of [
      ["import React from 'react';\n", "reactImport"],
      [
        "import { ManagedSettingsSecurityDialog } from '../../components/ManagedSettingsSecurityDialog/ManagedSettingsSecurityDialog.js';\n",
        "dialogImport",
      ],
      ["import { render } from '../../ink.js';\n", "inkImport"],
      [
        "import { KeybindingSetup } from '../../keybindings/KeybindingProviderSetup.js';\n",
        "keybindingImport",
      ],
      ["import { AppStateProvider } from '../../state/AppState.js';\n", "appStateImport"],
      ["import { getBaseRenderOptions } from '../../utils/renderOptions.js';\n", "renderOptionsImport"],
      ["import { logEvent } from '../analytics/index.js';\n", "analyticsImport"],
    ] as const) {
      transformed = replaceUnique(
        transformed,
        specifier,
        "",
        `headless-runtime-ui-v1.managedSettingsSecurity.${label}`,
      );
    }
    return replaceUniqueSpan(
      transformed,
      "  // Log that dialog is being shown",
      "\n}\n\n/**\n * Handle the security check result",
      "  return 'no_check_needed';",
      "headless-runtime-ui-v1.managedSettingsSecurityDialog",
    );
  }
  if (path === "src/utils/ide.ts") {
    let transformed = replaceUniqueSpan(
      source,
      "// Lazy: IdeOnboardingDialog.tsx pulls React/ink; only needed in interactive onboarding path",
      "import { createAbortController } from './abortController.js'",
      "",
      "headless-runtime-ui-v1.ideOnboardingLoader",
    );
    transformed = replaceUniqueSpan(
      transformed,
      "              if (\n                !isAlreadyInstalled &&",
      "            })\n        })",
      "",
      "headless-runtime-ui-v1.ideVsCodeOnboarding",
    );
    transformed = replaceUnique(
      transformed,
      `        void isIDEExtensionInstalled(ideType).then(async installed => {
          if (
            installed &&
            !ideOnboardingDialog().hasIdeOnboardingDialogBeenShown()
          ) {
            onShowIdeOnboarding()
          }
        })`,
      "        void isIDEExtensionInstalled(ideType)",
      "headless-runtime-ui-v1.ideJetBrainsOnboarding",
    );
    return transformed;
  }
  if (path === "src/utils/processUserInput/processBashCommand.tsx") {
    let transformed = replaceUnique(
      source,
      "import * as React from 'react';\n",
      "",
      "headless-runtime-ui-v1.bashInputReactImport",
    );
    transformed = replaceUnique(
      transformed,
      "import { BashModeProgress } from 'src/components/BashModeProgress.js';\n",
      "",
      "headless-runtime-ui-v1.bashInputProgressImport",
    );
    transformed = replaceUnique(
      transformed,
      "import type { ShellProgress } from 'src/types/tools.js';\n",
      "",
      "headless-runtime-ui-v1.bashInputProgressTypeImport",
    );
    transformed = replaceUniqueSpan(
      transformed,
      "  // ctrl+b to background indicator",
      "  try {",
      "",
      "headless-runtime-ui-v1.bashInputInitialProgress",
    );
    transformed = replaceUnique(
      transformed,
      `      // TODO: Clean up this hack
      setToolJSX: _ => {
        jsx = _?.jsx;
      }`,
      `      // Shell execution remains identical; print mode has no JSX target.
      setToolJSX: () => {}`,
      "headless-runtime-ui-v1.bashInputContextProgress",
    );
    transformed = replaceUniqueSpan(
      transformed,
      "    // Progress UI — shared across both shell backends (both emit ShellProgress)",
      "    // User-initiated `!` commands run outside sandbox.",
      "    const onProgress = () => {};\n\n",
      "headless-runtime-ui-v1.bashInputProgressCallback",
    );
    transformed = replaceUnique(
      transformed,
      `  } finally {
    setToolJSX(null);
  }`,
      "  } finally {\n    // Headless execution has no progress render target.\n  }",
      "headless-runtime-ui-v1.bashInputProgressFinally",
    );
    return transformed;
  }
  if (path === "src/tools/shared/spawnMultiAgent.ts") {
    let transformed = replaceUnique(
      source,
      "import React from 'react'\n",
      "",
      "headless-runtime-ui-v1.spawnMultiAgentReactImport",
    );
    transformed = replaceUnique(
      transformed,
      "import { isTmuxAvailable } from '../../utils/swarm/backends/detection.js'\n",
      "",
      "headless-runtime-ui-v1.spawnMultiAgentDetectionImport",
    );
    transformed = replaceUnique(
      transformed,
      "  resetBackendDetection,\n",
      "",
      "headless-runtime-ui-v1.spawnMultiAgentResetImport",
    );
    transformed = replaceUnique(
      transformed,
      "import { It2SetupPrompt } from '../../utils/swarm/It2SetupPrompt.js'\n",
      "",
      "headless-runtime-ui-v1.spawnMultiAgentPromptImport",
    );
    return replaceUniqueSpan(
      transformed,
      "  // If in iTerm2 but it2 isn't set up, prompt the user",
      "  // Check if we're inside tmux to determine session naming",
      `  if (detectionResult.needsIt2Setup) {
    throw new Error(
      'Teammate spawn requires interactive iTerm2 setup, which is unavailable in SDK print mode',
    )
  }

`,
      "headless-runtime-ui-v1.spawnMultiAgentIt2Prompt",
    );
  }
  fail(`unsupported headless runtime UI transform target: ${path}`);
}

function transformHeadlessProvider(source: string, path: string): string {
  if (path === "src/utils/model/providers.ts") {
    let transformed = replaceUnique(
      source,
      "import { isEnvTruthy } from '../envUtils.js'\n",
      "",
      "headless-provider-v1.providerEnvImport",
    );
    transformed = replaceUniqueSpan(
      transformed,
      "export function getAPIProvider(): APIProvider {",
      "\n}\n\nexport function getAPIProviderForStatsig",
      `export function getAPIProvider(): APIProvider {
  return 'firstParty'
`,
      "headless-provider-v1.firstPartyProvider",
    );
    return transformed;
  }
  if (path === "src/services/api/client.ts") {
    const transformed = replaceUniqueSpan(
      source,
      "  if (isEnvTruthy(process.env.CLAUDE_CODE_USE_BEDROCK)) {",
      "  // Determine authentication method based on available tokens",
      "",
      "headless-provider-v1.clientThirdPartyBranches",
    );
    return pruneUnusedBoundImports(transformed, path);
  }
  if (path === "src/utils/model/modelStrings.ts") {
    let transformed = replaceUniqueSpan(
      source,
      "async function getBedrockModelStrings(): Promise<ModelStrings> {",
      "/**\n * Layer user-configured modelOverrides",
      "",
      "headless-provider-v1.bedrockModelDiscovery",
    );
    transformed = replaceUniqueSpan(
      transformed,
      "const updateBedrockModelStrings = sequential(async () => {",
      "function initModelStrings(): void {",
      "",
      "headless-provider-v1.bedrockModelUpdate",
    );
    transformed = replaceUniqueSpan(
      transformed,
      "function initModelStrings(): void {",
      "export function getModelStrings(): ModelStrings {",
      `function initModelStrings(): void {
  if (getModelStringsState() === null) {
    setModelStringsState(getBuiltinModelStrings('firstParty'))
  }
}

`,
      "headless-provider-v1.firstPartyModelInit",
    );
    transformed = replaceUniqueSpan(
      transformed,
      "/**\n * Ensure model strings are fully initialized.",
      "export async function ensureModelStringsInitialized(): Promise<void> {",
      "/** Ensure first-party model strings are initialized. */\n",
      "headless-provider-v1.modelEnsureDoc",
    );
    transformed = replaceUniqueTail(
      transformed,
      "export async function ensureModelStringsInitialized(): Promise<void> {",
      `export async function ensureModelStringsInitialized(): Promise<void> {
  initModelStrings()
}
`,
      "headless-provider-v1.firstPartyModelEnsure",
    );
    return pruneUnusedBoundImports(transformed, path);
  }
  if (path === "src/services/tokenEstimation.ts") {
    let transformed = replaceUniqueSpan(
      source,
      "      if (getAPIProvider() === 'bedrock') {",
      "      const anthropic = await getAnthropicClient({",
      "",
      "headless-provider-v1.bedrockTokenCountBranch",
    );
    transformed = replaceUniqueTail(
      transformed,
      "async function countTokensWithBedrock({",
      "",
      "headless-provider-v1.bedrockTokenCountHelper",
    );
    return pruneUnusedBoundImports(transformed, path);
  }
  if (path === "src/utils/auth.ts") {
    const transformed = replaceUniqueSpan(
      source,
      "const DEFAULT_AWS_STS_TTL = 60 * 60 * 1000",
      "/** @private Use {@link getAnthropicApiKey} or {@link getAnthropicApiKeyWithSource} */",
      "",
      "headless-provider-v1.cloudCredentialRefresh",
    );
    return pruneUnusedBoundImports(transformed, path);
  }
  if (path === "src/utils/proxy.ts") {
    const transformed = replaceUniqueSpan(
      source,
      "/**\n * Get AWS SDK client configuration with proxy support",
      "/**\n * Clear proxy agent cache.",
      "",
      "headless-provider-v1.awsProxyClient",
    );
    return transformed;
  }
  if (path === "src/utils/model/bedrock.ts") {
    return replaceUniqueSpan(
      source,
      "import memoize from 'lodash-es/memoize.js'",
      "/**\n * Check if a model ID is a foundation model",
      "",
      "headless-provider-v1.bedrockSdkOperations",
    );
  }
  if (path === "src/services/api/claude.ts") {
    let transformed = replaceUnique(
      source,
      "import { getInferenceProfileBackingModel } from '../../utils/model/bedrock.js'\n",
      "",
      "headless-provider-v1.claudeBedrockImport",
    );
    transformed = replaceUniqueSpan(
      transformed,
      "  const resolvedModel =\n    getAPIProvider() === 'bedrock' &&",
      "\n\n  queryCheckpoint('query_tool_schema_build_start')",
      "  const resolvedModel = options.model",
      "headless-provider-v1.claudeBedrockModelResolution",
    );
    transformed = replaceUniqueSpan(
      transformed,
      "import {\n  type ConnectorTextBlock,",
      "import type {\n  AssistantMessage,",
      "",
      "headless-provider-v1.claudeConnectorImport",
    );
    transformed = replaceUnique(
      transformed,
      "          (feature('CONNECTOR_TEXT') ? !isConnectorTextBlock(_) : true)",
      "          true",
      "headless-provider-v1.claudeConnectorPromptCache",
    );
    transformed = replaceUnique(
      transformed,
      "  const contentBlocks: (BetaContentBlock | ConnectorTextBlock)[] = []",
      "  const contentBlocks: BetaContentBlock[] = []",
      "headless-provider-v1.claudeConnectorBlockType",
    );
    transformed = replaceUnique(
      transformed,
      "            const delta = part.delta as typeof part.delta | ConnectorTextDelta",
      "            const delta = part.delta",
      "headless-provider-v1.claudeConnectorDeltaType",
    );
    transformed = replaceUniqueSpan(
      transformed,
      "            if (\n              feature('CONNECTOR_TEXT') &&\n              delta.type === 'connector_text_delta'",
      "              switch (delta.type) {",
      "",
      "headless-provider-v1.claudeConnectorDeltaBranch",
    );
    transformed = replaceUnique(
      transformed,
      "              }\n            }\n            // Capture research from content_block_delta",
      "              }\n            // Capture research from content_block_delta",
      "headless-provider-v1.claudeConnectorDeltaClosing",
    );
    transformed = replaceUniqueSpan(
      transformed,
      "                  if (\n                    feature('CONNECTOR_TEXT') &&\n                    contentBlock.type === 'connector_text'",
      "                  if (contentBlock.type !== 'thinking') {\n                    logEvent('tengu_streaming_error', {\n                      error_type:\n                        'content_block_type_mismatch_thinking_signature'",
      "",
      "headless-provider-v1.claudeConnectorSignatureBranch",
    );
    transformed = replaceUniqueSpan(
      transformed,
      "  // Determine if cached microcompact is enabled for this model.",
      "  const useGlobalCacheFeature = shouldUseGlobalCacheScope()",
      `  // Cached microcompact is outside the authorized external-user core.
  const cachedMCEnabled = false
  const cacheEditingBetaHeader = ''

`,
      "headless-provider-v1.claudeCachedMicrocompact",
    );
    return pruneUnusedBoundImports(transformed, path);
  }
  if (path === "src/utils/aws.ts") {
    return replaceUniqueTail(
      source,
      "/** Throws if STS caller identity cannot be retrieved. */",
      "",
      "headless-provider-v1.awsSdkOperations",
    );
  }
  fail(`unsupported headless provider transform target: ${path}`);
}

function transformHeadlessClosure(source: string, path: string): string {
  if (path === "src/utils/terminal.ts") {
    let transformed = replaceUnique(
      source,
      "import { ctrlOToExpand } from '../components/CtrlOToExpand.js'\n",
      "",
      "headless-closure-v1.terminal.ctrlOImport",
    );
    transformed = replaceUnique(
      transformed,
      "`… +${estimatedRemaining} lines${suppressExpandHint ? '' : ` ${ctrlOToExpand()}`}`",
      "`… +${estimatedRemaining} lines`",
      "headless-closure-v1.terminal.ctrlOHint",
    );
    return transformed;
  }
  if (path === "src/services/mcp/config.ts") {
    let transformed = replaceUnique(
      source,
      "  if (name.match(/[^a-zA-Z0-9_-]/)) {",
      "  if (name.match(/[^a-zA-Z0-9_:-]/)) {",
      "headless-closure-v1.mcpConfig.colonName",
    );
    transformed = replaceUnique(
      transformed,
      "Names can only contain letters, numbers, hyphens, and underscores.",
      "Names can only contain letters, numbers, colons, hyphens, and underscores.",
      "headless-closure-v1.mcpConfig.colonMessage",
    );
    return transformed;
  }
  if (path === "src/setup.ts") {
    const transformed = replaceUniqueSpan(
      source,
      "  // Teammate snapshot — SIMPLE-only gate",
      "  // Terminal backup restoration — interactive only.",
      "",
      "headless-closure-v1.setup.teammateSnapshot",
    );
    return pruneUnusedBoundImports(transformed, path);
  }
  if (path === "src/tools.ts") {
    let transformed = replaceUnique(
      source,
      "import { TungstenTool } from './tools/TungstenTool/TungstenTool.js'\n",
      "",
      "headless-closure-v1.tools.tungstenImport",
    );
    for (const [specifier, label] of [
      ["import { TaskStopTool } from './tools/TaskStopTool/TaskStopTool.js'\n", "taskStopImport"],
      ["import { TaskOutputTool } from './tools/TaskOutputTool/TaskOutputTool.js'\n", "taskOutputImport"],
      ["import { LSPTool } from './tools/LSPTool/LSPTool.js'\n", "lspImport"],
    ] as const) {
      transformed = replaceUnique(transformed, specifier, "", `headless-closure-v1.tools.${label}`);
    }
    transformed = replaceUniqueSpan(
      transformed,
      "// Dead code elimination: conditional import for CLAUDE_CODE_VERIFY_PLAN",
      "import { SYNTHETIC_OUTPUT_TOOL_NAME }",
      "",
      "headless-closure-v1.tools.verifyPlan",
    );
    transformed = replaceUniqueSpan(
      transformed,
      "const WorkflowTool = feature('WORKFLOW_SCRIPTS')",
      "/* eslint-enable custom-rules/no-process-env-top-level, @typescript-eslint/no-require-imports */",
      "",
      "headless-closure-v1.tools.workflow",
    );
    transformed = replaceUniqueSpan(
      transformed,
      "// Lazy require to break circular dependency: tools.ts -> TeamCreateTool/TeamDeleteTool -> ... -> tools.ts",
      "import { AskUserQuestionTool }",
      "",
      "headless-closure-v1.tools.teamImports",
    );
    for (const [marker, label] of [
      ["    ...(process.env.USER_TYPE === 'ant' ? [TungstenTool] : []),\n", "tungstenEntry"],
      ["    ...(VerifyPlanExecutionTool ? [VerifyPlanExecutionTool] : []),\n", "verifyPlanEntry"],
      ["    ...(WorkflowTool ? [WorkflowTool] : []),\n", "workflowEntry"],
      ["    TaskOutputTool,\n", "taskOutputEntry"],
      ["    TaskStopTool,\n", "taskStopEntry"],
      ["    ...(isEnvTruthy(process.env.ENABLE_LSP_TOOL) ? [LSPTool] : []),\n", "lspEntry"],
      ["    getSendMessageTool(),\n", "sendMessageEntry"],
      ["    ...(isAgentSwarmsEnabled()\n      ? [getTeamCreateTool(), getTeamDeleteTool()]\n      : []),\n", "teamEntries"],
    ] as const) {
      transformed = replaceUnique(
        transformed,
        marker,
        "",
        `headless-closure-v1.tools.${label}`,
      );
    }
    return pruneUnusedBoundImports(transformed, path);
  }
  if (path === "src/constants/tools.ts") {
    let transformed = replaceUnique(
      source,
      "import { WORKFLOW_TOOL_NAME } from '../tools/WorkflowTool/constants.js'\n",
      "",
      "headless-closure-v1.toolConstants.workflowImport",
    );
    transformed = replaceUnique(
      transformed,
      "  // Prevent recursive workflow execution inside subagents.\n  ...(feature('WORKFLOW_SCRIPTS') ? [WORKFLOW_TOOL_NAME] : []),\n",
      "",
      "headless-closure-v1.toolConstants.workflowEntry",
    );
    return pruneUnusedBoundImports(transformed, path);
  }
  if (path === "src/services/api/logging.ts") {
    let transformed = replaceUnique(
      source,
      "import { isConnectorTextBlock } from 'src/types/connectorText.js'\n",
      "",
      "headless-closure-v1.apiLogging.connectorImport",
    );
    transformed = replaceUnique(
      transformed,
      "        } else if (feature('CONNECTOR_TEXT') && isConnectorTextBlock(block)) {\n          connectorCount++",
      "        } else if (false) {\n          connectorCount++",
      "headless-closure-v1.apiLogging.connectorCount",
    );
    return transformed;
  }
  if (path === "src/services/api/withRetry.ts") {
    let transformed = replaceUnique(
      source,
      "  clearAwsCredentialsCache,\n  clearGcpCredentialsCache,\n",
      "",
      "headless-closure-v1.withRetry.cloudCacheImports",
    );
    transformed = replaceUnique(
      transformed,
      "        isOAuthTokenRevokedError(lastError) ||\n        isBedrockAuthError(lastError) ||\n        isVertexAuthError(lastError) ||\n        isStaleConnection",
      "        isOAuthTokenRevokedError(lastError) ||\n        isStaleConnection",
      "headless-closure-v1.withRetry.cloudClientRefresh",
    );
    transformed = replaceUnique(
      transformed,
      `      // AWS/GCP errors aren't always APIError, but can be retried
      const handledCloudAuthError =
        handleAwsCredentialError(error) || handleGcpCredentialError(error)
      if (
        !handledCloudAuthError &&
        (!(error instanceof APIError) || !shouldRetry(error))
      ) {`,
      `      if (!(error instanceof APIError) || !shouldRetry(error)) {`,
      "headless-closure-v1.withRetry.cloudRetry",
    );
    transformed = replaceUniqueSpan(
      transformed,
      "function isBedrockAuthError(error: unknown): boolean {",
      "function shouldRetry(error: APIError): boolean {",
      "",
      "headless-closure-v1.withRetry.cloudHelpers",
    );
    return pruneUnusedBoundImports(transformed, path);
  }
  if (path === "src/state/onChangeAppState.ts") {
    let transformed = replaceUnique(
      source,
      `import {
  clearApiKeyHelperCache,
  clearAwsCredentialsCache,
  clearGcpCredentialsCache,
} from '../utils/auth.js'`,
      "import { clearApiKeyHelperCache } from '../utils/auth.js'",
      "headless-closure-v1.appState.cloudCacheImports",
    );
    transformed = replaceUnique(
      transformed,
      "      clearApiKeyHelperCache()\n      clearAwsCredentialsCache()\n      clearGcpCredentialsCache()",
      "      clearApiKeyHelperCache()",
      "headless-closure-v1.appState.cloudCacheClear",
    );
    return transformed;
  }
  if (path === "src/utils/messages.ts") {
    let transformed = replaceUnique(
      source,
      "import { isConnectorTextBlock } from '../types/connectorText.js'\n",
      "",
      "headless-closure-v1.messages.connectorImport",
    );
    transformed = replaceUniqueSpan(
      transformed,
      "  // Append message ID tags for snip tool visibility",
      "  // Validate all images are within API size limits before sending",
      "",
      "headless-closure-v1.messages.snipTags",
    );
    transformed = replaceUniqueSpan(
      transformed,
      "  if (feature('HISTORY_SNIP')) {\n    // A merged message is only meta if ALL merged messages are meta.",
      "  return {\n    ...a,\n    // Preserve the non-meta message's uuid",
      "",
      "headless-closure-v1.messages.snipMerge",
    );
    transformed = replaceUniqueSpan(
      transformed,
      "    case 'context_efficiency': {",
      "    case 'date_change': {",
      "    case 'context_efficiency': {\n      return []\n    }\n",
      "headless-closure-v1.messages.snipNudge",
    );
    transformed = replaceUniqueSpan(
      transformed,
      "      if (\n        feature('CONNECTOR_TEXT') &&",
      "      switch (message.event.content_block.type) {",
      "",
      "headless-closure-v1.messages.connectorStreamMode",
    );
    transformed = replaceUniqueSpan(
      transformed,
      "      if (feature('CONNECTOR_TEXT')) {",
      "      return true\n    })\n    if (filtered.length === content.length)",
      "",
      "headless-closure-v1.messages.connectorFilter",
    );
    return pruneUnusedBoundImports(transformed, path);
  }
  if (path === "src/utils/attachments.ts") {
    return replaceUniqueSpan(
      source,
      "export function getContextEfficiencyAttachment(",
      "\n\nfunction isFileReadDenied(",
      `export function getContextEfficiencyAttachment(
  _messages: Message[],
): Attachment[] {
  return []
}
`,
      "headless-closure-v1.attachments.snipNudge",
    );
  }
  if (path === "src/services/compact/microCompact.ts") {
    let transformed = replaceUniqueSpan(
      source,
      "// --- Cached microcompact state",
      "// Helper to calculate tool result tokens",
      `// Cached microcompact is disabled in the authorized external-user core.
export function consumePendingCacheEdits(): null { return null }
export function getPinnedCacheEdits(): [] { return [] }
export function pinCacheEdits(_userMessageIndex: number, _block: unknown): void {}
export function markToolsSentToAPIState(): void {}
export function resetMicrocompactState(): void {}

`,
      "headless-closure-v1.microcompact.cachedState",
    );
    transformed = replaceUniqueSpan(
      transformed,
      "  // Only run cached MC for the main thread",
      "  // Legacy microcompact path removed",
      "",
      "headless-closure-v1.microcompact.cachedDispatch",
    );
    transformed = replaceUniqueSpan(
      transformed,
      "/**\n * Cached microcompact path",
      "/**\n * Time-based microcompact:",
      "",
      "headless-closure-v1.microcompact.cachedPath",
    );
    return pruneUnusedBoundImports(transformed, path);
  }
  if (path === "src/skills/bundled/index.ts") {
    let transformed = replaceUnique(
      source,
      "import { registerVerifySkill } from './verify.js'\n",
      "",
      "headless-closure-v1.skills.verifyImport",
    );
    transformed = replaceUnique(
      transformed,
      "  registerVerifySkill()\n",
      "",
      "headless-closure-v1.skills.verifyRegistration",
    );
    transformed = replaceUnique(
      transformed,
      "import { shouldAutoEnableClaudeInChrome } from 'src/utils/claudeInChrome/setup.js'\n",
      "",
      "headless-closure-v1.skills.chromeGateImport",
    );
    transformed = replaceUnique(
      transformed,
      "import { registerClaudeInChromeSkill } from './claudeInChrome.js'\n",
      "",
      "headless-closure-v1.skills.chromeSkillImport",
    );
    return replaceUnique(
      transformed,
      `  if (shouldAutoEnableClaudeInChrome()) {
    registerClaudeInChromeSkill()
  }
`,
      "",
      "headless-closure-v1.skills.chromeRegistration",
    );
  }
  if (path === "src/entrypoints/sdk/coreTypes.ts") {
    return replaceUnique(
      source,
      "// Re-export all generated types\nexport * from './coreTypes.generated.js'\n\n",
      "",
      "headless-closure-v1.sdkCore.generatedTypes",
    );
  }
  if (path === "src/entrypoints/agentSdkTypes.ts") {
    let transformed = replaceUnique(
      source,
      "// Re-export runtime types (callbacks, interfaces with methods)\nexport * from './sdk/runtimeTypes.js'\n\n",
      "",
      "headless-closure-v1.agentSdk.runtimeExport",
    );
    transformed = replaceUnique(
      transformed,
      "// Re-export tool types (all marked @internal until SDK API stabilizes)\nexport * from './sdk/toolTypes.js'\n\n",
      "",
      "headless-closure-v1.agentSdk.toolExport",
    );
    return transformed;
  }
  if (path === "src/utils/filePersistence/filePersistence.ts") {
    return `export async function runFilePersistence(
  _turnStartTime: unknown,
  _signal?: AbortSignal,
): Promise<null> {
  return null
}

export async function executeFilePersistence(
  _turnStartTime: unknown,
  _signal: AbortSignal,
  _onResult: (result: never) => void,
): Promise<void> {}

export function isFilePersistenceEnabled(): boolean {
  return false
}
`;
  }
  if (path === "src/utils/cleanup.ts") {
    return replaceUniqueSpan(
      source,
      "export async function cleanupNpmCacheForAnthropicPackages(): Promise<void> {",
      "/**\n * Throttled wrapper around cleanupOldVersions",
      "export async function cleanupNpmCacheForAnthropicPackages(): Promise<void> {}\n\n",
      "headless-closure-v1.cleanup.npmCache",
    );
  }
  if (path === "src/tools/FileReadTool/imageProcessor.ts") {
    let transformed = replaceUnique(
      source,
      "import { isInBundledMode } from '../../utils/bundledMode.js'\n",
      "",
      "headless-closure-v1.imageProcessor.bundledModeImport",
    );
    transformed = replaceUniqueSpan(
      transformed,
      "  if (isInBundledMode()) {",
      "  // Use sharp for non-bundled builds or as fallback.",
      "",
      "headless-closure-v1.imageProcessor.nativeBundledBranch",
    );
    return transformed;
  }
  fail(`unsupported headless closure transform target: ${path}`);
}

function transformDependencySource(
  source: string,
  transform: ResolutionMap["dependencyTransforms"][number],
): string {
  if (transform.transform === "sharp-optional-runtime-v1") {
    if (transform.path === "lib/libvips.js") {
      let transformed = replaceUnique(
        source,
        "require('@img/sharp-libvips-dev/include')",
        "require(['@img/sharp-libvips-dev', 'include'].join('/'))",
        "sharp-optional-runtime-v1.include",
      );
      transformed = replaceUnique(
        transformed,
        "require('@img/sharp-libvips-dev/cplusplus')",
        "require(['@img/sharp-libvips-dev', 'cplusplus'].join('/'))",
        "sharp-optional-runtime-v1.cplusplus",
      );
      return transformed;
    }
    if (transform.path === "lib/utility.js") {
      return replaceUnique(
        source,
        "require('@img/sharp-wasm32/versions')",
        "require(['@img/sharp-wasm32', 'versions'].join('/'))",
        "sharp-optional-runtime-v1.wasmVersions",
      );
    }
  }
  fail(`unsupported dependency transform target: ${transform.dependency}:${transform.path}`);
}

function applySourceTransform(source: string, transform: CorePruneProfile["sourceTransforms"][number]): string {
  switch (transform.transform) {
    case "headless-cli-entry-v1":
      return transformHeadlessCliEntry(source);
    case "headless-main-v1":
      return transformHeadlessMain(source);
    case "headless-agent-tool-v1":
      return transformHeadlessAgentTool(source);
    case "headless-tool-v1":
      return transformHeadlessTool(source, transform.path);
    case "headless-commands-v1":
      return transformHeadlessCommands(source);
    case "headless-runtime-ui-v1":
      return transformHeadlessRuntimeUi(source, transform.path);
    case "headless-provider-v1":
      return transformHeadlessProvider(source, transform.path);
    case "headless-closure-v1":
      return transformHeadlessClosure(source, transform.path);
  }
}

function transformHeadlessManualOAuth(source: string): string {
  let transformed = replaceUnique(
    source,
    `): Promise<void> {
  // XAA (SEP-990): if configured, bypass the per-server consent dance.`,
    `): Promise<void> {
  const recordInkOAuthStage = (stage: string) => {
    try {
      const recorder = (globalThis as any)[Symbol.for('ink.claude.runtime.mcpOAuthStage')]
      if (typeof recorder === 'function') recorder(stage)
    } catch {}
  }

  // XAA (SEP-990): if configured, bypass the per-server consent dance.`,
    "headless-manual-oauth.stageRecorder",
  );
  transformed = replaceUnique(
    transformed,
    "export class ClaudeAuthProvider implements OAuthClientProvider {",
    `const recordInkOAuthProviderStage = (stage: string) => {
  try {
    const recorder = (globalThis as any)[Symbol.for('ink.claude.runtime.mcpOAuthStage')]
    if (typeof recorder === 'function') recorder(stage)
  } catch {}
}

export class ClaudeAuthProvider implements OAuthClientProvider {`,
    "headless-manual-oauth.providerStageRecorder",
  );
  transformed = replaceUnique(
    transformed,
    "  private _codeVerifier?: string",
    "  private _clientInformation?: OAuthClientInformation\n  private _codeVerifier?: string",
    "headless-manual-oauth.clientInformationMemoField",
  );
  transformed = replaceUnique(
    transformed,
    "  async clientInformation(): Promise<OAuthClientInformation | undefined> {\n    const storage = getSecureStorage()",
    `  async clientInformation(): Promise<OAuthClientInformation | undefined> {
    if (this._clientInformation) {
      logMCPDebug(this.serverName, \`Found instance client info\`)
      recordInkOAuthProviderStage('client_information_present')
      return this._clientInformation
    }
    const storage = getSecureStorage()`,
    "headless-manual-oauth.clientInformationMemoRead",
  );
  transformed = replaceUnique(
    transformed,
    "  ): Promise<void> {\n    const storage = getSecureStorage()\n    const existingData = storage.read() || {}\n    const serverKey = getServerKey(this.serverName, this.serverConfig)\n\n    const updatedData: SecureStorageData = {",
    `  ): Promise<void> {
    this._clientInformation = {
      client_id: clientInformation.client_id,
      client_secret: clientInformation.client_secret,
    }
    const storage = getSecureStorage()
    const existingData = storage.read() || {}
    const serverKey = getServerKey(this.serverName, this.serverConfig)

    const updatedData: SecureStorageData = {`,
    "headless-manual-oauth.clientInformationMemoWrite",
  );
  transformed = replaceUnique(
    transformed,
    "      logMCPDebug(this.serverName, `Found client info`)\n      return {",
    "      logMCPDebug(this.serverName, `Found client info`)\n      recordInkOAuthProviderStage('client_information_present')\n      return {",
    "headless-manual-oauth.storedClientInformationStage",
  );
  transformed = replaceUnique(
    transformed,
    "      logMCPDebug(this.serverName, `Using pre-configured client ID`)\n      return {",
    "      logMCPDebug(this.serverName, `Using pre-configured client ID`)\n      recordInkOAuthProviderStage('client_information_present')\n      return {",
    "headless-manual-oauth.configClientInformationStage",
  );
  transformed = replaceUnique(
    transformed,
    "    logMCPDebug(this.serverName, `No client info found`)\n    return undefined",
    "    logMCPDebug(this.serverName, `No client info found`)\n    recordInkOAuthProviderStage('client_information_missing')\n    return undefined",
    "headless-manual-oauth.missingClientInformationStage",
  );
  transformed = replaceUnique(
    transformed,
    "    logMCPDebug(this.serverName, `Returning code verifier`)\n    return this._codeVerifier",
    "    logMCPDebug(this.serverName, `Returning code verifier`)\n    recordInkOAuthProviderStage('code_verifier_present')\n    return this._codeVerifier",
    "headless-manual-oauth.codeVerifierStage",
  );
  transformed = replaceUnique(
    transformed,
    "    storage.update(updatedData)\n  }\n\n  /**\n   * XAA silent refresh:",
    `    recordInkOAuthProviderStage('token_save_started')
    const storageResult = storage.update(updatedData)
    if (!storageResult.success) {
      recordInkOAuthProviderStage('token_save_failed')
      throw new Error('OAuth token persistence failed')
    }
    recordInkOAuthProviderStage('token_save_completed')
  }

  /**
   * XAA silent refresh:`,
    "headless-manual-oauth.tokenSaveStages",
  );
  transformed = replaceUnique(
    transformed,
    "      server = createServer((req, res) => {",
    `      const startSdkAuth = async () => {
        try {
          recordInkOAuthStage('initial_sdk_auth_started')
          logMCPDebug(serverName, \`Starting SDK auth\`)
          logMCPDebug(serverName, \`Server URL: \${serverConfig.url}\`)

          // Start the existing SDK OAuth flow. The same provider is later
          // completed with authorizationCode and persists tokens normally.
          const result = await sdkAuth(provider, {
            serverUrl: serverConfig.url,
            scope: wwwAuthParams.scope,
            resourceMetadataUrl: wwwAuthParams.resourceMetadataUrl,
          })
          recordInkOAuthStage('initial_sdk_auth_completed')
          logMCPDebug(serverName, \`Initial auth result: \${result}\`)

          if (result !== 'REDIRECT') {
            logMCPDebug(
              serverName,
              \`Unexpected auth result, expected REDIRECT: \${result}\`,
            )
          }
        } catch (error) {
          logMCPDebug(serverName, \`SDK auth error: \${error}\`)
          cleanup()
          rejectOnce(new Error(\`SDK auth failed: \${errorMessage(error)}\`))
        }
      }

      if (options?.onWaitingForCallback) {
        // Headless/manual mode deliberately owns no localhost listener. This
        // prevents a browser callback from racing the stdin callback while
        // retaining the configured redirect URI, state check and SDK flow.
        void startSdkAuth()
      } else {
        server = createServer((req, res) => {`,
    "headless-manual-oauth.createServerBranch",
  );
  transformed = replaceUniqueSpan(
    transformed,
    "      server.listen(port, '127.0.0.1', async () => {",
    "      // Don't let the callback server or timeout pin the event loop",
    `        server.listen(port, '127.0.0.1', () => {
          void startSdkAuth()
        })

        // Don't let the callback server or timeout pin the event loop`,
    "headless-manual-oauth.sdkAuthStart",
  );
  transformed = replaceUnique(
    transformed,
    "      server.unref()\n\n      timeoutId = setTimeout(",
    "        server.unref()\n      }\n\n      timeoutId = setTimeout(",
    "headless-manual-oauth.listenerBranchClose",
  );
  transformed = replaceUnique(
    transformed,
    "            logMCPDebug(\n              serverName,\n              `Received auth code via manual callback URL`,",
    "            recordInkOAuthStage('callback_validated')\n            logMCPDebug(\n              serverName,\n              `Received auth code via manual callback URL`,",
    "headless-manual-oauth.callbackValidatedStage",
  );
  transformed = replaceUnique(
    transformed,
    "    // Now complete the auth flow with the received code\n    logMCPDebug(serverName, `Completing auth flow with authorization code`)",
    "    // Now complete the auth flow with the received code\n    recordInkOAuthStage('token_exchange_started')\n    logMCPDebug(serverName, `Completing auth flow with authorization code`)",
    "headless-manual-oauth.tokenExchangeStartedStage",
  );
  transformed = replaceUnique(
    transformed,
    "    logMCPDebug(serverName, `Auth result: ${result}`)",
    "    recordInkOAuthStage('token_exchange_completed')\n    logMCPDebug(serverName, `Auth result: ${result}`)",
    "headless-manual-oauth.tokenExchangeCompletedStage",
  );
  transformed = replaceUnique(
    transformed,
    "      const savedTokens = await provider.tokens()\n      logMCPDebug(",
    `      const savedTokens = await provider.tokens()
      if (!savedTokens) {
        recordInkOAuthStage('credentials_missing')
        throw new Error('OAuth credentials unavailable after token exchange')
      }
      recordInkOAuthStage('credentials_present')
      logMCPDebug(`,
    "headless-manual-oauth.credentialsStage",
  );
  transformed = replaceUnique(
    transformed,
    "    logEvent('tengu_mcp_oauth_flow_error', {",
    `    if (authorizationCodeObtained) {
      const oauthFailureStages: Record<string, string> = {
        invalid_client: 'token_exchange_failed_invalid_client',
        invalid_grant: 'token_exchange_failed_invalid_grant',
        invalid_request: 'token_exchange_failed_invalid_request',
        access_denied: 'token_exchange_failed_access_denied',
        unsupported_grant_type: 'token_exchange_failed_unsupported_grant_type',
        server_error: 'token_exchange_failed_server_error',
        temporarily_unavailable: 'token_exchange_failed_temporarily_unavailable',
      }
      const fixedHttpStages: Record<number, string> = {
        400: 'token_exchange_failed_http_400',
        401: 'token_exchange_failed_http_401',
        403: 'token_exchange_failed_http_403',
        404: 'token_exchange_failed_http_404',
        429: 'token_exchange_failed_http_429',
      }
      let failureStage = oauthErrorCode ? oauthFailureStages[oauthErrorCode] : undefined
      if (!failureStage && httpStatus !== undefined) {
        failureStage =
          fixedHttpStages[httpStatus] ??
          (httpStatus >= 400 && httpStatus < 500
            ? 'token_exchange_failed_http_4xx'
            : httpStatus >= 500 && httpStatus < 600
              ? 'token_exchange_failed_http_5xx'
              : undefined)
      }
      if (!failureStage) {
        if (oauthErrorCode) {
          failureStage = 'token_exchange_failed_oauth_other'
        } else {
          const errorObject =
            typeof error === 'object' && error !== null
              ? (error as { name?: unknown; issues?: unknown; message?: unknown })
              : undefined
          const errorName =
            typeof errorObject?.name === 'string' ? errorObject.name : undefined
          const schemaFailureStages: Record<string, string> = {
            access_token: 'token_exchange_failed_schema_access_token',
            token_type: 'token_exchange_failed_schema_token_type',
            expires_in: 'token_exchange_failed_schema_expires_in',
            scope: 'token_exchange_failed_schema_scope',
            refresh_token: 'token_exchange_failed_schema_refresh_token',
            id_token: 'token_exchange_failed_schema_id_token',
          }
          // This deliberately supersedes the narrower
          // errorName === 'ZodError' && Array.isArray(errorObject?.issues) gate.
          if (Array.isArray(errorObject?.issues)) {
            failureStage = 'token_exchange_failed_schema_other'
            for (const issue of errorObject.issues) {
              if (typeof issue !== 'object' || issue === null) continue
              const issuePath = (issue as { path?: unknown }).path
              const field = Array.isArray(issuePath) ? issuePath[0] : undefined
              if (typeof field === 'string' && schemaFailureStages[field]) {
                failureStage = schemaFailureStages[field]
                break
              }
            }
          } else if (errorName === 'SyntaxError') {
            failureStage = 'token_exchange_failed_invalid_json'
          } else if (errorName === 'TypeError') {
            failureStage = 'token_exchange_failed_network_type_error'
          } else if (errorName === 'AbortError' || errorName === 'TimeoutError') {
            failureStage = 'token_exchange_failed_network_timeout'
          } else if (errorName === 'Error') {
            const genericMessage =
              typeof errorObject?.message === 'string' ? errorObject.message : ''
            if (
              genericMessage ===
              'OAuth credentials unavailable after token exchange'
            ) {
              failureStage = 'token_exchange_failed_credentials_unavailable'
            } else if (
              genericMessage.includes(
                'Existing OAuth client information is required when exchanging an authorization code',
              )
            ) {
              failureStage = 'token_exchange_failed_existing_client_information_missing'
            } else if (
              genericMessage.includes(
                'client_secret_basic authentication requires a client_secret',
              )
            ) {
              failureStage = 'token_exchange_failed_client_secret_missing'
            } else if (
              genericMessage.includes('Unsupported client authentication method:')
            ) {
              failureStage = 'token_exchange_failed_unsupported_client_auth'
            } else if (genericMessage.includes('No code verifier saved')) {
              failureStage = 'token_exchange_failed_code_verifier_missing'
            } else if (
              genericMessage.includes('redirectUrl is required for authorization_code flow')
            ) {
              failureStage = 'token_exchange_failed_redirect_uri_missing'
            } else {
              failureStage = 'token_exchange_failed_runtime_unknown'
            }
          } else {
            failureStage = 'token_exchange_failed_runtime_unknown'
          }
        }
      }
      recordInkOAuthStage(failureStage)
    }

    logEvent('tengu_mcp_oauth_flow_error', {`,
    "headless-manual-oauth.tokenExchangeFailureStage",
  );
  return transformed;
}

function transformSecureStorageSelector(path: string, source: string): string {
  if (path === "src/utils/secureStorage/index.ts") {
    let transformed = replaceUnique(
      source,
      "import type { SecureStorage } from './types.js'",
      "import { isAbsolute, normalize } from 'path'\nimport type { SecureStorage } from './types.js'",
      "secure-storage-selector.storageIndexPathImports",
    );
    transformed = replaceUnique(
      transformed,
      "export function getSecureStorage(): SecureStorage {\n  if (process.platform === 'darwin') {",
      `export function getSecureStorage(): SecureStorage {
  const secureSelector = process.env.CLAUDE_SECURESTORAGE_CONFIG_DIR
  if (secureSelector) {
    if (
      !isAbsolute(secureSelector) ||
      normalize(secureSelector) !== secureSelector ||
      secureSelector.normalize('NFC') !== secureSelector
    ) {
      throw new Error(
        'CLAUDE_SECURESTORAGE_CONFIG_DIR must be an absolute normalized NFC path',
      )
    }
    return plainTextStorage
  }
  if (process.platform === 'darwin') {`,
      "secure-storage-selector.deterministicActorStorage",
    );
    return transformed;
  }
  if (path === "src/utils/secureStorage/macOsKeychainHelpers.ts") {
    let transformed = replaceUnique(
      source,
      "import { userInfo } from 'os'",
      "import { userInfo } from 'os'\nimport { isAbsolute, normalize } from 'path'",
      "secure-storage-selector.keychainPathImports",
    );
    transformed = replaceUnique(
      transformed,
      "  const configDir = getClaudeConfigHomeDir()\n  const isDefaultDir = !process.env.CLAUDE_CONFIG_DIR",
      `  const secureSelector = process.env.CLAUDE_SECURESTORAGE_CONFIG_DIR
  const selectedSecureDir =
    secureSelector &&
    isAbsolute(secureSelector) &&
    normalize(secureSelector) === secureSelector &&
    secureSelector.normalize('NFC') === secureSelector
      ? secureSelector
      : undefined
  const configDir = selectedSecureDir ?? getClaudeConfigHomeDir()
  const isDefaultDir = !selectedSecureDir && !process.env.CLAUDE_CONFIG_DIR`,
      "secure-storage-selector.keychainIdentity",
    );
    return transformed;
  }
  if (path === "src/utils/secureStorage/plainTextStorage.ts") {
    let transformed = replaceUnique(
      source,
      "import { join } from 'path'",
      "import { isAbsolute, join, normalize } from 'path'",
      "secure-storage-selector.plainTextPathImports",
    );
    transformed = replaceUnique(
      transformed,
      "  const storageDir = getClaudeConfigHomeDir()",
      `  const secureSelector = process.env.CLAUDE_SECURESTORAGE_CONFIG_DIR
  const storageDir =
    secureSelector &&
    isAbsolute(secureSelector) &&
    normalize(secureSelector) === secureSelector &&
    secureSelector.normalize('NFC') === secureSelector
      ? secureSelector
      : getClaudeConfigHomeDir()`,
      "secure-storage-selector.plainTextIdentity",
    );
    return transformed;
  }
  fail(`unknown secure-storage selector transform: ${path}`);
}

function runtimeFacadeForBase(base: string): string | null {
  const candidates = [base];
  const extension = extname(base);
  if (extension === ".js" || extension === ".mjs" || extension === ".jsx") {
    const stem = base.slice(0, -extension.length);
    candidates.push(`${stem}.ts`, `${stem}.tsx`, `${stem}.mts`);
  }
  candidates.push(join(base, "index.ts"), join(base, "index.tsx"));
  for (const candidate of candidates) {
    const id = runtimeFacadeIdsByTarget.get(candidate);
    if (id) return id;
  }
  return null;
}

const runtimeFacadeSources: Record<string, string> = {
  "mcp-management-entry": `
import { Command } from '@commander-js/extra-typings'
import {
  chmodSync, closeSync, constants, lstatSync, mkdirSync, openSync,
  renameSync, unlinkSync, writeSync,
} from 'node:fs'
import { isAbsolute, join, normalize, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { registerMcpAddCommand } from 'src/commands/mcp/addCommand.js'
import { init } from 'src/entrypoints/init.js'
import {
  mcpGetHandler, mcpListHandler, mcpRemoveHandler,
} from 'src/cli/handlers/mcp.js'
import { getMcpConfigByName } from 'src/services/mcp/config.js'
import {
  clearMcpClientConfig, clearServerTokensFromLocalStorage,
  performMCPOAuthFlow, revokeServerTokens,
} from 'src/services/mcp/auth.js'
import { buildRedirectUri } from 'src/services/mcp/oauthPort.js'

const oauthStageKey = Symbol.for('ink.claude.runtime.mcpOAuthStage')
const oauthStageAllowlist = new Set([
  'action_started', 'reader_ready', 'callback_line_received',
  'callback_validated', 'initial_sdk_auth_started',
  'initial_sdk_auth_completed', 'token_exchange_started',
  'client_information_present', 'client_information_missing',
  'code_verifier_present', 'token_save_started', 'token_save_completed',
  'token_save_failed',
  'token_exchange_completed', 'credentials_present',
  'credentials_missing', 'flow_resolved', 'success_stdout_flushed',
  'flow_failed',
  'token_exchange_failed_invalid_client',
  'token_exchange_failed_invalid_grant',
  'token_exchange_failed_invalid_request',
  'token_exchange_failed_access_denied',
  'token_exchange_failed_unsupported_grant_type',
  'token_exchange_failed_server_error',
  'token_exchange_failed_temporarily_unavailable',
  'token_exchange_failed_http_400', 'token_exchange_failed_http_401',
  'token_exchange_failed_http_403', 'token_exchange_failed_http_404',
  'token_exchange_failed_http_429', 'token_exchange_failed_http_4xx',
  'token_exchange_failed_http_5xx', 'token_exchange_failed_oauth_other',
  'token_exchange_failed_schema_access_token',
  'token_exchange_failed_schema_token_type',
  'token_exchange_failed_schema_expires_in',
  'token_exchange_failed_schema_scope',
  'token_exchange_failed_schema_refresh_token',
  'token_exchange_failed_schema_id_token',
  'token_exchange_failed_schema_other', 'token_exchange_failed_invalid_json',
  'token_exchange_failed_network_type_error',
  'token_exchange_failed_network_timeout',
  'token_exchange_failed_runtime_unknown',
  'token_exchange_failed_existing_client_information_missing',
  'token_exchange_failed_client_secret_missing',
  'token_exchange_failed_unsupported_client_auth',
  'token_exchange_failed_code_verifier_missing',
  'token_exchange_failed_redirect_uri_missing',
  'token_exchange_failed_credentials_unavailable',
])

function requireSecureStorageSelector() {
  const selector = process.env.CLAUDE_SECURESTORAGE_CONFIG_DIR
  if (
    selector &&
    (!isAbsolute(selector) ||
      normalize(selector) !== selector ||
      selector.normalize('NFC') !== selector)
  ) {
    throw new Error(
      'CLAUDE_SECURESTORAGE_CONFIG_DIR must be an absolute normalized NFC path',
    )
  }
}

function createMcpOAuthStageRecorder() {
  const noRecord = () => {}
  const configRoot = process.env.CLAUDE_CONFIG_DIR
  if (!configRoot || !isAbsolute(configRoot) || resolve(configRoot) !== configRoot) return noRecord
  const noFollow = constants.O_NOFOLLOW
  if (typeof noFollow !== 'number') return noRecord
  const diagnosticsDirectory = join(configRoot, '.ink-runtime-diagnostics')
  const receiptPath = join(diagnosticsDirectory, 'mcp-oauth-stage.jsonl')
  const replacementPath = join(diagnosticsDirectory, 'mcp-oauth-stage.jsonl.tmp')
  let sequence = 0
  const recordedStages = new Set()
  try {
    mkdirSync(diagnosticsDirectory, { recursive: true, mode: 0o700 })
    const directoryInfo = lstatSync(diagnosticsDirectory)
    if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) return noRecord
    chmodSync(diagnosticsDirectory, 0o700)
    const replacement = openSync(
      replacementPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | noFollow,
      0o600,
    )
    closeSync(replacement)
    chmodSync(replacementPath, 0o600)
    renameSync(replacementPath, receiptPath)
    chmodSync(receiptPath, 0o600)
  } catch {
    try { unlinkSync(replacementPath) } catch {}
    return noRecord
  }
  return stage => {
    if (sequence >= 16 || !oauthStageAllowlist.has(stage) || recordedStages.has(stage)) return
    let descriptor
    try {
      descriptor = openSync(receiptPath, constants.O_WRONLY | constants.O_APPEND | noFollow)
      const record = {
        schemaVersion: 1,
        seq: sequence + 1,
        at: new Date().toISOString(),
        stage,
      }
      writeSync(descriptor, JSON.stringify(record) + '\\n')
      sequence += 1
      recordedStages.add(stage)
    } catch {
      // Diagnostics are fail-safe and must never change OAuth behavior.
    } finally {
      if (descriptor !== undefined) {
        try { closeSync(descriptor) } catch {}
      }
    }
  }
}

function requireOAuthServer(name) {
  const server = getMcpConfigByName(name)
  if (!server) throw new Error(\`No MCP server named "\${name}"\`)
  if (server.type !== 'http' && server.type !== 'sse') {
    throw new Error(\`MCP server "\${name}" does not use HTTP/SSE OAuth\`)
  }
  return server
}

export async function runMcpManagement(args) {
  await init()
  const program = new Command().name('claude')
  const mcp = program.command('mcp').description('Configure and manage MCP servers')
  registerMcpAddCommand(mcp)
  mcp.command('remove <name>').option('-s, --scope <scope>').action(mcpRemoveHandler)
  mcp.command('list').action(mcpListHandler)
  mcp.command('get <name>').action(mcpGetHandler)
  mcp.command('login <name>')
    .description('Authenticate with an MCP server (HTTP or SSE)')
    .option('--no-browser', 'Print the authorization URL and read the callback URL from stdin')
    .action(async (name, options) => {
      const noBrowser = options.browser === false
      const recordStage = noBrowser ? createMcpOAuthStageRecorder() : () => {}
      const previousStageRecorder = globalThis[oauthStageKey]
      if (noBrowser) globalThis[oauthStageKey] = recordStage
      recordStage('action_started')
      const lifecyclePin = noBrowser ? setInterval(() => {}, 60_000) : undefined
      let callbackInput
      try {
        requireSecureStorageSelector()
        const server = requireOAuthServer(name)
        const loginServer = noBrowser && !server.oauth?.callbackPort
          ? {
              ...server,
              oauth: {
                ...server.oauth,
                callbackPort: Number(new URL(buildRedirectUri()).port),
              },
            }
          : server
        await performMCPOAuthFlow(
          name,
          loginServer,
          url => process.stdout.write(\`Open this URL to authenticate:\\n\${url}\\n\`),
          undefined,
          noBrowser ? {
            skipBrowserOpen: true,
            onWaitingForCallback: submit => {
              process.stdout.write('Paste the OAuth callback URL and press Enter:\\n')
              callbackInput = createInterface({ input: process.stdin, terminal: false })
              recordStage('reader_ready')
              callbackInput.once('line', line => {
                recordStage('callback_line_received')
                submit(line.trim())
              })
            },
          } : undefined,
        )
        recordStage('flow_resolved')
        const message = \`Authenticated MCP server \${name}\\n\`
        if (noBrowser) await new Promise(resolve => process.stdout.write(message, resolve))
        else process.stdout.write(message)
        recordStage('success_stdout_flushed')
      } catch {
        recordStage('flow_failed')
        process.exitCode = 1
        await new Promise(resolve => process.stderr.write('MCP OAuth login failed\\n', resolve))
      } finally {
        callbackInput?.close()
        if (noBrowser) process.stdin.pause()
        if (lifecyclePin) clearInterval(lifecyclePin)
        if (noBrowser) {
          if (previousStageRecorder === undefined) delete globalThis[oauthStageKey]
          else globalThis[oauthStageKey] = previousStageRecorder
        }
      }
    })
  mcp.command('logout <name>')
    .description('Clear stored OAuth credentials for an MCP server')
    .action(async name => {
      const server = requireOAuthServer(name)
      await revokeServerTokens(name, server)
      clearServerTokensFromLocalStorage(name, server)
      clearMcpClientConfig(name, server)
      process.stdout.write(\`Cleared OAuth credentials for MCP server \${name}\\n\`)
    })
  await program.parseAsync(['bun', 'claude', 'mcp', ...args])
}
`,
  "first-party-event-logging-disabled": `
export function getEventSamplingConfig() { return {} }
export function shouldSampleEvent() { return null }
export async function shutdown1PEventLogging() {}
export function is1PEventLoggingEnabled() { return false }
export function logEventTo1P() {}
export function logGrowthBookExperimentTo1P() {}
export function initialize1PEventLogging() {}
export async function reinitialize1PEventLoggingIfConfigChanged() {}
`,
  "growthbook-disabled": `
export function onGrowthBookRefresh() { return () => {} }
export function hasGrowthBookEnvOverride() { return false }
export function getAllGrowthBookFeatures() { return {} }
export function getGrowthBookConfigOverrides() { return {} }
export function setGrowthBookConfigOverride() {}
export function clearGrowthBookConfigOverrides() {}
export function getApiBaseUrlHost() { return undefined }
export async function initializeGrowthBook() {}
export async function getFeatureValue_DEPRECATED(_feature, defaultValue) { return defaultValue }
export function getFeatureValue_CACHED_MAY_BE_STALE(_feature, defaultValue) { return defaultValue }
export function getFeatureValue_CACHED_WITH_REFRESH(_feature, defaultValue) { return defaultValue }
export function checkStatsigFeatureGate_CACHED_MAY_BE_STALE() { return false }
export async function checkSecurityRestrictionGate() { return false }
export async function checkGate_CACHED_OR_BLOCKING() { return false }
export function refreshGrowthBookAfterAuthChange() {}
export function resetGrowthBook() {}
export async function refreshGrowthBookFeatures() {}
export function setupPeriodicGrowthBookRefresh() {}
export function stopPeriodicGrowthBookRefresh() {}
export async function getDynamicConfig_BLOCKS_ON_INIT(_name, defaultValue) { return defaultValue }
export function getDynamicConfig_CACHED_MAY_BE_STALE(_name, defaultValue) { return defaultValue }
`,
  "lsp-disabled": `
export function _resetLspManagerForTesting() {}
export function getLspServerManager() { return undefined }
export function getInitializationStatus() { return { status: 'not-started' } }
export function isLspConnected() { return false }
export async function waitForInitialization() {}
export function initializeLspServerManager() {}
export function reinitializeLspServerManager() {}
export async function shutdownLspServerManager() {}
`,
  "policy-limits-disabled": `
export function _resetPolicyLimitsForTesting() {}
export function initializePolicyLimitsLoadingPromise() {}
export function isPolicyLimitsEligible() { return false }
export async function waitForPolicyLimitsToLoad() {}
export function isPolicyAllowed() { return false }
export async function loadPolicyLimits() {}
export async function refreshPolicyLimits() {}
export async function clearPolicyLimitsCache() {}
export function startBackgroundPolling() {}
export function stopBackgroundPolling() {}
`,
  "remote-managed-settings-disabled": `
export function initializeRemoteManagedSettingsLoadingPromise() {}
export function computeChecksumFromSettings() { return '' }
export function isEligibleForRemoteManagedSettings() { return false }
export async function waitForRemoteManagedSettingsToLoad() {}
export async function clearRemoteManagedSettingsCache() {}
export async function loadRemoteManagedSettings() {}
export async function refreshRemoteManagedSettings() {}
export function startBackgroundPolling() {}
export function stopBackgroundPolling() {}
`,
  "repository-detection-disabled": `
export function clearRepositoryCaches() {}
export async function detectCurrentRepository() { return null }
export async function detectCurrentRepositoryWithHost() { return null }
export function getCachedRepository() { return null }
export function parseGitRemote() { return null }
export function parseGitHubRepository() { return null }
`,
  "telemetry-disabled": `
export function bootstrapTelemetry() { return null }
export function parseExporterTypes() { return [] }
export function isTelemetryEnabled() { return false }
export async function initializeTelemetry() { return null }
export async function flushTelemetry() {}
`,
  "teammate-disabled": `
export function createTeammateContext() { return undefined }
export function getTeammateContext() { return undefined }
export function isInProcessTeammate() { return false }
export function runWithTeammateContext(_context, fn) { return fn() }
export function getParentSessionId() { return undefined }
export function setDynamicTeamContext() {}
export function clearDynamicTeamContext() {}
export function getDynamicTeamContext() { return null }
export function getAgentId() { return undefined }
export function getAgentName() { return undefined }
export function getTeamName() { return undefined }
export function isTeammate() { return false }
export function getTeammateColor() { return undefined }
export function isPlanModeRequired() { return false }
export function isTeamLead() { return false }
export function hasActiveInProcessTeammates() { return false }
export function hasWorkingInProcessTeammates() { return false }
export async function waitForTeammatesToBecomeIdle() {}
`,
  "teammate-context-disabled": `
export function getTeammateContext() { return undefined }
export function runWithTeammateContext(_context, fn) { return fn() }
export function isInProcessTeammate() { return false }
export function createTeammateContext() { return undefined }
`,
  "teammate-mailbox-disabled": `
export function getInboxPath() { return '' }
export async function readMailbox() { return [] }
export async function readUnreadMessages() { return [] }
export async function writeToMailbox() { throw new Error('Teammate mailbox is unavailable') }
export async function markMessageAsReadByIndex() {}
export async function markMessagesAsRead() {}
export async function clearMailbox() {}
export function formatTeammateMessages() { return '' }
export function createIdleNotification() { return null }
export function isIdleNotification() { return false }
export function createPermissionRequestMessage() { return null }
export function createPermissionResponseMessage() { return null }
export function isPermissionRequest() { return false }
export function isPermissionResponse() { return false }
export function createSandboxPermissionRequestMessage() { return null }
export function createSandboxPermissionResponseMessage() { return null }
export function isSandboxPermissionRequest() { return false }
export function isSandboxPermissionResponse() { return false }
export function createShutdownRequestMessage() { return null }
export function createShutdownApprovedMessage() { return null }
export function createShutdownRejectedMessage() { return null }
export async function sendShutdownRequestToMailbox() { throw new Error('Teammate mailbox is unavailable') }
export function isShutdownRequest() { return false }
export function isPlanApprovalRequest() { return false }
export function isShutdownApproved() { return false }
export function isShutdownRejected() { return false }
export function isPlanApprovalResponse() { return false }
export function isTaskAssignment() { return false }
export function isTeamPermissionUpdate() { return false }
export function createModeSetRequestMessage() { return null }
export function isModeSetRequest() { return false }
export function isStructuredProtocolMessage() { return false }
export async function markMessagesAsReadByPredicate() {}
export function getLastPeerDmSummary() { return undefined }
`,
  "ide-disabled": `
export function isVSCodeIde() { return false }
export function isJetBrainsIde() { return false }
export function isSupportedVSCodeTerminal() { return false }
export function isSupportedJetBrainsTerminal() { return false }
export function isSupportedTerminal() { return false }
export function getTerminalIdeType() { return null }
export async function getSortedIdeLockfiles() { return [] }
export async function getIdeLockfilesPaths() { return [] }
export async function cleanupStaleIdeLockfiles() {}
export async function maybeInstallIDEExtension() { return { status: 'not_installed' } }
export async function findAvailableIDE() { return null }
export async function detectIDEs() { return [] }
export async function maybeNotifyIDEConnected() {}
export function hasAccessToIDEExtensionDiffFeature() { return false }
export async function isIDEExtensionInstalled() { return false }
export async function isCursorInstalled() { return false }
export async function isWindsurfInstalled() { return false }
export async function isVSCodeInstalled() { return false }
export async function detectRunningIDEs() { return [] }
export async function detectRunningIDEsCached() { return [] }
export function resetDetectRunningIDEs() {}
export function getConnectedIdeName() { return undefined }
export function getIdeClientName() { return undefined }
export function toIDEDisplayName(value) { return value ?? 'terminal' }
export async function callIdeRpc() { throw new Error('IDE integration is unavailable') }
export function getConnectedIdeClient() { return undefined }
export async function closeOpenDiffs() {}
export async function initializeIdeIntegration() {}
`,
  "lsp-diagnostics-disabled": `
export function registerPendingLSPDiagnostic() {}
export function checkForLSPDiagnostics() { return [] }
export function clearAllLSPDiagnostics() {}
export function resetAllLSPDiagnosticState() {}
export function clearDeliveredDiagnosticsForFile() {}
export function getPendingLSPDiagnosticCount() { return 0 }
`,
  "team-memory-disabled": `export function checkTeamMemSecrets() { return undefined }`,
  "lsp-plugin-disabled": `
export async function loadPluginLspServers() { return [] }
export function resolvePluginLspEnvironment() { return {} }
export function addPluginScopeToLspServers() { return [] }
export async function getPluginLspServers() { return [] }
export async function extractLspServersFromPlugins() { return [] }
`,
  "remote-settings-sync-disabled": `
export function resetSyncCache() {}
export function isRemoteManagedSettingsEligible() { return false }
`,
  "remote-settings-state-disabled": `
export function setSessionCache() {}
export function resetSyncCache() {}
export function setEligibility() { return false }
export function getSettingsPath() { return '' }
export function getRemoteManagedSettingsSyncFromCache() { return null }
`,
  "claude-chrome-common-disabled": `
export const CLAUDE_IN_CHROME_MCP_SERVER_NAME = 'claude-in-chrome-disabled'
export const CHROMIUM_BROWSERS = {}
export const BROWSER_DETECTION_ORDER = []
export function getAllBrowserDataPaths() { return [] }
export function getAllNativeMessagingHostsDirs() { return [] }
export function getAllWindowsRegistryKeys() { return [] }
export async function detectAvailableBrowser() { return null }
export function isClaudeInChromeMCPServer() { return false }
export function trackClaudeInChromeTabId() {}
export function isTrackedClaudeInChromeTabId() { return false }
export async function openInChrome() { return false }
export function getSocketDir() { return '' }
export function getSecureSocketPath() { return '' }
export function getAllSocketPaths() { return [] }
`,
  "claude-chrome-prompt-disabled": `
export const BASE_CHROME_PROMPT = ''
export const CHROME_TOOL_SEARCH_INSTRUCTIONS = ''
export function getChromeSystemPrompt() { return '' }
export const CLAUDE_IN_CHROME_SKILL_HINT = ''
export const CLAUDE_IN_CHROME_SKILL_HINT_WITH_WEBBROWSER = ''
`,
  "claude-chrome-setup-disabled": `
export function shouldEnableClaudeInChrome() { return false }
export function shouldAutoEnableClaudeInChrome() { return false }
export function setupClaudeInChrome() { return { enabled: false } }
export async function installChromeNativeHostManifest() { throw new Error('Claude-in-Chrome is unavailable') }
export async function isChromeExtensionInstalled() { return false }
`,
  "teleport-api-disabled": `
export const CCR_BYOC_BETA = 'disabled'
export function isTransientNetworkError() { return false }
export async function axiosGetWithRetry() { throw new Error('Remote Session API is unavailable') }
export async function prepareApiRequest() { throw new Error('Remote Session API is unavailable') }
export async function fetchCodeSessionsFromSessionsAPI() { return [] }
export function getOAuthHeaders(accessToken) { return { Authorization: 'Bearer ' + accessToken } }
export async function fetchSession() { throw new Error('Remote Session API is unavailable') }
export function getBranchFromSession() { return undefined }
export async function sendEventToRemoteSession() { throw new Error('Remote Session API is unavailable') }
export async function updateSessionTitle() { throw new Error('Remote Session API is unavailable') }
`,
  "remote-agent-task-disabled": `
export const RemoteAgentTask = { type: 'remote-agent-disabled', async restore() {} }
export async function checkRemoteAgentEligibility() { return { eligible: false, reason: 'remote agents unavailable' } }
export function formatPreconditionError() { return 'Remote agents unavailable' }
export function getRemoteTaskSessionUrl() { return undefined }
export function registerRemoteAgentTask() { throw new Error('Remote agents unavailable') }
`,
  "bridge-session-compat-disabled": `
export function setCseShimGate() {}
export function toCompatSessionId(id) { return id }
export function toInfraSessionId(id) { return id }
`,
  "task-output-constant-disabled": `export const TASK_OUTPUT_TOOL_NAME = 'TaskOutput'`,
  "task-stop-constant-disabled": `export const TASK_STOP_TOOL_NAME = 'TaskStop'; export const DESCRIPTION = ''`,
  "send-message-constant-disabled": `export const SEND_MESSAGE_TOOL_NAME = 'SendMessage'`,
  "team-create-constant-disabled": `export const TEAM_CREATE_TOOL_NAME = 'TeamCreate'`,
  "team-delete-constant-disabled": `export const TEAM_DELETE_TOOL_NAME = 'TeamDelete'`,
  "swarm-detection-disabled": `
export function isInsideTmux() { return false }
export function isInsideTmuxSync() { return false }
export function isTmuxAvailable() { return false }
export function getLeaderPaneId() { return null }
export function isInITerm2() { return false }
export function isITerm2() { return false }
export function isITerm2Installed() { return false }
export function isITerm2Available() { return false }
export const IT2_COMMAND = 'it2'
export async function isIt2CliAvailable() { return false }
export async function detectBackend() { return { type: 'in-process-disabled' } }
export function resetBackendDetection() {}
export function resetDetectionCache() {}
`,
  "swarm-team-helpers-disabled": `
export function removeTeammateFromTeamFile() {}
export function removeMemberByAgentId() {}
export async function cleanupSessionTeams() {}
export function readTeamFile() { return null }
export async function readTeamFileAsync() { return null }
export function getTeamFilePath() { return '' }
`,
};
for (const id of Object.keys(resolutionMap.runtimeFacades)) {
  if (!runtimeFacadeSources[id]) fail(`runtime facade source missing: ${id}`);
}

const resolverPlugin = {
  name: "ink-deterministic-core-resolver",
  setup(build: { onResolve: Function; onLoad: Function }) {
    build.onLoad({ filter: /\.[cm]?[jt]sx?$/ }, async (args: { path: string }) => {
      const path = sourceRelative(args.path);
      const transform = sourceTransforms.get(path);
      const applyHeadlessManualOAuth = path === headlessManualOAuthTransform.path;
      const secureStorageSelectorTransform = secureStorageSelectorTransformsByPath.get(path);
      const mcpTransformIds = mcpTransformsByPath.get(path);
      const dependencyTransform = dependencyTransformsByPath.get(args.path);
      const dreamTransform = dreamSourceTransforms.get(path);
      if (
        !transform &&
        !applyHeadlessManualOAuth &&
        !secureStorageSelectorTransform &&
        !mcpTransformIds &&
        !dependencyTransform &&
        !dreamTransform
      ) {
        return undefined;
      }
      const source = await readFile(args.path, "utf8");
      let contents = source;
      if (mcpTransformIds) {
        const result = applyMcpCompatibilityTransforms(path, contents, {
          transformIds: mcpTransformIds,
        });
        contents = result.contents;
        for (const id of result.appliedIds) appliedMcpCompatibilityIds.add(id);
        mcpCompatibilityAssertions.push(...result.assertions);
      }
      if (transform) contents = applySourceTransform(contents, transform);
      if (applyHeadlessManualOAuth) {
        contents = transformHeadlessManualOAuth(contents);
        appliedHeadlessManualOAuthTransform = true;
      }
      if (secureStorageSelectorTransform) {
        contents = transformSecureStorageSelector(path, contents);
        appliedSecureStorageSelectorTransforms.add(path);
      }
      if (dependencyTransform) {
        contents = transformDependencySource(contents, dependencyTransform);
      }
      if (dreamTransform) {
        contents = applyDreamSourceTransform(path, contents);
        appliedDreamSourceTransforms.add(path);
      }
      const loader = path.endsWith(".tsx") ? "tsx" : path.endsWith(".ts") ? "ts" : "js";
      try {
        new Bun.Transpiler({ loader }).transformSync(contents);
      } catch (error) {
        fail(`source transform produced invalid syntax: ${path}: ${String(error)}`);
      }
      if (transform) appliedTransforms.add(path);
      if (dependencyTransform) {
        appliedDependencyTransforms.add(
          `${dependencyTransform.dependency}:${dependencyTransform.path}`,
        );
      }
      return {
        contents,
        loader,
        resolveDir: dirname(args.path),
      };
    });
    build.onLoad({ filter: /.*/, namespace: "ink-mcp-compat" }, async (args: { path: string }) => ({
      contents: await readFile(args.path, "utf8"),
      loader: "ts",
      resolveDir: dirname(args.path),
    }));
    build.onLoad({ filter: /.*/, namespace: "ink-dream-compat" }, async () => ({
      contents: await readFile(dreamHelperPath, "utf8"),
      loader: "ts",
      resolveDir: dirname(dreamHelperPath),
    }));
    build.onLoad({ filter: /.*/, namespace: "ink-facade" }, (args: { path: string }) => {
      const facade = resolutionMap.virtualFacades[args.path];
      if (!facade) fail(`unknown virtual facade: ${args.path}`);
      const contents = Object.entries(facade.exports)
        .map(([exportName, target]) =>
          `export { ${target.importName} as ${exportName} } from ${JSON.stringify(`./${target.target}`)};`,
        )
        .join("\n");
      return { contents, loader: "js", resolveDir: sourceRoot };
    });
    build.onLoad({ filter: /.*/, namespace: "ink-empty" }, () => ({
      contents: "export {};",
      loader: "js",
    }));
    build.onLoad(
      { filter: /.*/, namespace: "ink-runtime-facade" },
      (args: { path: string }) => ({
        contents: runtimeFacadeSources[args.path],
        loader: "js",
      }),
    );
    build.onResolve(
      { filter: /^\.{1,2}\//, namespace: "ink-facade" },
      async (args: { path: string; importer: string }) => {
        // Facade source is synthetic, so dirname(args.importer) is not a source-tree
        // directory. Its reviewed targets are source-root-relative and covered by
        // the full-tree SHA-256 above; resolve descendants from that same root.
        const base = sourcePath(args.path);
        if (!isInsideSourceRoot(base)) fail(`facade resolver escaped source root: ${args.path}`);
        const resolved = await resolveSourceFile(base);
        if (resolved) return { path: resolved };
        recordGap({ kind: "missing-local", specifier: args.path, importer: args.importer });
        return undefined;
      },
    );
    build.onResolve({ filter: /^ink:mcp-auth\// }, (args: { path: string }) => {
      const resolved = MCP_COMPATIBILITY_VIRTUAL_MODULE_RESOLUTIONS[
        args.path as keyof typeof MCP_COMPATIBILITY_VIRTUAL_MODULE_RESOLUTIONS
      ];
      if (!resolved) fail(`unknown MCP compatibility virtual module: ${args.path}`);
      return { path: resolved, namespace: "ink-mcp-compat" };
    });
    build.onResolve({ filter: /^ink:dream-compat$/ }, () => ({ path: dreamHelperPath, namespace: "ink-dream-compat" }));
    build.onResolve(
      { filter: /^\.{1,2}\//, namespace: "ink-mcp-compat" },
      async (args: { path: string; importer: string }) => {
        const compatRoot = join(repositoryRoot, "compat", "mcp-auth", "src");
        const base = resolve(dirname(args.importer), args.path);
        const rel = relative(compatRoot, base);
        if (rel.startsWith("..") || isAbsolute(rel)) {
          fail(`MCP compatibility helper escaped its source root: ${args.path}`);
        }
        const resolved = await realpath(base);
        if (resolved !== base) fail(`MCP compatibility helper traversed a symlink: ${args.path}`);
        return { path: resolved, namespace: "ink-mcp-compat" };
      },
    );
    build.onResolve({ filter: /^src\// }, async (args: { path: string; importer: string }) => {
      const base = sourcePath(args.path);
      const runtimeFacade = runtimeFacadeForBase(base);
      if (runtimeFacade) return { path: runtimeFacade, namespace: "ink-runtime-facade" };
      const resolved = await resolveSourceFile(base);
      if (resolved) return { path: resolved };
      recordGap({ kind: "missing-local", specifier: args.path, importer: args.importer });
      return undefined;
    });
    build.onResolve({ filter: /^\.{1,2}\// }, async (args: { path: string; importer: string; namespace: string }) => {
      if (
        (args.path === "../global.d.ts" && sourceRelative(args.importer) === "src/ink/components/Box.tsx") ||
        (args.path === "./boxes.json" && sourceRelative(args.importer) === "node_modules/cli-boxes/index.js")
      ) {
        // Resolution-only dead UI leaves; the metafile DCE gates below require
        // that neither importer survives into the SDK/MCP artifact.
        return { path: args.path, namespace: "ink-empty" };
      }
      const compatRoot = join(repositoryRoot, "compat", "mcp-auth", "src");
      const importerRelativeToCompat = relative(compatRoot, args.importer);
      if (
        importerRelativeToCompat !== "" &&
        !importerRelativeToCompat.startsWith("..") &&
        !isAbsolute(importerRelativeToCompat)
      ) {
        const compatTarget = resolve(dirname(args.importer), args.path);
        const targetRelativeToCompat = relative(compatRoot, compatTarget);
        if (targetRelativeToCompat.startsWith("..") || isAbsolute(targetRelativeToCompat)) {
          fail(`MCP compatibility helper escaped its source root: ${args.path}`);
        }
        const resolvedCompatTarget = await realpath(compatTarget);
        if (resolvedCompatTarget !== compatTarget) {
          fail(`MCP compatibility helper traversed a symlink: ${args.path}`);
        }
        return { path: resolvedCompatTarget, namespace: "ink-mcp-compat" };
      }
      const syntheticFacadeImporter =
        args.namespace === "ink-facade" || Boolean(resolutionMap.virtualFacades[args.importer]);
      const base = syntheticFacadeImporter ? sourcePath(args.path) : resolve(dirname(args.importer), args.path);
      const runtimeFacade = runtimeFacadeForBase(base);
      if (runtimeFacade) return { path: runtimeFacade, namespace: "ink-runtime-facade" };
      const resolved = await resolveSourceFile(base);
      if (resolved) return { path: resolved };
      const dependencyFallback = await resolveDependencyFallback(base);
      if (dependencyFallback) return { path: dependencyFallback };
      const target = sourceRelative(base);
      const emptyModule = emptyModules.get(target);
      if (
        emptyModule &&
        emptyModule.importers.some(importer => importer.path === sourceRelative(args.importer))
      ) {
        return { path: target, namespace: "ink-empty" };
      }
      recordGap({ kind: "missing-local", specifier: args.path, importer: args.importer });
      return undefined;
    });
    build.onResolve({ filter: /^[^./].*/ }, async (args: { path: string; importer: string }) => {
      if (args.path === "react/jsx-runtime") {
        // The restored source snapshot lacks this package export. It is only
        // reached while Bun explores dead React branches; forbidden input
        // prefixes ensure no JSX importer survives the final metafile.
        return { path: args.path, namespace: "ink-empty" };
      }
      if (args.path === "bun:bundle" || builtins.has(args.path) || args.path.startsWith("src/")) {
        return undefined;
      }
      if (
        args.path === "signal-exit" &&
        sourceRelative(args.importer) === "node_modules/proper-lockfile/lib/lockfile.js"
      ) {
        // proper-lockfile consumes the v3 CommonJS callable export; Runtime and
        // execa consume the reviewed v4 named ESM API from dependencyRoots.
        return { path: sourcePath("node_modules/signal-exit/index.js") };
      }
      if (resolutionMap.virtualFacades[args.path]) {
        return { path: args.path, namespace: "ink-facade" };
      }
      const dependencyTarget = dependencyTargetForSpecifier(args.path);
      if (dependencyTarget) {
        const resolved = await resolveSourceFile(dependencyTarget);
        if (resolved) return { path: resolved };
        recordGap({
          kind: "missing-map-target",
          specifier: args.path,
          importer: args.importer,
          mappedTarget: dependencyTarget,
        });
        return undefined;
      }
      const mapped = mappedBareTarget(args.path);
      if (!mapped) {
        recordGap({ kind: "unmapped-bare", specifier: args.path, importer: args.importer });
        return undefined;
      }
      const mappedBase = sourcePath(mapped);
      const runtimeFacade = runtimeFacadeForBase(mappedBase);
      if (runtimeFacade) return { path: runtimeFacade, namespace: "ink-runtime-facade" };
      const resolved = await resolveSourceFile(mappedBase);
      if (resolved) return { path: resolved };
      recordGap({
        kind: "missing-map-target",
        specifier: args.path,
        importer: args.importer,
        mappedTarget: mapped,
      });
      return undefined;
    });
  },
};

const define = Object.fromEntries(
  Object.entries(profile.defines).map(([key, value]) => [key, JSON.stringify(value)]),
);
const entrypoints = profile.entrypoints.map(entrypoint => sourcePath(entrypoint));

let buildResult: Awaited<ReturnType<typeof Bun.build>> | undefined;
let thrownError: unknown;
try {
  buildResult = await Bun.build({
    entrypoints,
    outdir: join(outputRoot, "bundle"),
    target: profile.builder.target,
    format: profile.builder.format,
    splitting: profile.builder.splitting,
    sourcemap: profile.builder.sourcemap,
    minify: { syntax: profile.builder.minifySyntax },
    define,
    features: profile.features.enabled,
    plugins: [resolverPlugin],
    metafile: true,
    naming: { entry: "[name].js", chunk: "chunks/[name]-[hash].js" },
  });
} catch (error) {
  thrownError = error;
}

const externalModuleCommentPrefixes = [
  "// src/",
  `// ${portablePath(relative(repositoryRoot, dependencySourceRoot))}/`,
  `// ${portablePath(relative(repositoryRoot, toolchainRoot))}/`,
  `// ${portablePath(sourceRoot)}/`,
];
const forbiddenOutputIdentities = [
  portablePath(sourceRoot),
  portablePath(dependencySourceRoot),
  portablePath(toolchainRoot),
  portablePath(relative(repositoryRoot, dependencySourceRoot)),
  portablePath(relative(repositoryRoot, toolchainRoot)),
].filter(Boolean);
const outputPathScrub = { filesScanned: 0, filesChanged: 0, commentsRemoved: 0 };
const forbiddenOutputMatches = new Set<string>();
if (buildResult?.success) {
  for (const path of await filesUnder(join(outputRoot, "bundle"))) {
    if (!path.endsWith(".js")) continue;
    outputPathScrub.filesScanned += 1;
    const source = await readFile(path, "utf8");
    const lines = source.split("\n");
    const retained = lines.filter(line => {
      const remove =
        externalModuleCommentPrefixes.some(prefix => line.startsWith(prefix)) ||
        (line.startsWith("// ") && forbiddenOutputIdentities.some(identity => line.includes(identity)));
      if (remove) outputPathScrub.commentsRemoved += 1;
      return !remove;
    });
    const scrubbed = retained.join("\n");
    if (scrubbed !== source) {
      await writeFile(path, scrubbed);
      outputPathScrub.filesChanged += 1;
    }
    if (forbiddenOutputIdentities.some(identity => scrubbed.includes(identity))) {
      fail(`external source identity remained in emitted output: ${portablePath(relative(outputRoot, path))}`);
    }
    for (const forbidden of profile.dceAssertions.forbiddenOutputSubstrings) {
      if (scrubbed.includes(forbidden)) forbiddenOutputMatches.add(forbidden);
    }
  }
  for (const asset of selectedRuntimeAssets) {
    const target = join(outputRoot, "bundle", asset.output);
    await mkdir(dirname(target), { recursive: true });
    const source = runtimeAssetSourcePaths.get(asset);
    if (!source) fail(`validated runtime asset path is missing: ${asset.output}`);
    await copyFile(source, target);
    await chmod(target, asset.mode);
    const digest = createHash("sha256").update(await readFile(target)).digest("hex");
    if (digest !== asset.sha256) fail(`copied runtime asset digest drift: ${asset.output}`);
  }
}

function describeThrown(error: unknown, seen = new WeakSet<object>()): unknown {
  if (!error || typeof error !== "object") return String(error);
  if (seen.has(error)) return "[circular error detail]";
  seen.add(error);
  if (error instanceof AggregateError) {
    return {
      name: error.name,
      message: error.message,
      errors: error.errors.map(child => describeThrown(child, seen)),
    };
  }
  if (error instanceof Error) {
    return Object.fromEntries(
      [...new Set(["name", "message", ...Object.getOwnPropertyNames(error)])]
        .filter(key => key !== "stack")
        .map(key => [key, describeThrown((error as unknown as JsonObject)[key], seen)]),
    );
  }
  return Object.fromEntries(
    Object.entries(error as JsonObject).map(([key, value]) => [
      key,
      describeThrown(value, seen),
    ]),
  );
}

function sanitize(value: unknown): unknown {
  if (typeof value === "string") {
    const repositoryRelativeCandidate = resolve(repositoryRoot, value);
    if (
      !value.startsWith("<") &&
      (value.startsWith("../") || value.startsWith(`..${sep}`)) &&
      isInsideSourceRoot(repositoryRelativeCandidate)
    ) {
      return `<SOURCE_ROOT>/${sourceRelative(repositoryRelativeCandidate)}`;
    }
    if (!value.startsWith("<") && (value.startsWith("../") || isAbsolute(value))) {
      const dependency = dependencyForPath(repositoryRelativeCandidate);
      if (dependency) return sourceRelative(repositoryRelativeCandidate);
    }
    return value
      .replaceAll(outputRoot, "<CORE_OUTPUT>")
      .replaceAll(dependencySourceRoot, "<SOURCE_ROOT>")
      .replaceAll(toolchainRoot, "<TOOLCHAIN_ROOT>")
      .replaceAll(repositoryRoot, "<SOURCE_ROOT>");
  }
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as JsonObject).map(([key, child]) => [
        sanitize(key) as string,
        sanitize(child),
      ]),
    );
  }
  return value;
}

const sanitizedMetafile = sanitize(buildResult?.metafile ?? { inputs: {}, outputs: {} }) as {
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
};
const inputPaths = Object.keys(sanitizedMetafile.inputs).map(path => path.replaceAll("\\", "/"));
const logicalInputPaths = inputPaths.map(path => path.replace(/^<SOURCE_ROOT>\//, ""));
const resolutionGaps = [...gaps.values()].sort((left, right) =>
  `${left.kind}:${left.specifier}:${left.importer}`.localeCompare(
    `${right.kind}:${right.specifier}:${right.importer}`,
  ),
);
const forbiddenGapSpecifiers = new Set(
  profile.dceAssertions.forbiddenResolutionSpecifiers,
);
const requiredRemovedMainImports = [
  "react",
  "./ink.js",
  "./replLauncher.js",
  "./dialogLaunchers.js",
  "./interactiveHelpers.js",
];
const dceViolations = [
  ...(!appliedHeadlessManualOAuthTransform
    ? [`headless manual OAuth transform was not applied: ${headlessManualOAuthTransform.path}`]
    : []),
  ...secureStorageSelectorTransforms
    .filter(transform => !appliedSecureStorageSelectorTransforms.has(transform.path))
    .map(transform => `secure-storage selector transform was not applied: ${transform.path}`),
  ...profile.sourceTransforms
    .filter(transform => !appliedTransforms.has(transform.path))
    .map(transform => `source transform was not applied: ${transform.path}`),
  ...DREAM_SOURCE_TARGETS
    .filter(transform => !appliedDreamSourceTransforms.has(transform.path))
    .map(transform => `Dream compatibility transform was not applied: ${transform.path}`),
  ...resolutionMap.dependencyTransforms
    .filter(
      transform =>
        !appliedDependencyTransforms.has(`${transform.dependency}:${transform.path}`),
    )
    .map(
      transform =>
        `dependency transform was not applied: ${transform.dependency}:${transform.path}`,
    ),
  ...profile.dceAssertions.forbiddenInputSuffixes
    .filter(suffix => inputPaths.some(path => path.endsWith(suffix)))
    .map(suffix => `metafile included ${suffix}`),
  ...profile.dceAssertions.forbiddenInputPrefixes
    .filter(prefix => logicalInputPaths.some(path => path.startsWith(prefix)))
    .map(prefix => `metafile included forbidden prefix ${prefix}`),
  ...[...forbiddenOutputMatches].map(value => `bundle included forbidden output substring ${value}`),
  ...resolutionGaps
    .filter(gap => forbiddenGapSpecifiers.has(gap.specifier))
    .map(gap => `resolver reached disabled import ${gap.specifier}`),
  ...requiredRemovedMainImports
    .filter(specifier =>
      ![...removedStaticImports.values()].some(
        removed => removed.path === "src/main.tsx" && removed.specifier === specifier,
      ),
    )
    .map(specifier => `headless main retained static import ${specifier}`),
  ...profile.mcpCompatibility.requiredTransformIds
    .filter(id => !appliedMcpCompatibilityIds.has(id))
    .map(id => `headless MCP compatibility transform was not applied: ${id}`),
];
const buildSuccess = buildResult?.success === true && !thrownError;
const dceStatus = dceViolations.length > 0 ? "failed" : "passed";
const uniqueGaps = Object.values(
  resolutionGaps.reduce<Record<string, { kind: string; specifier: string; mappedTarget?: string; importers: string[] }>>(
    (accumulator, gap) => {
      const key = `${gap.kind}\0${gap.specifier}\0${gap.mappedTarget ?? ""}`;
      const current = accumulator[key] ?? {
        kind: gap.kind,
        specifier: gap.specifier,
        ...(gap.mappedTarget ? { mappedTarget: gap.mappedTarget } : {}),
        importers: [],
      };
      if (!current.importers.includes(gap.importer)) current.importers.push(gap.importer);
      current.importers.sort();
      accumulator[key] = current;
      return accumulator;
    },
    {},
  ),
).sort((left, right) =>
  `${left.kind}:${left.specifier}`.localeCompare(`${right.kind}:${right.specifier}`),
);
const sanitizedLogs = sanitize(buildResult?.logs ?? []) as unknown[];
const sanitizedThrown = thrownError
  ? sanitize(describeThrown(thrownError))
  : null;

await writeFile(
  join(outputRoot, "metafile.json"),
  `${JSON.stringify(sanitizedMetafile, null, 2)}\n`,
);
await writeFile(
  join(outputRoot, "resolution-gaps.json"),
  `${JSON.stringify({
    schemaVersion: "ink-core-resolution-gaps/v1",
    edgeCount: resolutionGaps.length,
    uniqueGapCount: uniqueGaps.length,
    uniqueGaps,
    gaps: resolutionGaps,
  }, null, 2)}\n`,
);
const receipt = {
  schemaVersion: "ink-core-prune-build/v1",
  status: buildSuccess && dceStatus === "passed" ? "built" : "blocked",
  sourceVersionEvidence: profile.sourceVersionEvidence,
  cliCompatibilityVersion: profile.cliCompatibilityVersion,
  runtimeTarget,
  sourceDigest,
  sourceLayout: {
    implementationRoot: "src",
    entrypoint: "src/entrypoints/cli.tsx",
    provenance: "runtime/source-provenance.json",
    singleSource: true,
    implementationSource: "repository",
    externalRootUse: "recovered-dependencies-only",
    parallelImplementation: false,
  },
  builder: {
    runtime: "bun",
    version: Bun.version,
    target: profile.builder.target,
    format: profile.builder.format,
  },
  entrypoints: profile.entrypoints,
  outputDirectory: profile.outputDirectory,
  runtimeAssets: selectedRuntimeAssets.map(({ sourceRoot, sourceIdentity, output, sha256, mode, license }) => ({
    sourceRoot: sourceRoot ?? "authorized-package",
    sourceIdentity: sourceIdentity ?? `@anthropic-ai/claude-code@${profile.sourceVersionEvidence}`,
    output,
    sha256,
    mode,
    license,
  })),
  features: profile.features,
  defines: Object.keys(profile.defines).sort(),
  requiredCapabilities: profile.requiredCapabilities,
  capabilityInputAssertions: profile.capabilityInputAssertions,
  featureDisposition: profile.featureDisposition,
  virtualFacades: Object.keys(resolutionMap.virtualFacades).sort(),
  runtimeFacades: Object.entries(resolutionMap.runtimeFacades)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, facade]) => ({ id, target: facade.target, sha256: facade.sha256 })),
  dependencyRoots: Object.fromEntries(
    Object.entries(resolutionMap.dependencyRoots)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, dependency]) => [
        name,
        {
          version: dependency.version,
          license: dependency.license,
          treeSha256: dependency.treeSha256,
          fallbackOnly: dependency.fallbackOnly,
        },
      ]),
  ),
  dependencyTransforms: resolutionMap.dependencyTransforms.map(
    ({ dependency, path, sha256, transform }) => ({
      dependency,
      path,
      sha256,
      transform,
      applied: appliedDependencyTransforms.has(`${dependency}:${path}`),
    }),
  ),
  emptyModuleAllowlist: profile.emptyModuleAllowlist.map(entry => entry.target).sort(),
  mcpCompatibility: {
    artifactKind: profile.mcpCompatibility.artifactKind,
    requiredTransformIds: [...profile.mcpCompatibility.requiredTransformIds].sort(),
    appliedTransformIds: [...appliedMcpCompatibilityIds].sort(),
    assertions: mcpCompatibilityAssertions,
    virtualModules: Object.keys(MCP_COMPATIBILITY_VIRTUAL_MODULE_RESOLUTIONS).sort(),
  },
  dreamCompatibility: {
    requiredTargets: DREAM_SOURCE_TARGETS,
    appliedSourcePaths: [...appliedDreamSourceTransforms].sort(),
    helper: "compat/dream-runtime/policy.ts",
    helperSha256: dreamHelperSha256,
    transformerSha256: dreamTransformerSha256,
    virtualModule: "ink:dream-compat",
    originalSourceModified: false,
  },
  sourceTransforms: profile.sourceTransforms.map(({ path, sha256, transform }) => ({
    path,
    sha256,
    transform,
  })),
  removedStaticImports: [...removedStaticImports.values()].sort((left, right) =>
    `${left.path}:${left.specifier}:${left.bindings.join(",")}`.localeCompare(
      `${right.path}:${right.specifier}:${right.bindings.join(",")}`,
    ),
  ),
  removedToolRenderProperties: Object.fromEntries(
    [...removedToolRenderProperties.entries()].sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  ),
  dceAssertions: {
    status: dceStatus,
    forbiddenInputPrefixes: profile.dceAssertions.forbiddenInputPrefixes,
    forbiddenInputSuffixes: profile.dceAssertions.forbiddenInputSuffixes,
    forbiddenResolutionSpecifiers: profile.dceAssertions.forbiddenResolutionSpecifiers,
    forbiddenOutputSubstrings: profile.dceAssertions.forbiddenOutputSubstrings,
    violations: dceViolations,
  },
  resolution: {
    exactEntries: Object.keys(resolutionMap.exact).length,
    prefixEntries: Object.keys(resolutionMap.prefix).length,
    virtualFacadeEntries: Object.keys(resolutionMap.virtualFacades).length,
    edgeGapCount: resolutionGaps.length,
    uniqueGapCount: uniqueGaps.length,
  },
  build: {
    success: buildSuccess,
    outputCount: buildResult?.outputs.length ?? 0,
    logs: sanitizedLogs,
    thrown: sanitizedThrown,
    outputPathScrub,
  },
};
await writeFile(
  join(outputRoot, "build-receipt.json"),
  `${JSON.stringify(receipt, null, 2)}\n`,
);

if (receipt.status !== "built") {
  process.stderr.write(
    `[core-prune] blocked: ${uniqueGaps.length} unique resolution gap(s) across ${resolutionGaps.length} edges, DCE=${dceStatus}; see dist/core-local/build-receipt.json\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write(
    `${JSON.stringify({ status: receipt.status, sourceDigest, outputCount: receipt.build.outputCount, dce: dceStatus })}\n`,
  );
}
