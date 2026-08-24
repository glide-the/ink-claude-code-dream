// [Input] Checked legacy/clean-room npm policies, root lifecycle guards, tarball verifiers, and publication workflows.
// [Output] Prove scoped layouts, closed legacy gates, receipt-bound clean-room publication, OIDC, and zero-map tarballs.
// [Pos] Provider-free npm publication contract tests; they never publish, authenticate, or copy a vendor core.
// [Sync] 2026-08-24: recognize the private MIT repository orchestrator without opening the legacy publish gate.
// [Sync] 2026-08-24: require exact acceptance-receipt hashing in the clean-room qualification/publication path.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const npmRelease = path.join(repositoryRoot, "scripts", "npm-release.mjs");
const tarVerifier = path.join(repositoryRoot, "scripts", "verify-npm-tarball.mjs");
const policy = JSON.parse(await readFile(path.join(repositoryRoot, "runtime/npm-release-policy.json"), "utf8"));
const localPolicy = JSON.parse(await readFile(path.join(repositoryRoot, "runtime/local-artifact-policy.json"), "utf8"));
const packageJson = JSON.parse(await readFile(path.join(repositoryRoot, "package.json"), "utf8"));

test("scoped selector maps exactly four native platform packages and Windows is fail-closed", () => {
  assert.equal(policy.metaPackage, "@glide-the/ink-claude-code-dream");
  assert.deepEqual(Object.keys(policy.platforms), [
    "darwin-arm64",
    "darwin-x64",
    "linux-arm64",
    "linux-x64",
  ]);
  for (const [target, platform] of Object.entries(policy.platforms)) {
    assert.equal(platform.package, `@glide-the/ink-claude-code-dream-${target}`);
    assert.equal(target, `${platform.os}-${platform.cpu}`);
    assert.match(platform.ripgrepSha256, /^[a-f0-9]{64}$/);
  }
  assert.match(policy.unsupported["win32-x64"], /没有 Windows/);
  assert.match(policy.unsupported["win32-arm64"], /没有 Windows/);
  assert.equal(policy.bun.version, "1.4.0");
  assert.equal(policy.materialPolicy.sourceMapsAllowed, false);
  assert.ok(policy.materialPolicy.forbiddenSuffixes.includes(".map"));
});

