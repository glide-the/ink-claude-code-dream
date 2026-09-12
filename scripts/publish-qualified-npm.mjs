#!/usr/bin/env node
// [Input] Verified immutable five-tarball set, checked npm policy and CI-only npm authentication.
// [Output] Publish platforms then selector, or verify identical already-published bytes on retry.
// [Pos] Existing GitHub npm workflow publication helper; never builds or logs credentials.
// [Sync] 2026-09-13: restore exact-artifact CI publishing without overwriting versions.

import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

if (process.env.GITHUB_ACTIONS !== "true") throw new Error("Publication is CI-only");
const root = path.resolve(import.meta.dirname, "..");
const directory = path.resolve(process.argv[2] || "dist/npm-publish");
const policy = JSON.parse(await readFile(path.join(root, "runtime/npm-release-policy.json"), "utf8"));
const names = [...Object.values(policy.platforms).map(platform => platform.package), policy.metaPackage];
const archives = (await readdir(directory)).filter(file => file.endsWith(".tgz"));
if (archives.length !== names.length) throw new Error("Expected exactly five qualified archives");
const verify = spawnSync(process.execPath, [path.join(root, "scripts/verify-npm-tarball.mjs"), ...archives.map(file => path.join(directory, file))], { encoding: "utf8" });
if (verify.status !== 0) throw new Error(verify.stderr || "Release set verification failed");
const env = { ...process.env };
const tokenMode = Boolean(env.NODE_AUTH_TOKEN);
if (tokenMode) {
  delete env.ACTIONS_ID_TOKEN_REQUEST_URL;
  delete env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
}
const npm = args => spawnSync("npm", args, { env, encoding: "utf8", timeout: 180000 });
function readIntegrity(name) {
  const result = npm(["view", `${name}@${policy.version}`, "dist.integrity", "--json", "--registry=https://registry.npmjs.org"]);
  if (result.status === 0) return JSON.parse(result.stdout);
  if (/\bE404\b/.test(result.stderr)) return null;
  throw new Error(`Registry lookup failed for ${name}; publication stopped`);
}
for (const name of names) {
  const filename = `${name.replace(/^@/, "").replace("/", "-")}-${policy.version}.tgz`;
  if (!archives.includes(filename)) throw new Error(`Missing exact qualified archive ${filename}`);
  const file = path.join(directory, filename);
  const expected = `sha512-${createHash("sha512").update(await readFile(file)).digest("base64")}`;
  const existing = readIntegrity(name);
  if (existing && existing !== expected) throw new Error(`Immutable registry version has different bytes: ${name}@${policy.version}`);
  if (!existing) {
    const published = npm(["publish", file, "--access=public", `--provenance=${!tokenMode}`, "--registry=https://registry.npmjs.org"]);
    if (published.status !== 0) throw new Error(`npm publication failed for ${name}; inspect masked CI npm diagnostics`);
  }
  let actual;
  for (let attempt = 0; attempt < 6; attempt++) {
    actual = readIntegrity(name);
    if (actual) break;
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  if (actual !== expected) throw new Error(`Public registry integrity mismatch: ${name}@${policy.version}`);
  console.log(JSON.stringify({ package: name, version: policy.version, integrity: actual, published: !existing }));
}
