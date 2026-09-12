// [Input] Repository-authored src/cleanroom, the checked clean-room npm policy, lockfile, and exact Bun 1.4.0.
// [Output] Four target-specific standalone executables plus deterministic build manifests under dist/cleanroom-targets.
// [Pos] Restored-source-free multi-platform compiler; source maps and runtime config autoloading are always disabled.
// [Sync] 2026-08-24: add the clean-room darwin/linux arm64/x64 standalone build matrix.
// [Sync] 2026-09-12: prepare the fail-closed Runtime 0.1.6 four-target candidate.

import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

type Platform = {
  package: string;
  os: string;
  cpu: string;
  bunTarget: string;
  binaryFormat: string;
};

type Policy = {
  schemaVersion: string;
  version: string;
  license: string;
  bunVersion: string;
  entrypoint: string;
  buildRoot: string;
  platforms: Record<string, Platform>;
  materialPolicy: { sourceMapsAllowed: boolean; forbiddenBytePatterns: string[] };
};

const repositoryRoot = resolve(import.meta.dirname, "..");
const policyPath = join(repositoryRoot, "runtime", "cleanroom-npm-policy.json");
const policy = JSON.parse(await readFile(policyPath, "utf8")) as Policy;
const allowedTargets = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"];

function fail(message: string): never {
  throw new Error(`[build-cleanroom-targets] ${message}`);
}

function sha256(body: string | Uint8Array): string {
  return createHash("sha256").update(body).digest("hex");
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, stableValue(child)]),
    );
  }
  return value;
}

function stableJson(value: unknown): string {
  return `${JSON.stringify(stableValue(value), null, 2)}\n`;
}

async function sourceInventory(root: string): Promise<Array<{ path: string; bytes: number; sha256: string }>> {
  const output: Array<{ path: string; bytes: number; sha256: string }> = [];
  async function walk(directory: string): Promise<void> {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = join(directory, entry.name);
      if (entry.isSymbolicLink()) fail(`source symlink is forbidden: ${absolute}`);
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile()) {
        const body = await readFile(absolute);
        output.push({
          path: relative(repositoryRoot, absolute).split("\\").join("/"),
          bytes: body.byteLength,
          sha256: sha256(body),
        });
      } else fail(`non-regular source material is forbidden: ${absolute}`);
    }
  }
  await walk(root);
  return output;
}

function inspectBinary(body: Buffer): string {
  if (body.length < 20) fail("compiled executable is too small");
  if (body.subarray(0, 4).equals(Buffer.from([0xcf, 0xfa, 0xed, 0xfe]))) {
    const cpu = body.readUInt32LE(4);
    if (cpu === 0x0100000c) return "mach-o-64-arm64";
    if (cpu === 0x01000007) return "mach-o-64-x64";
  }
  if (body.subarray(0, 6).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01]))) {
    const machine = body.readUInt16LE(18);
    if (machine === 0xb7) return "elf-64-arm64";
    if (machine === 0x3e) return "elf-64-x64";
  }
  fail(`unknown executable magic: ${body.subarray(0, 20).toString("hex")}`);
}

function parseTargets(argv: string[]): string[] {
  const selected: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== "--target") fail(`unknown argument: ${argv[index]}`);
    const value = argv[index + 1];
    if (!value) fail("--target requires a value");
    selected.push(value);
    index += 1;
  }
  return selected.length > 0 ? [...new Set(selected)] : allowedTargets;
}

if (
  policy.schemaVersion !== "ink-cleanroom-npm-policy/v1" ||
  policy.version !== "0.1.6" ||
  policy.license !== "MIT" ||
  policy.bunVersion !== "1.4.0" ||
  policy.entrypoint !== "src/cleanroom/cli.ts" ||
  policy.materialPolicy.sourceMapsAllowed !== false ||
  JSON.stringify(Object.keys(policy.platforms)) !== JSON.stringify(allowedTargets)
) {
  fail("checked policy identity, target order, license, or no-map contract drift");
}
if (Bun.version !== policy.bunVersion) fail(`requires Bun ${policy.bunVersion}; received ${Bun.version}`);

const targets = parseTargets(process.argv.slice(2));
for (const target of targets) if (!allowedTargets.includes(target)) fail(`unsupported target: ${target}`);

const sourceRoot = join(repositoryRoot, "src", "cleanroom");
const entrypoint = join(repositoryRoot, policy.entrypoint);
const buildRoot = join(repositoryRoot, policy.buildRoot);
const sources = await sourceInventory(sourceRoot);
if (!sources.some(item => item.path === policy.entrypoint)) fail("clean-room entrypoint is absent from source inventory");
const sourceTreeSha256 = sha256(stableJson(sources));
const lockfileSha256 = sha256(await readFile(join(repositoryRoot, "bun.lock")));

if (targets.length === allowedTargets.length) await rm(buildRoot, { recursive: true, force: true });
await mkdir(buildRoot, { recursive: true });

const receipts: unknown[] = [];
for (const target of targets) {
  const platform = policy.platforms[target];
  if (!platform || `${platform.os}-${platform.cpu}` !== target) fail(`invalid platform policy: ${target}`);
  const targetRoot = join(buildRoot, target);
  const executable = join(targetRoot, "claude");
  await rm(targetRoot, { recursive: true, force: true });
  await mkdir(targetRoot, { recursive: true });

  const buildArgs = [
    "build",
    "--compile",
    `--target=${platform.bunTarget}`,
    "--minify",
    "--no-compile-autoload-dotenv",
    "--no-compile-autoload-bunfig",
    "--no-compile-autoload-tsconfig",
    "--no-compile-autoload-package-json",
    "--sourcemap=none",
    `--outfile=${executable}`,
    entrypoint,
  ];
  const child = Bun.spawn([process.execPath, ...buildArgs], {
    cwd: repositoryRoot,
    env: { ...process.env, BUN_CONFIG_NO_CLEAR_TERMINAL: "1" },
    stdout: "inherit",
    stderr: "inherit",
  });
  const status = await child.exited;
  if (status !== 0) fail(`${target} compile failed with exit code ${status}`);
  await chmod(executable, 0o755);

  const body = await readFile(executable);
  const binaryFormat = inspectBinary(body);
  if (binaryFormat !== platform.binaryFormat) fail(`${target} format mismatch: ${binaryFormat}`);
  for (const pattern of policy.materialPolicy.forbiddenBytePatterns) {
    if (body.includes(Buffer.from(pattern))) fail(`${target} contains forbidden byte pattern: ${pattern}`);
  }
  const executableInfo = await stat(executable);
  const manifest = {
    schemaVersion: "ink-cleanroom-target-build/v1",
    runtime: { name: "ink-claude-code-dream", version: policy.version, license: policy.license },
    target,
    os: platform.os,
    cpu: platform.cpu,
    bun: { version: Bun.version, target: platform.bunTarget },
    build: {
      entrypoint: policy.entrypoint,
      sourcemap: "none",
      compileAutoload: { dotenv: false, bunfig: false, tsconfig: false, packageJson: false },
      sourceTreeSha256,
      lockfileSha256,
      sourceFiles: sources,
    },
    executable: {
      path: "claude",
      bytes: executableInfo.size,
      sha256: sha256(body),
      format: binaryFormat,
    },
  };
  await writeFile(join(targetRoot, "build-manifest.json"), stableJson(manifest));
  receipts.push({ target, bytes: executableInfo.size, sha256: sha256(body), format: binaryFormat });
}

process.stdout.write(stableJson({ status: "cleanroom-targets-built", bunVersion: Bun.version, targets: receipts }));
