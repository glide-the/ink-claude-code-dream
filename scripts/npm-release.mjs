#!/usr/bin/env node
// [Input] Checked-in npm/local artifact policies and one production-qualified target-native local core package.
// [Output] Print layout, gate publication, stage one native platform, or aggregate four tgz files into one bound meta package.
// [Pos] Reproducible npm package generator; it never reads restored source and cannot override legal flags by environment.

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmod,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const policyPath = path.join(repositoryRoot, "runtime", "npm-release-policy.json");
const localPolicyPath = path.join(repositoryRoot, "runtime", "local-artifact-policy.json");
const defaultOutputRoot = path.join(repositoryRoot, "dist", "npm-stage");
const allowedTargets = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"];

function fail(message) {
  throw new Error(`[npm-release] ${message}`);
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, stableValue(child)]),
    );
  }
  return value;
}

function stableJson(value) {
  return `${JSON.stringify(stableValue(value), null, 2)}\n`;
}

function sha256(body) {
  return createHash("sha256").update(body).digest("hex");
}

async function readJson(file, label) {
  const info = await lstat(file).catch(() => null);
  if (!info?.isFile() || info.isSymbolicLink()) fail(`${label} must be a regular non-symlink file`);
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    fail(`${label} is not valid JSON`);
  }
}

function parseArguments(argv) {
  const [command = "plan", ...rest] = argv;
  if (!["plan", "templates", "legal", "gate", "stage", "aggregate-meta"].includes(command)) fail(`unknown command: ${command}`);
  const values = {};
  const names = new Map([
    ["--package-root", "packageRoot"],
    ["--output-root", "outputRoot"],
    ["--target", "target"],
    ["--tarball-dir", "tarballDir"],
  ]);
  for (let index = 0; index < rest.length; index += 1) {
    const name = names.get(rest[index]);
    if (!name) fail(`unknown argument: ${rest[index]}`);
    const value = rest[index + 1];
    if (!value || value.startsWith("--")) fail(`${rest[index]} requires a value`);
    values[name] = name === "target" ? value : path.resolve(value);
    index += 1;
  }
  return { command, values };
}

async function filesUnder(root) {
  const results = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isSymbolicLink()) fail(`symlinks are forbidden in npm material: ${absolute}`);
    if (entry.isDirectory()) results.push(...(await filesUnder(absolute)));
    else if (entry.isFile()) results.push(absolute);
    else fail(`non-regular npm material is forbidden: ${absolute}`);
  }
  return results.sort();
}

function relativePosix(root, file) {
  return path.relative(root, file).split(path.sep).join("/");
}

function validatePolicy(policy, localPolicy) {
  if (
    policy.schemaVersion !== "ink-npm-release-policy/v1" ||
    policy.repository !== "glide-the/ink-claude-code-dream" ||
    policy.scope !== "@glide-the" ||
    policy.metaPackage !== "@glide-the/ink-claude-code-dream" ||
    policy.bun?.package !== "bun" ||
    policy.bun?.version !== "1.4.0" ||
    policy.materialPolicy?.sourceMapsAllowed !== false ||
    !policy.materialPolicy?.forbiddenSuffixes?.includes(".map")
  ) {
    fail("npm release policy identity/toolchain/material contract drift");
  }
  if (JSON.stringify(Object.keys(policy.platforms)) !== JSON.stringify(allowedTargets)) {
    fail("npm platform matrix must cover exactly darwin/linux arm64/x64 in stable order");
  }
  if (JSON.stringify(localPolicy.artifact?.supportedTargets) !== JSON.stringify(allowedTargets)) {
    fail("local core and npm target matrices differ");
  }
  for (const [target, platform] of Object.entries(policy.platforms)) {
    if (
      target !== `${platform.os}-${platform.cpu}` ||
      platform.package !== `${policy.metaPackage}-${target}` ||
      !/^[a-f0-9]{64}$/.test(platform.ripgrepSha256) ||
      !platform.ripgrepPath.includes(`/vendor/ripgrep/${platform.cpu}-${platform.os}/`)
    ) {
      fail(`invalid npm platform definition: ${target}`);
    }
  }
  if (!policy.unsupported?.["win32-x64"] || !policy.unsupported?.["win32-arm64"]) {
    fail("Windows must remain explicitly fail-closed until qualified");
  }
  if (
    policy.publish?.qualificationWorkflow !== ".github/workflows/qualify-npm-runtime.yml" ||
    policy.publish?.bootstrap?.trustedPublishingRequiresExistingPackages !== true ||
    policy.publish?.bootstrap?.initialPackageCount !== 5
  ) {
    fail("qualification workflow/bootstrap policy drift");
  }
}

