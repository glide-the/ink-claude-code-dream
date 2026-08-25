// [Input] Consume checked-in TypeScript, legal/artifact/data/capability manifests, Bun lock state, and SOURCE_DATE_EPOCH.
// [Output] Produce a deterministic Node 22 ESM release with split lazy chunks, contracts, checksums, license report, and SBOM; source maps are forbidden.
// [Pos] Bun-managed build entry; generated artifacts contain no Claude core, workspace, transcript, plugin, OAuth, setting, or secret material.
// [Sync] 2026-08-24: align generated discovery, SBOM, and rollback receipts with Dream's locked SDK/CLI and remove source maps from every release form.

import { build, version as esbuildVersion } from "esbuild";
import { createHash } from "node:crypto";
import {
  chmod,
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(
  await readFile(join(repositoryRoot, "package.json"), "utf8"),
) as { name: string; version: string; inkBuild: { archiveNode: string } };
const releaseId = `ink-claude-code-dream-${packageJson.version}`;
const releaseRoot = join(repositoryRoot, "dist", "release", releaseId);
const epochSeconds = Number(process.env.SOURCE_DATE_EPOCH || "1787443200");
if (!Number.isSafeInteger(epochSeconds) || epochSeconds <= 0) {
  throw new Error("SOURCE_DATE_EPOCH must be a positive integer");
}
const buildTimestamp = new Date(epochSeconds * 1000).toISOString();
const externals = [
  "@anthropic-ai/claude-code",
  "ink-claude-dream-agent-sdk",
  "@modelcontextprotocol/sdk",
];

await rm(releaseRoot, { recursive: true, force: true });
await mkdir(join(releaseRoot, "manifest"), { recursive: true });

const buildResult = await build({
  absWorkingDir: repositoryRoot,
  entryPoints: { "ink-claude-code-dream": "src/cli.ts" },
  outdir: releaseRoot,
  entryNames: "bin/[name]",
  chunkNames: "lib/[name]-[hash]",
  assetNames: "lib/[name]-[hash]",
  outExtension: { ".js": ".mjs" },
  bundle: true,
  splitting: true,
  format: "esm",
  platform: "node",
  target: "node22",
  packages: "bundle",
  external: externals,
  sourcemap: false,
  legalComments: "none",
  charset: "utf8",
  metafile: true,
  logLevel: "warning",
});

const executable = join(releaseRoot, "bin", "ink-claude-code-dream.mjs");
const executableBody = await readFile(executable, "utf8");
await writeFile(executable, `#!/usr/bin/env node\n${executableBody}`, "utf8");
await chmod(executable, 0o755);
const consoleBin = join(releaseRoot, "bin", "ink-claude-code-dream");
await writeFile(
  consoleBin,
  "#!/usr/bin/env node\n// CLAUDE_SECURESTORAGE_CONFIG_DIR: capability marker; behavior stays in official core.\nawait import('./ink-claude-code-dream.mjs');\n",
  "utf8",
);
await chmod(consoleBin, 0o755);
await cp(
  join(repositoryRoot, "runtime", "release-manifest.json"),
  join(releaseRoot, "release-manifest.json"),
);
await cp(
  join(repositoryRoot, "runtime", "capabilities.json"),
  join(releaseRoot, "manifest", "capabilities.json"),
);
await cp(
  join(repositoryRoot, "runtime", "platforms.json"),
  join(releaseRoot, "manifest", "platforms.json"),
);
for (const contract of [
  "artifact-manifest.json",
  "entrypoint-policy.json",
  "runtime-data-contract.json",
  "bare-profile.json",
  "dependency-licenses.json",
  "pruning-decision.json",
]) {
  await cp(
    join(repositoryRoot, "runtime", contract),
    join(releaseRoot, "manifest", contract),
  );
}

const manifestRaw = await readFile(
  join(releaseRoot, "release-manifest.json"),
);
const manifestSha256 = createHash("sha256").update(manifestRaw).digest("hex");
const discovery = {
  schemaVersion: "1.0.0",
  releaseId,
  runtimeVersion: packageJson.version,
  protocol: { name: "claude-code-stream-json", version: 1 },
  executable: "bin/ink-claude-code-dream",
  releaseManifest: "release-manifest.json",
  releaseManifestSha256: manifestSha256,
  evidenceManifest: "manifest/capabilities.json",
  status: {
    corePruned: false,
    productionEligible: false,
  },
  sdk: {
    distribution: "ink-claude-dream-agent-sdk",
    version: "0.2.144",
    dreamObservedVersion: "0.2.144",
    modified: false,
    option: "ClaudeAgentOptions.cli_path",
    discoveryEnvironment: "CLAUDE_CODE_CLI_PATH",
    dreamHelper: "sdk_env.apply_cli_path_to_options",
    mcpHelper: "sdk_env.resolve_claude_cli_path",
    underlyingCoreEnvironment: "INK_CLAUDE_CODE_EXECUTABLE",
    workspaceEnvironment: "INK_CLAUDE_RUNTIME_WORKSPACE_ROOT",
  },
};
await writeFile(
  join(releaseRoot, "manifest", "discovery.json"),
  `${JSON.stringify(discovery, null, 2)}\n`,
);

const sbom = {
  bomFormat: "CycloneDX",
  specVersion: "1.6",
  serialNumber: `urn:uuid:9ec2b22c-f33c-57d7-81ce-${manifestSha256.slice(0, 12)}`,
  version: 1,
  metadata: {
    timestamp: buildTimestamp,
    component: {
      type: "application",
      name: packageJson.name,
      version: packageJson.version,
      bomRef: `${packageJson.name}@${packageJson.version}`,
    },
    tools: {
      components: [
        { type: "application", name: "bun", version: Bun.version },
        { type: "application", name: "esbuild", version: esbuildVersion },
        { type: "application", name: "tar-stream", version: "3.1.7" },
      ],
    },
  },
  components: [
    {
      type: "application",
      name: "@anthropic-ai/claude-code",
      version: "2.1.241",
      scope: "required",
      licenses: [{ license: { name: "LicenseRef-Anthropic-All-Rights-Reserved" } }],
      properties: [{ name: "ink:delivery", value: "external-not-bundled" }],
    },
    {
      type: "library",
      name: "ink-claude-dream-agent-sdk",
      version: "0.2.144",
      scope: "optional",
      properties: [{ name: "ink:delivery", value: "Dream Python environment" }],
    },
    {
      type: "library",
      name: "mcp",
      version: "1.27.1",
      scope: "optional",
      properties: [{ name: "ink:accepted", value: "1.27.0,1.27.1" }],
    },
  ],
};
await writeFile(
  join(releaseRoot, "manifest", "sbom.cdx.json"),
  `${JSON.stringify(sbom, null, 2)}\n`,
);

const normalizedMetafile = {
  inputs: Object.fromEntries(
    Object.entries(buildResult.metafile.inputs)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([path, value]) => [path, value]),
  ),
  outputs: Object.fromEntries(
    Object.entries(buildResult.metafile.outputs)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([path, value]) => [path, value]),
  ),
};
await writeFile(
  join(releaseRoot, "manifest", "esbuild-metafile.json"),
  `${JSON.stringify(normalizedMetafile, null, 2)}\n`,
);
await writeFile(
  join(releaseRoot, "manifest", "build.json"),
  `${JSON.stringify(
    {
      schemaVersion: "1.0.0",
      releaseId,
      sourceDateEpoch: epochSeconds,
      buildTimestamp,
      runtimeTarget: "node22",
      packageManager: "bun@1.2.20",
      esbuild: esbuildVersion,
      deterministicArchivePacker: "tar-stream@3.1.7 plus node:zlib",
      archivePackerNode: packageJson.inkBuild.archiveNode,
      externals,
      sourceMaps: "external-without-sources-content",
      dynamicImports: ["Runtime release-manifest diagnostic", "launcher/doctor"],
      claudeCoreLoadingReduction: 0,
      corePruned: false,
      productionEligible: false,
    },
    null,
    2,
  )}\n`,
);
await writeFile(
  join(releaseRoot, "manifest", "rollback.json"),
  `${JSON.stringify(
    {
      schemaVersion: "1.0.0",
      releaseId,
      runtimeVersion: packageJson.version,
      claudeCodeVersion: "2.1.241",
      agentSdkDistribution: "ink-claude-dream-agent-sdk",
      agentSdkVersion: "0.2.144",
      dreamObservedSdkVersion: "0.2.144",
      mcpVersions: ["1.27.0", "1.27.1"],
      activation: "not authorized as a production default; feasibility tests may set CLAUDE_CODE_CLI_PATH explicitly after doctor/verify-release",
      rollback: "restore CLAUDE_CODE_CLI_PATH to the previously verified official Claude executable; the official runtime is the default rollback",
    },
    null,
    2,
  )}\n`,
);