test("plan is reviewable but checked legal policy blocks gate before artifact or publish", () => {
  const plan = spawnSync(process.execPath, [npmRelease, "plan"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  assert.equal(plan.status, 0, plan.stderr);
  const receipt = JSON.parse(plan.stdout);
  assert.equal(receipt.metaPackage.name, policy.metaPackage);
  assert.equal(Object.keys(receipt.metaPackage.optionalDependencies).length, 4);
  assert.equal(receipt.sourceMapsAllowed, false);
  assert.equal(receipt.legalGate.publicationAllowed, false);
  assert.equal(receipt.legalGate.redistributionAllowed, false);
  assert.equal(localPolicy.legalGate.publicationAllowed, false);
  assert.equal(localPolicy.legalGate.redistributionAllowed, false);

  const gate = spawnSync(process.execPath, [npmRelease, "legal"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  assert.notEqual(gate.status, 0);
  assert.match(gate.stderr, /publicationAllowed, redistributionAllowed/);
});

test("local core packager/verifier derive either closed or authorized state from checked policy", async () => {
  const [packager, verifier] = await Promise.all([
    readFile(path.join(repositoryRoot, "scripts", "package-core-local.mjs"), "utf8"),
    readFile(path.join(repositoryRoot, "scripts", "verify-core-package-local.mjs"), "utf8"),
  ]);
  for (const body of [packager, verifier]) {
    assert.match(body, /publicationAllowed !== policy\.legalGate\.redistributionAllowed|publicationAllowed !== redistributionAllowed/);
    assert.match(body, /publicationLicense/);
    assert.match(body, /authorizationReference/);
    assert.doesNotMatch(body, /publicationAllowed !== false\s*\|\|\s*policy\.legalGate\.redistributionAllowed !== false/);
  }
});

test("all generated shell launchers and Node prepack gates parse before authorization", () => {
  const templates = spawnSync(process.execPath, [npmRelease, "templates"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  assert.equal(templates.status, 0, templates.stderr);
  assert.deepEqual(JSON.parse(templates.stdout), { status: "templates-verified", files: 10 });
});

test("repository root cannot be npm packed as the legacy envelope", () => {
  assert.equal(packageJson.private, true);
  assert.equal(packageJson.license, "MIT");
  assert.equal(packageJson.scripts.prepack, "node scripts/npm-root-guard.mjs");
  assert.equal(packageJson.scripts.prepublishOnly, "node scripts/npm-root-guard.mjs");
  const packed = spawnSync("npm", ["pack", "--dry-run", "--json"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    timeout: 120_000,
  });
  assert.notEqual(packed.status, 0);
  assert.match(`${packed.stdout}\n${packed.stderr}`, /legacy envelope/);
});

async function packFixture(root, withMap) {
  const packageRoot = path.join(root, withMap ? "with-map" : "without-map");
  const outputRoot = path.join(root, "tarballs");
  await mkdir(packageRoot, { recursive: true });
  await mkdir(outputRoot, { recursive: true });
  const files = ["index.js", "npm-publication-attestation.json"];
  if (withMap) files.push("debug.map");
  await writeFile(path.join(packageRoot, "package.json"), `${JSON.stringify({
    name: "@glide-the/ink-claude-code-dream-fixture",
    version: "0.0.0-test",
    files,
  }, null, 2)}\n`);
  await writeFile(path.join(packageRoot, "index.js"), "export {};\n");
  await writeFile(
    path.join(packageRoot, "npm-publication-attestation.json"),
    '{"productionEligible":true,"publicationAllowed":true,"redistributionAllowed":true}\n',
  );
  if (withMap) await writeFile(path.join(packageRoot, "debug.map"), "{}\n");
  const packed = spawnSync(
    "npm",
    ["pack", "--ignore-scripts", "--json", "--pack-destination", outputRoot],
    { cwd: packageRoot, encoding: "utf8", timeout: 120_000 },
  );
  assert.equal(packed.status, 0, packed.stderr);
  return path.join(outputRoot, JSON.parse(packed.stdout)[0].filename);
}

test("final tgz verifier rejects unknown package identity and nested source maps", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ink-npm-map-test-"));
  try {
    const clean = await packFixture(root, false);
    const cleanResult = spawnSync(process.execPath, [tarVerifier, clean], {
      cwd: repositoryRoot,
      encoding: "utf8",
    });
    assert.notEqual(cleanResult.status, 0);
    assert.match(cleanResult.stderr, /unexpected npm package name|common identity/);

    const mapped = await packFixture(root, true);
    const mappedResult = spawnSync(process.execPath, [tarVerifier, mapped], {
      cwd: repositoryRoot,
      encoding: "utf8",
    });
    assert.notEqual(mappedResult.status, 0);
    assert.match(mappedResult.stderr, /source map forbidden/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

const sha256 = body => createHash("sha256").update(body).digest("hex");

test("authorized fixture executes native stage, real Bun smoke, and exact five-package inventory", { timeout: 240_000 }, async t => {
  const target = `${process.platform}-${process.arch}`;
  if (!Object.hasOwn(policy.platforms, target)) return t.skip(`unsupported fixture host ${target}`);
  const root = await mkdtemp(path.join(os.tmpdir(), "ink-npm-authorized-test-"));
  try {
    const tool = path.join(root, "tool");
    await mkdir(path.join(tool, "scripts"), { recursive: true });
    await symlink(path.join(repositoryRoot, "node_modules"), path.join(tool, "node_modules"), "dir");
    await cp(path.join(repositoryRoot, "runtime"), path.join(tool, "runtime"), { recursive: true });
    for (const script of ["npm-release.mjs", "verify-npm-tarball.mjs", "smoke-npm-release.mjs"]) {
      await cp(path.join(repositoryRoot, "scripts", script), path.join(tool, "scripts", script));
    }
    const authorizedLocal = JSON.parse(JSON.stringify(localPolicy));
    Object.assign(authorizedLocal.legalGate, {
      publicationAllowed: true,
      redistributionAllowed: true,
      publicationLicense: "MIT",
      authorizationReference: "provider-free-authorized-test-fixture",
    });
    const authorizedNpm = JSON.parse(JSON.stringify(policy));
    authorizedNpm.publish.license = "MIT";
    authorizedNpm.runtimeVerifier = "scripts/authorized-fixture-core-verifier.mjs";
    const rgBodies = Object.fromEntries(Object.keys(authorizedNpm.platforms).map(key => [key, Buffer.from(`rg-${key}\n`)]));
    for (const [key, body] of Object.entries(rgBodies)) authorizedNpm.platforms[key].ripgrepSha256 = sha256(body);
    await writeFile(path.join(tool, "runtime", "local-artifact-policy.json"), `${JSON.stringify(authorizedLocal, null, 2)}\n`);
    await writeFile(path.join(tool, "runtime", "npm-release-policy.json"), `${JSON.stringify(authorizedNpm, null, 2)}\n`);
    await writeFile(
      path.join(tool, "scripts", "authorized-fixture-core-verifier.mjs"),
      "process.stdout.write(JSON.stringify({productionEligible:true,publicationAllowed:true,redistributionAllowed:true})+'\\n');\n",
    );

    const core = path.join(root, "qualified-core");
    await mkdir(path.join(core, "bin"), { recursive: true });
    await mkdir(path.join(core, "lib", "core"), { recursive: true });
    await mkdir(path.join(core, "manifest"), { recursive: true });
    const coreJs = "if(process.argv.includes('--version'))process.stdout.write('2.1.241\\n');else process.stdout.write('{}\\n');\n";
    await writeFile(path.join(core, "lib", "core", "cli.js"), coreJs);
    await writeFile(path.join(core, "bin", "ink-claude-code-dream"), "#!/bin/sh\nexec \"${INK_CLAUDE_CODE_BUN_PATH:?}\" \"$(dirname \"$0\")/../lib/core/cli.js\" \"$@\"\n");
    await chmod(path.join(core, "bin", "ink-claude-code-dream"), 0o755);
    const platform = authorizedNpm.platforms[target];
    await mkdir(path.dirname(path.join(core, platform.ripgrepPath)), { recursive: true });
    await writeFile(path.join(core, platform.ripgrepPath), rgBodies[target]);
    const qualification = Buffer.from('{"productionEligible":true}\n');
    const artifactManifest = {
      artifact: { runtimeTarget: target, productionEligible: true, publicationAllowed: true, redistributionAllowed: true },
      coreBundleSha256: sha256(coreJs),
      payloadTreeSha256: "a".repeat(64),
    };
    await writeFile(path.join(core, "manifest", "local-artifact-policy.json"), `${JSON.stringify(authorizedLocal)}\n`);
    await writeFile(path.join(core, "manifest", "artifact-manifest.json"), `${JSON.stringify(artifactManifest)}\n`);
    await writeFile(path.join(core, "manifest", "core-build-receipt.json"), `${JSON.stringify({ runtimeTarget: target })}\n`);
    await writeFile(path.join(core, "manifest", "qualification-summary.json"), qualification);
    await writeFile(path.join(core, "release-manifest.json"), `${JSON.stringify({ status: { productionEligible: true, publicationAllowed: true, redistributionAllowed: true }, core: { runtimeTarget: target } })}\n`);

    const stageRoot = path.join(root, "stage");
    const stage = spawnSync(process.execPath, [path.join(tool, "scripts", "npm-release.mjs"), "stage", "--target", target, "--package-root", core, "--output-root", stageRoot], { cwd: tool, encoding: "utf8" });
    assert.equal(stage.status, 0, stage.stderr);
    const smoke = spawnSync(process.execPath, [path.join(tool, "scripts", "smoke-npm-release.mjs"), path.join(stageRoot, target)], { cwd: tool, encoding: "utf8", timeout: 180_000 });
    assert.equal(smoke.status, 0, smoke.stderr);

    const tarballs = path.join(root, "tarballs");
    await mkdir(tarballs);
    const nativeRoot = path.join(stageRoot, target, "platform");
    const roots = new Map([[target, nativeRoot]]);
    for (const [otherTarget, otherPlatform] of Object.entries(authorizedNpm.platforms)) {
      if (otherTarget === target) continue;
      const clone = path.join(root, `platform-${otherTarget}`);
      await cp(nativeRoot, clone, { recursive: true, filter: source => !source.includes(`${path.sep}node_modules`) });
      const pkg = JSON.parse(await readFile(path.join(clone, "package.json"), "utf8"));
      Object.assign(pkg, { name: otherPlatform.package, os: [otherPlatform.os], cpu: [otherPlatform.cpu] });
      Object.assign(pkg.inkRuntime, { target: otherTarget, ripgrepPath: `runtime/${otherPlatform.ripgrepPath}`, ripgrepSha256: otherPlatform.ripgrepSha256 });
      await writeFile(path.join(clone, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
      const att = JSON.parse(await readFile(path.join(clone, "npm-publication-attestation.json"), "utf8"));
      att.runtimeTarget = otherTarget;
      await writeFile(path.join(clone, "npm-publication-attestation.json"), `${JSON.stringify(att, null, 2)}\n`);
      const release = JSON.parse(await readFile(path.join(clone, "runtime", "release-manifest.json"), "utf8"));
      release.core.runtimeTarget = otherTarget;
      await writeFile(path.join(clone, "runtime", "release-manifest.json"), `${JSON.stringify(release)}\n`);
      const artifact = JSON.parse(await readFile(path.join(clone, "runtime", "manifest", "artifact-manifest.json"), "utf8"));
      artifact.artifact.runtimeTarget = otherTarget;
      await writeFile(path.join(clone, "runtime", "manifest", "artifact-manifest.json"), `${JSON.stringify(artifact)}\n`);
      await writeFile(path.join(clone, "runtime", "manifest", "core-build-receipt.json"), `${JSON.stringify({ runtimeTarget: otherTarget })}\n`);
      await rm(path.join(clone, "runtime", platform.ripgrepPath), { force: true });
      await mkdir(path.dirname(path.join(clone, "runtime", otherPlatform.ripgrepPath)), { recursive: true });
      await writeFile(path.join(clone, "runtime", otherPlatform.ripgrepPath), rgBodies[otherTarget]);
      roots.set(otherTarget, clone);
    }
    const archives = [];
    for (const platformRoot of roots.values()) {
      const packed = spawnSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", tarballs, platformRoot], { cwd: tool, encoding: "utf8", timeout: 120_000 });
      assert.equal(packed.status, 0, packed.stderr);
      archives.push(path.join(tarballs, JSON.parse(packed.stdout)[0].filename));
    }
    const aggregate = spawnSync(process.execPath, [path.join(tool, "scripts", "npm-release.mjs"), "aggregate-meta", "--tarball-dir", tarballs, "--output-root", stageRoot], { cwd: tool, encoding: "utf8" });
    assert.equal(aggregate.status, 0, aggregate.stderr);
    const metaPack = spawnSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", tarballs, path.join(stageRoot, "meta")], { cwd: tool, encoding: "utf8" });
    assert.equal(metaPack.status, 0, metaPack.stderr);
    archives.push(path.join(tarballs, JSON.parse(metaPack.stdout)[0].filename));
    const verified = spawnSync(process.execPath, [path.join(tool, "scripts", "verify-npm-tarball.mjs"), ...archives], { cwd: tool, encoding: "utf8" });
    assert.equal(verified.status, 0, verified.stderr);
    assert.deepEqual(JSON.parse(verified.stdout).packages.length, 5);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("clean-room CI and Trusted Publishing keep restored inputs out and OIDC only in publish", async () => {
  const workflow = await readFile(path.join(repositoryRoot, ".github/workflows/publish-npm.yml"), "utf8");
  const qualification = await readFile(path.join(repositoryRoot, ".github/workflows/qualify-npm-runtime.yml"), "utf8");
  const ci = await readFile(path.join(repositoryRoot, ".github/workflows/ci.yml"), "utf8");
  assert.match(workflow, /environment: npm/);
  assert.equal((workflow.match(/id-token: write/g) ?? []).length, 1);
  assert.doesNotMatch(qualification, /id-token: write/);
  assert.doesNotMatch(ci, /id-token: write/);
  assert.match(workflow, /npm publish[\s\S]*--provenance/);
  assert.match(workflow, /verify-cleanroom-npm\.mjs/);
  assert.match(workflow, /businessAcceptance/);
  assert.match(workflow, /createHash/);
  assert.match(workflow, /receiptSha256 !== receiptSha256/);
  assert.match(workflow, /targetHostQualification/);
  assert.match(workflow, /npmPublishAllowed/);
  assert.match(workflow, /\.head_repository\.full_name == \$repository/);
  assert.match(workflow, /\.path == "\.github\/workflows\/qualify-npm-runtime\.yml"/);
  assert.match(workflow, /\.head_sha == \$sha/);
  assert.match(workflow, /\.head_branch == "main"/);
  assert.match(workflow, /archives=\(dist\/npm-publish\/\*\.tgz\)[\s\S]*-eq 5/);
  for (const body of [ci, workflow, qualification]) {
    for (const match of body.matchAll(/^\s*- uses:\s+([^\s#]+)/gm)) {
      assert.match(match[1], /^[^@]+@[a-f0-9]{40}$/);
    }
    assert.doesNotMatch(body, /INK_CLAUDE_CODE_SOURCE_ROOT|dist\/core-local|package-core-local|qualify-core-local/);
  }
  assert.match(ci, /pull_request:/);
  assert.match(ci, /npm run lint/);
  assert.match(ci, /npm test/);
  assert.match(ci, /cleanroom:build:targets/);
  assert.match(ci, /cleanroom:npm:verify/);
  assert.match(qualification, /name: Qualify clean-room npm Runtime/);
  assert.match(qualification, /businessAcceptance/);
  assert.match(qualification, /createHash/);
  assert.match(qualification, /receiptSha256 !== receiptSha256/);
  assert.match(qualification, /targetHostQualification/);
  assert.match(qualification, /cleanroom:build:targets/);
  assert.match(qualification, /cleanroom:npm:package/);
  assert.match(qualification, /cleanroom:npm:verify/);
});