function layout(policy, localPolicy) {
  return {
    schemaVersion: policy.schemaVersion,
    repository: policy.repository,
    version: policy.version,
    metaPackage: {
      name: policy.metaPackage,
      bin: policy.command,
      optionalDependencies: Object.fromEntries(
        Object.values(policy.platforms).map(platform => [platform.package, policy.version]),
      ),
    },
    platforms: Object.fromEntries(
      Object.entries(policy.platforms).map(([target, platform]) => [target, {
        package: platform.package,
        os: [platform.os],
        cpu: [platform.cpu],
        runtimeAsset: platform.ripgrepPath,
        runtimeAssetSha256: platform.ripgrepSha256,
        bun: `${policy.bun.package}@${policy.bun.version}`,
      }]),
    ),
    unsupported: policy.unsupported,
    sourceMapsAllowed: false,
    legalGate: {
      publicationAllowed: localPolicy.legalGate.publicationAllowed,
      redistributionAllowed: localPolicy.legalGate.redistributionAllowed,
    },
  };
}

async function verifiedPackage(packageRoot, policy, localPolicy) {
  const info = await lstat(packageRoot).catch(() => null);
  if (!info?.isDirectory() || info.isSymbolicLink()) fail("core package root must be a non-symlink directory");
  const resolvedRoot = await realpath(packageRoot);
  const verifier = path.join(repositoryRoot, policy.runtimeVerifier);
  const result = spawnSync(process.execPath, [verifier, "--package-root", resolvedRoot], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  if (result.status !== 0) fail(`qualified minimal-core verification failed\n${result.stdout}${result.stderr}`);
  const receipt = JSON.parse(result.stdout.trim());
  const [artifactPolicy, artifactManifest, releaseManifest, coreReceipt] = await Promise.all([
    readJson(path.join(resolvedRoot, "manifest", "local-artifact-policy.json"), "artifact local policy"),
    readJson(path.join(resolvedRoot, "manifest", "artifact-manifest.json"), "artifact manifest"),
    readJson(path.join(resolvedRoot, "release-manifest.json"), "release manifest"),
    readJson(path.join(resolvedRoot, "manifest", "core-build-receipt.json"), "core build receipt"),
  ]);
  if (receipt.productionEligible !== true || releaseManifest.status?.productionEligible !== true) {
    fail("Runtime is not production-qualified");
  }
  const gates = [
    ["checked policy publicationAllowed", localPolicy.legalGate?.publicationAllowed],
    ["checked policy redistributionAllowed", localPolicy.legalGate?.redistributionAllowed],
    ["artifact policy publicationAllowed", artifactPolicy.legalGate?.publicationAllowed],
    ["artifact policy redistributionAllowed", artifactPolicy.legalGate?.redistributionAllowed],
    ["artifact manifest publicationAllowed", artifactManifest.artifact?.publicationAllowed],
    ["artifact manifest redistributionAllowed", artifactManifest.artifact?.redistributionAllowed],
    ["release manifest publicationAllowed", releaseManifest.status?.publicationAllowed],
    ["release manifest redistributionAllowed", releaseManifest.status?.redistributionAllowed],
  ];
  const closed = gates.filter(([, value]) => value !== true).map(([name]) => name);
  if (closed.length > 0) {
    fail(`npm publication blocked (fail-closed): ${closed.join(", ")}`);
  }
  if (!policy.publish?.license || policy.publish.license === "UNLICENSED") {
    fail("npm publication license is not authorized in npm-release-policy.json");
  }
  if (
    policy.publish.license !== localPolicy.legalGate?.publicationLicense ||
    !localPolicy.legalGate?.authorizationReference
  ) {
    fail("npm license/authorization must match the checked local artifact policy");
  }
  return { packageRoot: resolvedRoot, artifactPolicy, artifactManifest, releaseManifest, coreReceipt };
}

function assertCheckedLegalGate(localPolicy) {
  const closed = [
    ["publicationAllowed", localPolicy.legalGate?.publicationAllowed],
    ["redistributionAllowed", localPolicy.legalGate?.redistributionAllowed],
  ].filter(([, value]) => value !== true).map(([name]) => name);
  if (closed.length > 0) {
    fail(`npm publication blocked by checked policy (fail-closed): ${closed.join(", ")}`);
  }
}

async function assertTargetMaterial(context, target, policy) {
  const platform = policy.platforms[target];
  if (!platform) fail(`unsupported target: ${target}`);
  if (target !== `${process.platform}-${process.arch}`) {
    fail(`npm staging must run natively: host=${process.platform}-${process.arch}, target=${target}`);
  }
  if (
    context.coreReceipt.runtimeTarget !== target ||
    context.releaseManifest.core?.runtimeTarget !== target ||
    context.artifactManifest.artifact?.runtimeTarget !== target
  ) {
    fail("core package target identity does not match requested npm target");
  }
  const platformAssets = Object.values(policy.platforms).map(value => value.ripgrepPath);
  for (const asset of platformAssets) {
    const info = await lstat(path.join(context.packageRoot, asset)).catch(() => null);
    if (asset === platform.ripgrepPath) {
      if (!info?.isFile() || info.isSymbolicLink()) fail(`required target ripgrep is missing: ${asset}`);
      const digest = sha256(await readFile(path.join(context.packageRoot, asset)));
      if (digest !== platform.ripgrepSha256) fail(`target ripgrep checksum drift: ${asset}`);
    } else if (info) {
      fail(`cross-platform ripgrep material is forbidden: ${asset}`);
    }
  }
  for (const file of await filesUnder(context.packageRoot)) {
    const relative = relativePosix(context.packageRoot, file).toLowerCase();
    if (policy.materialPolicy.forbiddenSuffixes.some(suffix => relative.endsWith(suffix))) {
      fail(`forbidden npm file suffix: ${relative}`);
    }
    if (relative.split("/").some(segment => policy.materialPolicy.forbiddenPathSegments.includes(segment))) {
      fail(`mutable/user data is forbidden in npm package: ${relative}`);
    }
  }
}

function launcherBody(policy) {
  const cases = Object.entries(policy.platforms)
    .map(([target, platform]) => `  ${target}) INK_PLATFORM_PACKAGE=${platform.package.split("/")[1]} ;;`)
    .join("\n");
  return `#!/bin/sh\nset -eu\nINK_OS=$(uname -s | tr '[:upper:]' '[:lower:]')\ncase "$INK_OS" in darwin) ;; linux) ;; *) echo "unsupported operating system: $INK_OS" >&2; exit 78 ;; esac\nif [ "$INK_OS" = linux ]; then\n  if command -v getconf >/dev/null 2>&1 && getconf GNU_LIBC_VERSION >/dev/null 2>&1; then :;\n  elif command -v ldd >/dev/null 2>&1 && ldd --version 2>&1 | head -n 1 | grep -Eiq 'glibc|GNU libc'; then :;\n  else echo "linux musl/unknown libc is not qualified; glibc is required" >&2; exit 78; fi\nfi\nINK_ARCH=$(uname -m)\ncase "$INK_ARCH" in arm64|aarch64) INK_ARCH=arm64 ;; x86_64|amd64) INK_ARCH=x64 ;; *) echo "unsupported architecture: $INK_ARCH" >&2; exit 78 ;; esac\nINK_TARGET=$INK_OS-$INK_ARCH\ncase "$INK_TARGET" in\n${cases}\n  *) echo "unqualified Runtime target: $INK_TARGET" >&2; exit 78 ;;\nesac\nINK_ENTRYPOINT=$0\nwhile [ -L "$INK_ENTRYPOINT" ]; do\n  INK_DIR=$(CDPATH= cd -- "$(dirname -- "$INK_ENTRYPOINT")" && pwd)\n  INK_LINK=$(readlink "$INK_ENTRYPOINT")\n  case "$INK_LINK" in /*) INK_ENTRYPOINT=$INK_LINK ;; *) INK_ENTRYPOINT=$INK_DIR/$INK_LINK ;; esac\ndone\nINK_META_ROOT=$(CDPATH= cd -- "$(dirname -- "$INK_ENTRYPOINT")/.." && pwd)\nINK_PLATFORM_ROOT=$INK_META_ROOT/../$INK_PLATFORM_PACKAGE\nif [ ! -x "$INK_PLATFORM_ROOT/bin/ink-claude-code-dream-platform" ]; then\n  echo "missing optional platform package @glide-the/$INK_PLATFORM_PACKAGE" >&2\n  exit 78\nfi\nexec "$INK_PLATFORM_ROOT/bin/ink-claude-code-dream-platform" "$@"\n`;
}

function platformLauncherBody(policy, target) {
  const glibcGate = target.startsWith("linux-")
    ? `if command -v getconf >/dev/null 2>&1 && getconf GNU_LIBC_VERSION >/dev/null 2>&1; then :;\nelif command -v ldd >/dev/null 2>&1 && ldd --version 2>&1 | head -n 1 | grep -Eiq 'glibc|GNU libc'; then :;\nelse echo "linux musl/unknown libc is not qualified; glibc is required" >&2; exit 78; fi\n`
    : "";
  return `#!/bin/sh\nset -eu\nINK_PLATFORM_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)\nINK_HOST=$(node -p "process.platform + '-' + process.arch")\nif [ "$INK_HOST" != "${target}" ]; then echo "platform package ${target} cannot run on $INK_HOST" >&2; exit 78; fi\n${glibcGate}INK_BUN=$(node -e "const {createRequire}=require('node:module');const r=createRequire(process.argv[1]+'/');process.stdout.write(r.resolve('bun/bin/bun.exe'))" "$INK_PLATFORM_ROOT/package.json")\nINK_BUN_VERSION=$("$INK_BUN" --version)\nif [ "$INK_BUN_VERSION" != "${policy.bun.version}" ]; then echo "requires Bun ${policy.bun.version}; received $INK_BUN_VERSION" >&2; exit 78; fi\nexport INK_CLAUDE_CODE_BUN_PATH=$INK_BUN\nexec "$INK_PLATFORM_ROOT/runtime/bin/ink-claude-code-dream" "$@"\n`;
}

function generatedPrepackBody(packageName, target = null) {
  const platformChecks = target
    ? `\nconst host=process.platform+'-'+process.arch;\nif(host!==att.runtimeTarget||pkg.os?.[0]!==process.platform||pkg.cpu?.[0]!==process.arch||pkg.inkRuntime?.target!==att.runtimeTarget) throw new Error('npm prepack platform/arch gate failed');\nconst release=JSON.parse(await readFile(path.join(root,'runtime/release-manifest.json'),'utf8'));\nconst artifact=JSON.parse(await readFile(path.join(root,'runtime/manifest/artifact-manifest.json'),'utf8'));\nif(release.core?.runtimeTarget!==att.runtimeTarget||artifact.artifact?.runtimeTarget!==att.runtimeTarget||artifact.payloadTreeSha256!==att.payloadTreeSha256) throw new Error('npm prepack Runtime manifest binding failed');\nconst rg=await readFile(path.join(root,pkg.inkRuntime.ripgrepPath));\nif(createHash('sha256').update(rg).digest('hex')!==pkg.inkRuntime.ripgrepSha256) throw new Error('npm prepack ripgrep checksum failed');\nconst require=createRequire(path.join(root,'package.json'));\nconst bun=require.resolve('bun/bin/bun.exe');\nconst probe=spawnSync(bun,['--version'],{encoding:'utf8'});\nif(probe.status!==0||probe.stdout.trim()!==pkg.inkRuntime.bunVersion||pkg.inkRuntime.bunVersion!=='1.4.0') throw new Error('npm prepack exact Bun 1.4.0 gate failed');`
    : `\nconst optional=Object.entries(pkg.optionalDependencies??{});\nif(optional.length!==4||optional.some(([name,version])=>!name.startsWith('@glide-the/ink-claude-code-dream-')||version!==pkg.version)||att.schemaVersion!=='ink-npm-meta-publication-attestation/v1'||!Array.isArray(att.platforms)||att.platforms.length!==4||Object.hasOwn(att,'runtimeTarget')) throw new Error('npm prepack platform selector/aggregate attestation failed');`;
  return `#!/usr/bin/env node\n// Generated from scripts/npm-release.mjs; verifies immutable npm staging only.\nimport { createHash } from 'node:crypto';\nimport { spawnSync } from 'node:child_process';\nimport { createRequire } from 'node:module';\nimport { readFile, readdir } from 'node:fs/promises';\nimport path from 'node:path';\nconst root=path.resolve(import.meta.dirname,'..');\nconst pkg=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));\nconst att=JSON.parse(await readFile(path.join(root,'npm-publication-attestation.json'),'utf8'));\nif(pkg.name!==${JSON.stringify(packageName)}||pkg.private===true||att.publicationAllowed!==true||att.redistributionAllowed!==true||att.productionEligible!==true${target ? `||att.runtimeTarget!==${JSON.stringify(target)}` : ""}) throw new Error('npm prepack identity/legal/qualification gate failed');${platformChecks}\nasync function walk(dir){for(const e of await readdir(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isSymbolicLink())throw new Error('npm symlink forbidden: '+p);if(e.isDirectory()){if(e.name!=='node_modules')await walk(p)}else if(e.isFile()&&p.toLowerCase().endsWith('.map'))throw new Error('source map forbidden from npm package: '+p);}}\nawait walk(root);\nprocess.stdout.write(JSON.stringify({status:'prepack-verified',package:pkg.name})+'\\n');\n`;
}

async function writeGenerated(file, body, mode = 0o644) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, body, { mode });
  await chmod(file, mode);
}