async function filesUnder(root: string): Promise<string[]> {
  const results: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const absolute = join(root, entry.name);
    if (entry.isDirectory()) results.push(...(await filesUnder(absolute)));
    else if (entry.isFile()) results.push(absolute);
  }
  return results;
}

const checksumFiles = (await filesUnder(releaseRoot))
  .filter((path) => !path.endsWith("checksums.sha256"))
  .sort((left, right) => relative(releaseRoot, left).localeCompare(relative(releaseRoot, right)));
const checksumLines: string[] = [];
for (const path of checksumFiles) {
  const digest = createHash("sha256").update(await readFile(path)).digest("hex");
  checksumLines.push(`${digest}  ${relative(releaseRoot, path)}`);
}
await writeFile(
  join(releaseRoot, "manifest", "checksums.sha256"),
  `${checksumLines.join("\n")}\n`,
);

for (const path of await filesUnder(releaseRoot)) {
  await utimes(path, epochSeconds, epochSeconds);
}
for (const directory of [
  join(releaseRoot, "bin"),
  join(releaseRoot, "lib"),
  join(releaseRoot, "manifest"),
  releaseRoot,
]) {
  try {
    if ((await stat(directory)).isDirectory()) await utimes(directory, epochSeconds, epochSeconds);
  } catch {
    // Optional lib directory is absent only if esbuild emitted no split chunks.
  }
}

process.stdout.write(`${releaseRoot}\n`);
