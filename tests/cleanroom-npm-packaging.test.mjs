// [Input] Repository-authored clean-room entrypoint, Bun 1.4.0, npm package policy, and local npm tooling.
// [Output] Formal-release proof of four native formats, five exact tgz files, attestations, install, signals, and aliases.
// [Pos] End-to-end clean-room multi-platform npm packaging contract; foreign target binaries are inspected, never executed.
// [Sync] 2026-08-24: bind the final Dream receipt and formal publication attestation into all five packages.
// [Sync] 2026-08-28: require the accepted source tree/native executable binding in the formal package set.
// [Sync] 2026-09-12: require the authorized Runtime 0.1.5 receipt and formal five-package release set.
// [Sync] 2026-08-30: prove sandbox.notion-cli is emitted by the clean-room manifest generation chain.
// [Sync] 2026-09-12: require the repository package to expose the same scoped
//                    identity and command aliases as the public selector.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { access, chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bun = path.join(repositoryRoot, "node_modules", ".bin", "bun");
const buildScript = path.join(repositoryRoot, "scripts", "build-cleanroom-targets.ts");
const packageScript = path.join(repositoryRoot, "scripts", "package-cleanroom-npm.mjs");
const verifyScript = path.join(repositoryRoot, "scripts", "verify-cleanroom-npm.mjs");
const policy = JSON.parse(await readFile(path.join(repositoryRoot, "runtime", "cleanroom-npm-policy.json"), "utf8"));
const rootPackage = JSON.parse(await readFile(path.join(repositoryRoot, "package.json"), "utf8"));
const artifactPolicy = JSON.parse(await readFile(path.join(repositoryRoot, "runtime", "cleanroom-artifact-policy.json"), "utf8"));
const formalPublication = artifactPolicy.publicationGate.publicationAllowed === true;
const businessReceiptBody = formalPublication
  ? await readFile(path.join(repositoryRoot, artifactPolicy.publicationGate.businessAcceptance.receiptPath))
  : undefined;
const businessReceipt = businessReceiptBody ? JSON.parse(businessReceiptBody) : undefined;
const businessReceiptSha256 = businessReceiptBody
  ? createHash("sha256").update(businessReceiptBody).digest("hex")
  : undefined;
const targets = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"];

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    timeout: 300_000,
    ...options,
  });
}

async function filesUnder(root) {
  const output = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else output.push(path.relative(root, absolute).split(path.sep).join("/"));
    }
  }
  await walk(root);
  return output.sort();
}

test("clean-room npm policy is an exact MIT four-platform/five-package no-map contract", () => {
  assert.equal(policy.schemaVersion, "ink-cleanroom-npm-policy/v1");
  assert.equal(policy.license, "MIT");
  assert.equal(policy.bunVersion, "1.4.0");
  assert.equal(policy.entrypoint, "src/cleanroom/cli.ts");
  assert.equal(policy.metaPackage.name, "@glide-the/ink-claude-code-dream");
  assert.deepEqual(policy.metaPackage.commands, ["claude", "ink-claude-code-dream"]);
  assert.equal(rootPackage.name, policy.metaPackage.name);
  assert.deepEqual(Object.keys(rootPackage.bin).sort(), [...policy.metaPackage.commands].sort());
  assert.equal(rootPackage.bin.claude, rootPackage.bin["ink-claude-code-dream"]);
  assert.deepEqual(Object.keys(policy.platforms), targets);
  assert.equal(policy.materialPolicy.sourceMapsAllowed, false);
  assert.ok(policy.materialPolicy.forbiddenSuffixes.includes(".map"));
  assert.equal(policy.publication.packageGenerationAllowed, true);
  assert.equal(policy.version, "0.1.5");
  assert.equal(policy.publication.npmPublishAllowed, true);
  assert.equal(artifactPolicy.publicationGate.productionEligible, true);
  assert.equal(artifactPolicy.publicationGate.publicationAllowed, true);
  assert.equal(artifactPolicy.publicationGate.redistributionAllowed, true);
  assert.equal(artifactPolicy.publicationGate.businessAcceptance.passed, true);
  assert.equal(
    artifactPolicy.publicationGate.businessAcceptance.receiptPath,
    "runtime/attestations/dream-real-business-acceptance-0.1.5.json",
  );
  assert.equal(artifactPolicy.publicationGate.businessAcceptance.receiptSha256, businessReceiptSha256);
  assert.equal(businessReceipt.schemaVersion, "ink-dream-real-business-acceptance/v2");
  assert.equal(businessReceipt.subject.acceptedTarget, "darwin-arm64");
  assert.equal(businessReceipt.authorization.explicitPublicNpmReleaseApproved, true);
  assert.deepEqual(Object.values(artifactPolicy.publicationGate.targetHostQualification), [
    true, true, true, true,
  ]);
  assert(artifactPolicy.requiredCapabilities.includes("sandbox.notion-cli"));
  for (const target of targets) {
    const platform = policy.platforms[target];
    assert.equal(platform.package, `@glide-the/ink-claude-code-dream-${target}`);
    assert.equal(`${platform.os}-${platform.cpu}`, target);
  }
});