async function verifyGeneratedTemplates(policy) {
  const root = await mkdtemp(path.join(os.tmpdir(), "ink-npm-template-check-"));
  const checks = [];
  try {
    const scripts = [
      ["meta-launcher.sh", launcherBody(policy), "sh"],
      ["meta-prepack.mjs", generatedPrepackBody(policy.metaPackage), "node"],
      ...Object.entries(policy.platforms).flatMap(([target, platform]) => [
        [`${target}-launcher.sh`, platformLauncherBody(policy, target), "sh"],
        [`${target}-prepack.mjs`, generatedPrepackBody(platform.package, target), "node"],
      ]),
    ];
    for (const [name, body, runtime] of scripts) {
      const file = path.join(root, name);
      await writeFile(file, body);
      const result = spawnSync(
        runtime === "sh" ? "sh" : process.execPath,
        [runtime === "sh" ? "-n" : "--check", file],
        {
        cwd: repositoryRoot,
        encoding: "utf8",
        },
      );
      if (result.status !== 0) fail(`generated template syntax failed: ${name}\n${result.stderr}`);
      checks.push(name);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
  return { status: "templates-verified", files: checks.length };
}

async function stage(context, target, outputRoot, policy) {
  await assertTargetMaterial(context, target, policy);
  const platform = policy.platforms[target];
  const epoch = Number(process.env.SOURCE_DATE_EPOCH ?? 1_787_443_200);
  if (!Number.isSafeInteger(epoch) || epoch <= 0) fail("SOURCE_DATE_EPOCH must be a positive integer");
  await mkdir(outputRoot, { recursive: true });
  const outputReal = await realpath(outputRoot);
  if (outputReal === path.parse(outputReal).root || outputReal === os.homedir()) fail("unsafe npm output root");
  const stageRoot = await mkdtemp(path.join(outputReal, ".npm-stage-"));
  const finalRoot = path.join(outputReal, target);
  const platformRoot = path.join(stageRoot, "platform");
  const policyDigest = sha256(await readFile(policyPath));
  const qualificationSummary = await readFile(
    path.join(context.packageRoot, "manifest", "qualification-summary.json"),
  );
  const attestation = {
    schemaVersion: "ink-npm-platform-publication-attestation/v1",
    repository: policy.repository,
    version: policy.version,
    productionEligible: true,
    publicationAllowed: true,
    redistributionAllowed: true,
    runtimeTarget: target,
    coreBundleSha256: context.artifactManifest.coreBundleSha256,
    payloadTreeSha256: context.artifactManifest.payloadTreeSha256,
    qualificationSummarySha256: sha256(qualificationSummary),
    npmReleasePolicySha256: policyDigest,
    sourceMapsIncluded: false,
    sourceDateEpoch: epoch,
  };
  const platformPackage = {
    name: platform.package,
    version: policy.version,
    description: `Dream-compatible minimal Claude Agent Runtime for ${target}`,
    license: policy.publish.license,
    repository: { type: "git", url: `git+https://github.com/${policy.repository}.git` },
    type: "module",
    os: [platform.os],
    cpu: [platform.cpu],
    files: ["bin", "runtime", "scripts", "npm-publication-attestation.json", "README.md"],
    dependencies: { [policy.bun.package]: policy.bun.version },
    engines: { node: ">=22 <25" },
    publishConfig: { access: policy.publish.access, provenance: true },
    scripts: { prepack: "node scripts/prepack.mjs" },
    inkRuntime: {
      target,
      entrypoint: "runtime/bin/ink-claude-code-dream",
      ripgrepPath: `runtime/${platform.ripgrepPath}`,
      ripgrepSha256: platform.ripgrepSha256,
      bunVersion: policy.bun.version,
      sourceMapsIncluded: false,
    },
  };
  try {
    await cp(context.packageRoot, path.join(platformRoot, "runtime"), { recursive: true });
    await writeGenerated(path.join(platformRoot, "package.json"), stableJson(platformPackage));
    await writeGenerated(
      path.join(platformRoot, "bin", "ink-claude-code-dream-platform"),
      platformLauncherBody(policy, target),
      0o755,
    );
    await writeGenerated(
      path.join(platformRoot, "scripts", "prepack.mjs"),
      generatedPrepackBody(platform.package, target),
    );
    await writeGenerated(path.join(platformRoot, "npm-publication-attestation.json"), stableJson(attestation));
    await writeGenerated(
      path.join(platformRoot, "README.md"),
      `# ${platform.package}\n\n仅适用于 ${target}；包含精简 Runtime，并固定依赖 bun@${policy.bun.version}；不包含 source map。\n`,
    );
    for (const root of [platformRoot]) {
      for (const file of await filesUnder(root)) {
        if (relativePosix(root, file).toLowerCase().endsWith(".map")) fail("source map entered npm stage");
      }
    }
    await rm(finalRoot, { recursive: true, force: true });
    await rename(stageRoot, finalRoot);
  } catch (error) {
    await rm(stageRoot, { recursive: true, force: true });
    throw error;
  }
  return { status: "staged", target, output: finalRoot, platformPackage: platform.package };
}

async function aggregateMeta(tarballDirectory, outputRoot, policy) {
  if (!tarballDirectory) fail("aggregate-meta requires --tarball-dir");
  const tarballRoot = await realpath(tarballDirectory);
  const candidates = (await filesUnder(tarballRoot)).filter(file => file.endsWith(".tgz"));
  if (candidates.length !== 4) fail(`aggregate-meta requires exactly four platform tgz files; received ${candidates.length}`);
  const verifier = path.join(repositoryRoot, "scripts", "verify-npm-tarball.mjs");
  const summaries = [];
  for (const archive of candidates) {
    const result = spawnSync(process.execPath, [verifier, archive], {
      cwd: repositoryRoot,
      encoding: "utf8",
    });
    if (result.status !== 0) fail(`platform tgz verification failed\n${result.stdout}${result.stderr}`);
    const summary = JSON.parse(result.stdout.trim());
    if (summary.kind !== "platform") fail("aggregate-meta accepts platform tgz files only");
    summaries.push(summary);
  }
  const byTarget = new Map(summaries.map(summary => [summary.target, summary]));
  if (byTarget.size !== 4 || allowedTargets.some(target => !byTarget.has(target))) {
    fail("aggregate-meta did not receive exactly one tgz per checked platform");
  }
  const epoch = Number(process.env.SOURCE_DATE_EPOCH ?? 1_787_443_200);
  if (!Number.isSafeInteger(epoch) || epoch <= 0) fail("SOURCE_DATE_EPOCH must be a positive integer");
  await mkdir(outputRoot, { recursive: true });
  const outputReal = await realpath(outputRoot);
  const stageRoot = await mkdtemp(path.join(outputReal, ".npm-meta-stage-"));
  const finalRoot = path.join(outputReal, "meta");
  const policyDigest = sha256(await readFile(policyPath));
  const bindings = allowedTargets.map(target => {
    const platform = policy.platforms[target];
    const summary = byTarget.get(target);
    return {
      target,
      package: platform.package,
      version: policy.version,
      tarballSha256: summary.tarballSha256,
      qualificationSummarySha256: summary.qualificationSummarySha256,
      coreBundleSha256: summary.coreBundleSha256,
      payloadTreeSha256: summary.payloadTreeSha256,
    };
  });
  const attestation = {
    schemaVersion: "ink-npm-meta-publication-attestation/v1",
    repository: policy.repository,
    version: policy.version,
    productionEligible: true,
    publicationAllowed: true,
    redistributionAllowed: true,
    npmReleasePolicySha256: policyDigest,
    sourceMapsIncluded: false,
    sourceDateEpoch: epoch,
    platforms: bindings,
  };
  const metaPackage = {
    name: policy.metaPackage,
    version: policy.version,
    description: "Dream-compatible minimal Claude Agent Runtime platform selector",
    license: policy.publish.license,
    repository: { type: "git", url: `git+https://github.com/${policy.repository}.git` },
    type: "module",
    bin: { [policy.command]: `bin/${policy.command}` },
    files: ["bin", "scripts", "npm-publication-attestation.json", "README.md"],
    optionalDependencies: Object.fromEntries(
      Object.values(policy.platforms).map(value => [value.package, policy.version]),
    ),
    engines: { node: ">=22 <25" },
    publishConfig: { access: policy.publish.access, provenance: true },
    scripts: { prepack: "node scripts/prepack.mjs" },
  };
  try {
    await writeGenerated(path.join(stageRoot, "package.json"), stableJson(metaPackage));
    await writeGenerated(path.join(stageRoot, "bin", policy.command), launcherBody(policy), 0o755);
    await writeGenerated(path.join(stageRoot, "scripts", "prepack.mjs"), generatedPrepackBody(policy.metaPackage));
    await writeGenerated(path.join(stageRoot, "npm-publication-attestation.json"), stableJson(attestation));
    await writeGenerated(path.join(stageRoot, "README.md"), `# ${policy.metaPackage}\n\n绑定四个平台验收制品；不包含 source map。\n`);
    await rm(finalRoot, { recursive: true, force: true });
    await rename(stageRoot, finalRoot);
  } catch (error) {
    await rm(stageRoot, { recursive: true, force: true });
    throw error;
  }
  return { status: "meta-aggregated", output: finalRoot, platforms: bindings.length };
}

const { command, values } = parseArguments(process.argv.slice(2));
const [policy, localPolicy] = await Promise.all([
  readJson(policyPath, "npm release policy"),
  readJson(localPolicyPath, "local artifact policy"),
]);
validatePolicy(policy, localPolicy);
if (command === "plan") {
  process.stdout.write(stableJson(layout(policy, localPolicy)));
} else if (command === "templates") {
  process.stdout.write(`${JSON.stringify(await verifyGeneratedTemplates(policy))}\n`);
} else {
  assertCheckedLegalGate(localPolicy);
  if (command === "legal") {
    process.stdout.write(`${JSON.stringify({ status: "checked-policy-authorized" })}\n`);
    process.exit(0);
  }
  if (command === "aggregate-meta") {
    const result = await aggregateMeta(values.tarballDir, values.outputRoot ?? defaultOutputRoot, policy);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exit(0);
  }
  const defaultPackageRoot = path.join(
    repositoryRoot,
    "dist",
    "core-package-local",
    `${localPolicy.artifact.name}-${localPolicy.artifact.version}`,
  );
  const context = await verifiedPackage(values.packageRoot ?? defaultPackageRoot, policy, localPolicy);
  if (command === "gate") {
    process.stdout.write(`${JSON.stringify({ status: "publish-authorized", artifact: context.packageRoot })}\n`);
  } else {
    const target = values.target ?? `${process.platform}-${process.arch}`;
    const result = await stage(context, target, values.outputRoot ?? defaultOutputRoot, policy);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }
}
