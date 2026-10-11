// [Sync] 2026-10-11: exact canonical source receipt comparison replaces a stale fixed-count npm gate.
// [Input] Original-module Runtime layout, local package/NPM policies and root lifecycle guard.
// [Output] Prove source unification does not create publication authority or a second implementation.
// [Pos] Provider-free source-derived package/release contract regression.
// [Sync] 2026-10-11: bind fresh image-native release evidence and checks to Runtime 0.1.12; historical receipts remain unchanged.
// [Sync] 2026-09-13: retire the former cleanroom five-native fixture lane rather than applying it to unrelated source.
// [Sync] 2026-10-11: validate four exact image dependency maps and actual Bun loading/hoisting/escape rejection.

import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";
import os from "node:os";
import { dependenciesMatch, platformDependenciesMatch, platformRuntimeDependencies, probeNativeImageDependencies } from "../scripts/npm-runtime-dependencies.mjs";
import { DREAM_SOURCE_TARGETS, matchesDreamSourceTargets } from "../compat/dream-runtime/source-transforms.ts";
const root = resolve(import.meta.dirname, "..");
const json = async file => JSON.parse(await readFile(resolve(root, file), "utf8"));
test("original source, selector and local package have one Runtime version", async () => {
 const pkg = await json("package.json");
 const selector = await json("package/package.json");
 const local = await json("runtime/local-artifact-policy.json");
 const npm = await json("runtime/npm-release-policy.json");
 assert.equal(pkg.version, "0.1.12");
 assert.equal(selector.version, pkg.version);
 assert.equal(local.artifact.version, pkg.version);
 assert.equal(npm.version, pkg.version);
 assert.deepEqual(selector.bin, { claude: "cli.js", "ink-claude-code-dream": "cli.js" });
 assert.deepEqual(Object.values(selector.optionalDependencies), Array(4).fill(pkg.version));
 assert.equal(local.legalGate.publicationAllowed, true);
 assert.equal(local.legalGate.redistributionAllowed, true);
 assert.equal(npm.publish.license, local.legalGate.publicationLicense);
});
test("operator authority opens legal gate but does not qualify runtime artifacts", () => {
 const plan = spawnSync(process.execPath, ["scripts/npm-release.mjs", "plan"], { cwd: root, encoding: "utf8" });
 assert.equal(plan.status, 0, plan.stderr);
 assert.equal(JSON.parse(plan.stdout).version, "0.1.12");
 const gate = spawnSync(process.execPath, ["scripts/npm-release.mjs", "legal"], { cwd: root, encoding: "utf8",
  env: { ...process.env, INK_NPM_PUBLICATION_ALLOWED: "true" } });
 assert.equal(gate.status, 0, gate.stderr);
 assert.equal(JSON.parse(gate.stdout).status, "checked-policy-authorized");
 const stage = spawnSync(process.execPath, ["scripts/npm-release.mjs", "gate", "--package-root", "dist/nonexistent-release"], { cwd: root, encoding: "utf8" });
 assert.notEqual(stage.status, 0);
});
test("private repository root cannot be packed or published", () => {
 const result = spawnSync(process.execPath, ["scripts/npm-root-guard.mjs"], { cwd: root, encoding: "utf8" });
 assert.notEqual(result.status, 0);
 assert.match(result.stderr, /private/);
});

test("four platform image maps match the bundled sharp optional versions with exact unordered keys", async () => {
 const policy = await json("runtime/npm-release-policy.json");
 const sharp = await json("node_modules/sharp/package.json");
 assert.equal(sharp.version, policy.imageProcessing.sharpVersion);
 for (const target of Object.keys(policy.platforms)) {
  const expected = platformRuntimeDependencies(policy, target);
  assert.equal(Object.keys(expected).length, 3);
  for (const [name, version] of Object.entries(expected)) if (name.startsWith("@img/")) assert.equal(sharp.optionalDependencies[name], version);
  assert.ok(dependenciesMatch(Object.fromEntries(Object.entries(expected).reverse()), expected));
  assert.equal(dependenciesMatch({ ...expected, extra: "1.0.0" }, expected), false);
  assert.equal(dependenciesMatch({ bun: expected.bun }, expected), false);
  assert.equal(dependenciesMatch({ ...expected, [`@img/sharp-${target}`]: `^${sharp.version}` }, expected), false);
  assert.equal(dependenciesMatch(null, expected), false);
  assert.ok(platformDependenciesMatch({ dependencies: expected }, expected));
  assert.ok(platformDependenciesMatch({ dependencies: expected, optionalDependencies: {} }, expected));
  assert.equal(platformDependenciesMatch({ dependencies: expected, optionalDependencies: { [`@img/sharp-${target}`]: "0.0.0" } }, expected), false);
  assert.equal(platformDependenciesMatch({ dependencies: expected, optionalDependencies: null }, expected), false);
 }
 assert.throws(() => platformRuntimeDependencies(policy, "linux-musl-x64"), /policy\/target/);
 assert.throws(() => platformRuntimeDependencies({ ...policy, imageProcessing: { ...policy.imageProcessing, sharpVersion: "^0.34.5" } }, "darwin-arm64"), /policy\/target/);
});