test("provider-free clean-room stages declare the stable Notion sandbox capability while publication stays closed", { timeout: 360_000 }, async t => {
  if (formalPublication) return t.skip("candidate-only generation evidence is unnecessary after formal publication");

  const build = run(bun, [buildScript]);
  assert.equal(build.status, 0, `${build.stdout}\n${build.stderr}`);
  const staged = run(process.execPath, [packageScript, "stage"], {
    env: {
      ...process.env,
      INK_CLEANROOM_QUALIFICATION_FIXTURE: "provider-free-test",
    },
  });
  assert.equal(staged.status, 0, `${staged.stdout}\n${staged.stderr}`);
  const receipt = JSON.parse(staged.stdout);
  assert.equal(receipt.packages.length, 5);
  assert.equal(receipt.tarballs.length, 0);

  for (const item of receipt.packages) {
    const manifestPath = item.target
      ? path.join(item.root, "runtime", "manifest", "capabilities.json")
      : path.join(item.root, "manifest", "capabilities.json");
    const releasePath = item.target
      ? path.join(item.root, "runtime", "release-manifest.json")
      : path.join(item.root, "release-manifest.json");
    const capabilities = JSON.parse(await readFile(manifestPath, "utf8"));
    const release = JSON.parse(await readFile(releasePath, "utf8"));
    assert.equal(capabilities.schemaVersion, "ink-cleanroom-capability-evidence/v1");
    assert.equal(capabilities.runtime.fixture, "provider-free-test");
    assert.deepEqual(
      capabilities.capabilities.map(entry => entry.id),
      artifactPolicy.requiredCapabilities,
    );
    assert(capabilities.capabilities.some(entry => entry.id === "sandbox.notion-cli"));
    assert.equal(release.status.publicationAllowed, false);
    assert.equal(release.status.redistributionAllowed, true);
  }

  const selector = receipt.packages.find(item => item.target === undefined);
  const fixturePrepack = run("npm", ["pack", "--dry-run", "--json"], { cwd: selector.root });
  assert.notEqual(fixturePrepack.status, 0);
  assert.match(`${fixturePrepack.stdout}\n${fixturePrepack.stderr}`, /integrity gate failed|Runtime manifest/i);

  const localCoreCapabilities = JSON.parse(
    await readFile(path.join(repositoryRoot, "runtime", "local-capabilities.json"), "utf8"),
  );
  const officialEnvelopeCapabilities = JSON.parse(
    await readFile(path.join(repositoryRoot, "runtime", "capabilities.json"), "utf8"),
  );
  assert.equal(localCoreCapabilities.runtime.mode, "headless-sdk-runtime");
  assert.equal(officialEnvelopeCapabilities.runtime.mode, "official-cli-compatibility-envelope");
  assert.equal(localCoreCapabilities.capabilities.some(entry => entry.id === "sandbox.notion-cli"), false);
  assert.equal(officialEnvelopeCapabilities.capabilities.some(entry => entry.id === "sandbox.notion-cli"), false);
});

