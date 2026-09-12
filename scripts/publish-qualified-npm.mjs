#!/usr/bin/env node
// [Input] Verified immutable five-tarball set, checked npm policy and CI-only npm authentication.
// [Output] Publish platforms then selector, or verify identical already-published bytes on retry.
// [Pos] Existing GitHub npm workflow publication helper; never builds or logs credentials.
// [Sync] 2026-09-13: bound monotonic registry waits with integer subprocess timeouts; distinguish absence from immutable mismatch safely.

import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const registry = "--registry=https://registry.npmjs.org";
const visibilityTimeoutMs = 300000;
const pollIntervalMs = 5000;

// Only structured npm codes are safe to log. Never emit captured npm bodies or environment values.
function npmCode(result) {
  try {
    const code = JSON.parse(result.stdout).error?.code;
    if (/^E[A-Z0-9]+$/.test(code)) return code;
  } catch { /* npm can return a non-JSON failure body. */ }
  return result.stderr?.match(/^npm (?:ERR!|error) code (E[A-Z0-9]+)\s*$/m)?.[1];
}

function diagnostics(result) {
  const code = npmCode(result) || (/^[A-Z0-9_]+$/.test(result.error?.code) ? result.error.code : "unknown");
  return `exit=${Number.isInteger(result.status) ? result.status : "none"}, code=${code}`;
}

// Transport and clock injection keeps tests offline; the CLI always uses the real verifier and npm.
export async function publishQualifiedNpm(directory, {
  env: inputEnv = process.env,
  run = spawnSync,
  now = () => performance.now(),
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  log = value => console.log(value),
} = {}) {
  if (inputEnv.GITHUB_ACTIONS !== "true") throw new Error("Publication is CI-only");
  directory = path.resolve(directory);
  const policy = JSON.parse(await readFile(path.join(root, "runtime/npm-release-policy.json"), "utf8"));
  const names = [...Object.values(policy.platforms).map(platform => platform.package), policy.metaPackage];
  const archives = (await readdir(directory)).filter(file => file.endsWith(".tgz"));
  if (archives.length !== names.length) throw new Error("Expected exactly five qualified archives");
  const verify = run(process.execPath, [path.join(root, "scripts/verify-npm-tarball.mjs"), ...archives.map(file => path.join(directory, file))], { encoding: "utf8" });
  if (verify.status !== 0) throw new Error("Release set verification failed; publication stopped");
  const env = { ...inputEnv };
  const tokenMode = Boolean(env.NODE_AUTH_TOKEN);
  if (tokenMode) {
    delete env.ACTIONS_ID_TOKEN_REQUEST_URL;
    delete env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  }
  const npm = (args, timeout = 180000) => run("npm", args, { env, encoding: "utf8", timeout });
  function readIntegrity(name, timeout = 180000) {
    const result = npm(["view", `${name}@${policy.version}`, "dist.integrity", "--json", registry,
      "--prefer-online", "--fetch-retries=0", `--fetch-timeout=${timeout}`], timeout);
    if (result.status === 0) {
      let integrity;
      try { integrity = JSON.parse(result.stdout); } catch { /* fail closed below without echoing stdout */ }
      if (typeof integrity !== "string" || integrity.length === 0) {
        throw new Error(`Invalid registry integrity metadata: ${name}@${policy.version}; publication stopped`);
      }
      return integrity;
    }
    if (!result.error && npmCode(result) === "E404") return null;
    throw new Error(`Registry lookup failed for ${name}@${policy.version} (${diagnostics(result)}); publication stopped`);
  }
  for (const name of names) {
    const filename = `${name.replace(/^@/, "").replace("/", "-")}-${policy.version}.tgz`;
    if (!archives.includes(filename)) throw new Error(`Missing exact qualified archive ${filename}`);
    const file = path.join(directory, filename);
    const expected = `sha512-${createHash("sha512").update(await readFile(file)).digest("base64")}`;
    let actual = readIntegrity(name);
    const published = actual === null;
    if (actual !== null && actual !== expected) {
      throw new Error(`Immutable registry version has different bytes: ${name}@${policy.version}`);
    }
    if (published) {
      const result = npm(["publish", file, "--access=public", `--provenance=${!tokenMode}`, registry]);
      if (result.status !== 0) {
        throw new Error(`npm publication failed for ${name}@${policy.version} (${diagnostics(result)}); no automatic upload retry`);
      }
      const deadline = now() + visibilityTimeoutMs;
      while (actual === null) {
        const remaining = Math.floor(deadline - now());
        if (remaining <= 0) {
          throw new Error(`Registry visibility timed out after ${visibilityTimeoutMs}ms: ${name}@${policy.version}; upload accepted, retry only the identical qualified archive set`);
        }
        actual = readIntegrity(name, Math.min(180000, remaining));
        if (actual !== null && actual !== expected) {
          throw new Error(`Public registry integrity mismatch: ${name}@${policy.version}; publication stopped`);
        }
        if (actual === null) {
          const delay = Math.min(pollIntervalMs, deadline - now());
          if (delay > 0) await sleep(delay);
        }
      }
    }
    log(JSON.stringify({ package: name, version: policy.version, integrity: actual, published }));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await publishQualifiedNpm(process.argv[2] || "dist/npm-publish");
}