test("actual Bun loads host native images from a hoisted isolated tree and rejects version/path escapes", async () => {
 const policy = await json("runtime/npm-release-policy.json");
 const target = `${process.platform}-${process.arch}`;
 const expected = platformRuntimeDependencies(policy, target);
 const tree = await mkdtemp(resolve(os.tmpdir(), "ink-npm-native-image-contract-"));
 try {
  for (const name of Object.keys(expected)) {
   await cp(resolve(root, "node_modules", name), resolve(tree, "node_modules", name), { recursive: true, dereference: true });
  }
  const coreRoot = resolve(tree, "node_modules/@fixture/runtime/runtime");
  const corePath = resolve(coreRoot, "lib/core/cli.js");
  await mkdir(resolve(corePath, ".."), { recursive: true });
  await writeFile(corePath, "// resolution anchor only; not a CLI qualification fixture\n");
  const config = { target, expected, dependencyRoot: tree, coreRoot, corePath, bunPath: resolve(tree, "node_modules/bun/bin/bun.exe") };
  const result = probeNativeImageDependencies(config);
  assert.equal(result.status, "native-image-dependencies-verified");
  assert.equal(result.sharpVersion, policy.imageProcessing.sharpVersion);
  assert.throws(() => probeNativeImageDependencies({ ...config, expected: { ...expected, [`@img/sharp-${target}`]: "0.0.0" } }), /metadata mismatch/);
  const vipsLib = resolve(tree, "node_modules", `@img/sharp-libvips-${target}`, "lib");
  const libraryName = (await readdir(vipsLib)).find(name => name.startsWith("libvips-cpp") && /\.(dylib|so)(\.|$)/.test(name));
  assert.ok(libraryName, "host libvips native library exists");
  const libraryPath = resolve(vipsLib, libraryName);
  const externalLibrary = resolve(root, "node_modules", `@img/sharp-libvips-${target}`, "lib", libraryName);
  await rm(libraryPath);
  await symlink(externalLibrary, libraryPath);
  assert.throws(() => probeNativeImageDependencies(config), /outside isolated tree/);
  await rm(libraryPath);
  await cp(externalLibrary, libraryPath, { dereference: true });
  // A resolver can see this parent package, but the probe must not accept it.
  const sharpDir = resolve(tree, "node_modules", `@img/sharp-${target}`);
  await rm(sharpDir, { recursive: true });
  await symlink(resolve(root, "node_modules", `@img/sharp-${target}`), sharpDir, "dir");
  assert.throws(() => probeNativeImageDependencies(config), /outside isolated tree/);
  assert.throws(() => probeNativeImageDependencies({ ...config, dependencyRoot: coreRoot }), /outside isolated dependency tree/);
 } finally {
  await rm(tree, { recursive: true, force: true });
 }
});


test("npm source receipt rejects stale, duplicate, substituted, reordered and wrong-SHA targets", () => {
 const valid = { requiredTargets: structuredClone(DREAM_SOURCE_TARGETS), appliedSourcePaths: DREAM_SOURCE_TARGETS.map(entry => entry.path).sort() };
 assert.equal(matchesDreamSourceTargets(valid), true);
 assert.equal(matchesDreamSourceTargets({ ...valid, requiredTargets: valid.requiredTargets.map(({ path, sha256 }) => ({ sha256, path })) }), true);
 const extra = structuredClone(valid); extra.requiredTargets[0].extra = true;
 assert.equal(matchesDreamSourceTargets(extra), false);
 for (const invalid of [null, undefined, true, [], {}, { ...valid, requiredTargets: null }, { ...valid, appliedSourcePaths: null }]) assert.equal(matchesDreamSourceTargets(invalid), false);
 const old = { requiredTargets: valid.requiredTargets.slice(0, 6), appliedSourcePaths: valid.requiredTargets.slice(0, 6).map(entry => entry.path).sort() };
 assert.equal(matchesDreamSourceTargets(old), false);
 for (const field of ["requiredTargets", "appliedSourcePaths"]) {
  const missing = structuredClone(valid); missing[field].pop();
  const duplicate = structuredClone(valid); duplicate[field][0] = duplicate[field][1];
  const reordered = structuredClone(valid); reordered[field].reverse();
  for (const changed of [missing, duplicate, reordered]) assert.equal(matchesDreamSourceTargets(changed), false);
 }
 const malformed = structuredClone(valid); malformed.requiredTargets[0] = null;
 assert.equal(matchesDreamSourceTargets(malformed), false);
 const wrongPath = structuredClone(valid); wrongPath.requiredTargets[0].path = "src/unknown.ts";
 const wrongHash = structuredClone(valid); wrongHash.requiredTargets[0].sha256 = "0".repeat(64);
 const substituted = structuredClone(valid); substituted.appliedSourcePaths[0] = "src/unknown.ts";
 for (const changed of [wrongPath, wrongHash, substituted]) assert.equal(matchesDreamSourceTargets(changed), false);
});