test("four target builds produce five verified npm tarballs and the installed meta package selects the host", { timeout: 360_000 }, async t => {
  if (!formalPublication) {
    return t.skip("formal package test requires an open checked publication gate");
  }
  const hostTarget = `${process.platform}-${process.arch}`;
  if (!targets.includes(hostTarget)) return t.skip(`unsupported test host: ${hostTarget}`);

  const build = run(bun, [buildScript]);
  assert.equal(build.status, 0, `${build.stdout}\n${build.stderr}`);
  const buildReceipt = JSON.parse(build.stdout.slice(build.stdout.indexOf("{")));
  assert.equal(buildReceipt.bunVersion, "1.4.0");
  assert.deepEqual(buildReceipt.targets.map(item => item.target), targets);

  const expectedFileOutput = {
    "darwin-arm64": /Mach-O 64-bit executable arm64/,
    "darwin-x64": /Mach-O 64-bit executable x86_64/,
    "linux-arm64": /ELF 64-bit LSB executable, ARM aarch64/,
    "linux-x64": /ELF 64-bit LSB executable, x86-64/,
  };
  for (const target of targets) {
    const executable = path.join(repositoryRoot, policy.buildRoot, target, "claude");
    const inspected = run("file", [executable]);
    assert.equal(inspected.status, 0, inspected.stderr);
    assert.match(inspected.stdout, expectedFileOutput[target]);
  }

  const packaged = run(process.execPath, [packageScript, "all"]);
  assert.equal(packaged.status, 0, `${packaged.stdout}\n${packaged.stderr}`);
  const packageReceipt = JSON.parse(packaged.stdout);
  assert.equal(packageReceipt.packages.length, 5);
  assert.equal(packageReceipt.tarballs.length, 5);

  const verified = run(process.execPath, [verifyScript]);
  assert.equal(verified.status, 0, `${verified.stdout}\n${verified.stderr}`);
  const verifyReceipt = JSON.parse(verified.stdout);
  assert.equal(verifyReceipt.status, "cleanroom-npm-verified");
  assert.equal(verifyReceipt.packages.length, 5);
  assert.deepEqual(
    verifyReceipt.packages.filter(item => item.kind === "platform").map(item => item.target).sort(),
    [...targets].sort(),
  );

  const npmRoot = path.join(repositoryRoot, "dist", "cleanroom-npm");
  assert.deepEqual((await filesUnder(npmRoot)).filter(name => name.toLowerCase().endsWith(".map")), []);
  const tarballRoot = path.join(repositoryRoot, policy.tarballRoot);
  const tarballs = await readdir(tarballRoot);
  assert.equal(tarballs.filter(name => name.endsWith(".tgz")).length, 5);
  const metaTarball = path.join(tarballRoot, "glide-the-ink-claude-code-dream-0.1.5.tgz");
  const hostTarball = path.join(tarballRoot, `glide-the-ink-claude-code-dream-${hostTarget}-0.1.5.tgz`);

  // Dream passes canonical real Workspace paths. Canonicalize macOS' /var ->
  // /private/var temp alias before deriving CLAUDE_CODE_TMPDIR as well.
  const installRoot = await realpath(await mkdtemp(path.join(os.tmpdir(), "ink-cleanroom-npm-install-")));
  try {
    await writeFile(path.join(installRoot, "package.json"), '{"name":"cleanroom-local-install","private":true,"version":"0.0.0"}\n');
    const installed = run(
      "npm",
      ["install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", metaTarball, hostTarball],
      {
        cwd: installRoot,
        env: { ...process.env, npm_config_loglevel: "error", npm_config_update_notifier: "false" },
      },
    );
    assert.equal(installed.status, 0, `${installed.stdout}\n${installed.stderr}`);
    for (const command of ["claude", "ink-claude-code-dream"]) {
      const version = run(path.join(installRoot, "node_modules", ".bin", command), ["--version"], { cwd: installRoot });
      assert.equal(version.status, 0, `${version.stdout}\n${version.stderr}`);
      assert.equal(version.stdout.trim(), "2.1.241 (Claude Code)");
    }
    const selectorRoot = path.join(
      installRoot,
      "node_modules",
      "@glide-the",
      "ink-claude-code-dream",
    );
    const selectorManifest = JSON.parse(
      await readFile(path.join(selectorRoot, "release-manifest.json"), "utf8"),
    );
    const selectorLauncher = await readFile(
      path.join(selectorRoot, "bin", "ink-claude-code-dream"),
      "utf8",
    );
    const selectorCapabilities = JSON.parse(
      await readFile(path.join(selectorRoot, "manifest", "capabilities.json"), "utf8"),
    );
    assert.equal(selectorManifest.runtime.entrypoint, "bin/ink-claude-code-dream");
    assert.match(selectorLauncher, /CLAUDE_SECURESTORAGE_CONFIG_DIR/);
    assert.equal(selectorManifest.core.productionEligible, true);
    assert.equal(selectorManifest.status.publicationAllowed, true);
    assert.equal(selectorManifest.status.redistributionAllowed, true);
    assert.equal(Object.hasOwn(selectorCapabilities.runtime, "fixture"), false);
    assert.deepEqual(
      selectorCapabilities.capabilities.map(item => item.id).sort(),
      [...JSON.parse(await readFile(path.join(repositoryRoot, "runtime", "cleanroom-artifact-policy.json"), "utf8")).requiredCapabilities].sort(),
    );
    const selectorNotices = await readFile(path.join(selectorRoot, "THIRD_PARTY_NOTICES.txt"), "utf8");
    const selectorDependencies = JSON.parse(
      await readFile(path.join(selectorRoot, "manifest", "dependency-licenses.json"), "utf8"),
    );
    const selectorSbom = JSON.parse(
      await readFile(path.join(selectorRoot, "manifest", "sbom.cdx.json"), "utf8"),
    );
    assert.match(selectorNotices, /@anthropic-ai\/sandbox-runtime@0\.0\.73 \(Apache-2\.0\)/);
    assert.equal(selectorDependencies.thirdPartyNoticesSha256.length, 64);
    assert.equal(selectorSbom.bomFormat, "CycloneDX");
    assert.equal(selectorSbom.specVersion, "1.5");
    assert.equal(selectorSbom.components.length, selectorDependencies.components.length);
    const selectorAttestation = JSON.parse(
      await readFile(path.join(selectorRoot, "npm-publication-attestation.json"), "utf8"),
    );
    assert.equal(selectorAttestation.publicationAllowed, true);
    assert.equal(selectorAttestation.businessAcceptanceReceiptSha256, businessReceiptSha256);
    assert.equal(Object.hasOwn(selectorAttestation, "fixture"), false);
    const selectorPrepack = run("npm", ["pack", "--dry-run", "--json"], { cwd: selectorRoot });
    assert.equal(selectorPrepack.status, 0, `${selectorPrepack.stdout}\n${selectorPrepack.stderr}`);

    const dreamRoot = path.resolve(repositoryRoot, "..", "ink-dream-memory");
    const dreamPython = process.env.INK_DREAM_PYTHON || path.join(dreamRoot, ".venv", "bin", "python");
    const dreamResolverModule = path.join(
      dreamRoot,
      "backend",
      "libs",
      "claude_agent_kit",
      "server",
      "sdk_env.py",
    );
    const dreamFixtureAvailable = await Promise.all([
      access(dreamPython).then(() => true, () => false),
      access(dreamResolverModule).then(() => true, () => false),
    ]).then(values => values.every(Boolean));
    if (dreamFixtureAvailable) {
      const dreamResolver = run(
        dreamPython,
        [
          "-c",
          [
            "import json, os, sys",
            `sys.path.insert(0, ${JSON.stringify(path.join(dreamRoot, "backend"))})`,
            "from libs.claude_agent_kit.server.sdk_env import resolve_claude_cli_path, require_dream_claude_runtime_manifest",
            "resolved = resolve_claude_cli_path({'PATH': os.environ['INK_FIXTURE_BIN']})",
            "manifest = require_dream_claude_runtime_manifest(resolved)",
            "print(json.dumps({'resolved': resolved, 'manifest': str(manifest)}))",
          ].join("\n"),
        ],
        {
          cwd: installRoot,
          env: {
            ...process.env,
            INK_FIXTURE_BIN: path.join(installRoot, "node_modules", ".bin"),
          },
        },
      );
      assert.equal(dreamResolver.status, 0, `${dreamResolver.stdout}\n${dreamResolver.stderr}`);
      const resolverReceipt = JSON.parse(dreamResolver.stdout);
      assert.equal(path.basename(resolverReceipt.resolved), "ink-claude-code-dream");
      assert.equal(
        resolverReceipt.manifest,
        await realpath(path.join(selectorRoot, "release-manifest.json")),
      );
    } else {
      t.diagnostic("optional sibling Dream resolver fixture is unavailable; package install/select checks continue");
    }
    const installedPlatform = JSON.parse(
      await readFile(
        path.join(installRoot, "node_modules", "@glide-the", `ink-claude-code-dream-${hostTarget}`, "package.json"),
        "utf8",
      ),
    );
    assert.equal(installedPlatform.name, policy.platforms[hostTarget].package);
    assert.deepEqual(installedPlatform.os, [process.platform]);
    assert.deepEqual(installedPlatform.cpu, [process.arch]);
    assert.equal(installedPlatform.scripts.prepack, "node scripts/prepack.mjs");
    const installedPlatformRoot = path.dirname(
      path.join(installRoot, "node_modules", "@glide-the", `ink-claude-code-dream-${hostTarget}`, "package.json"),
    );
    await access(path.join(installedPlatformRoot, "THIRD_PARTY_NOTICES.txt"));
    await access(path.join(installedPlatformRoot, "runtime", "manifest", "dependency-licenses.json"));
    await access(path.join(installedPlatformRoot, "runtime", "manifest", "sbom.cdx.json"));
    const platformAttestation = JSON.parse(
      await readFile(path.join(installedPlatformRoot, "npm-publication-attestation.json"), "utf8"),
    );
    assert.equal(platformAttestation.publicationAllowed, true);
    assert.equal(platformAttestation.businessAcceptanceReceiptSha256, businessReceiptSha256);
    assert.equal(Object.hasOwn(platformAttestation, "fixture"), false);
    const platformPrepack = run("npm", ["pack", "--dry-run", "--json"], { cwd: installedPlatformRoot });
    assert.equal(platformPrepack.status, 0, `${platformPrepack.stdout}\n${platformPrepack.stderr}`);

    const signalWorkspace = path.join(installRoot, "signal-workspace");
    const signalConfig = path.join(signalWorkspace, ".claude-home");
    const signalTmpdir = path.join(signalWorkspace, ".claude-tmp");
    await mkdir(signalConfig, { recursive: true, mode: 0o700 });
    await mkdir(signalTmpdir, { recursive: true, mode: 0o700 });
    await chmod(signalConfig, 0o700);
    await chmod(signalTmpdir, 0o700);
    const launcher = spawn(
      path.join(installRoot, "node_modules", ".bin", "ink-claude-code-dream"),
      ["--output-format", "stream-json", "--input-format", "stream-json", "--verbose"],
      {
        cwd: signalWorkspace,
        env: {
          ...process.env,
          CLAUDE_CONFIG_DIR: signalConfig,
          CLAUDE_CODE_TMPDIR: signalTmpdir,
        },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    let launcherStderr = "";
    launcher.stderr.setEncoding("utf8");
    launcher.stderr.on("data", chunk => {
      launcherStderr += chunk;
    });
    const launcherExit = once(launcher, "exit");
    // The selector must first start its platform Bun process and install
    // forwarding handlers; cold CI hosts need more than a scheduler tick.
    await new Promise(resolve => setTimeout(resolve, 1000));
    assert.equal(
      launcher.exitCode,
      null,
      `npm selector exited before SIGTERM: code=${launcher.exitCode} signal=${launcher.signalCode}\n${launcherStderr}`,
    );
    assert.equal(launcher.kill("SIGTERM"), true, "npm selector rejected SIGTERM");
    const [signalExitCode, signalName] = await Promise.race([
      launcherExit,
      new Promise((_, reject) => setTimeout(() => reject(new Error("npm selector did not forward SIGTERM")), 4_000)),
    ]);
    assert(
      (signalExitCode === null && signalName === "SIGTERM") ||
        (signalExitCode === 0 && signalName === null),
      `unexpected selector termination: code=${signalExitCode} signal=${signalName}`,
    );
  } finally {
    await rm(installRoot, { recursive: true, force: true });
  }
});
