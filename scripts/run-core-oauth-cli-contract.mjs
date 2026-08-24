#!/usr/bin/env node
// [Input] Explicit official MCP Python SDK v2.0.0 fixture/Python paths and the built local core.
// [Output] Fail closed unless the executable headless OAuth redirect/persistence contract passes without skips.
// [Pos] Qualification runner for the Runtime MCP CLI facade; it owns no OAuth, MCP, Dream, or Agent state.
// [Sync] 2026-08-24: require an exact official SDK fixture for the headless OAuth qualification lane.

import { constants as fsConstants } from "node:fs";
import { access, lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixturePython = process.env.INK_MCP_OAUTH_FIXTURE_PYTHON;
const fixtureRoot = process.env.INK_MCP_OAUTH_FIXTURE_ROOT;

function fail(message) {
  throw new Error(`[run-core-oauth-cli-contract] ${message}`);
}

for (const [name, value] of Object.entries({
  INK_MCP_OAUTH_FIXTURE_PYTHON: fixturePython,
  INK_MCP_OAUTH_FIXTURE_ROOT: fixtureRoot,
})) {
  if (!value || !path.isAbsolute(value)) fail(`${name} must be an explicit absolute path`);
}

const resolvedPython = await realpath(fixturePython).catch(() => null);
const pythonInfo = resolvedPython ? await lstat(resolvedPython).catch(() => null) : null;
if (!pythonInfo?.isFile()) fail("fixture Python must resolve to a regular file");
await access(resolvedPython, fsConstants.X_OK).catch(() => fail("fixture Python is not executable"));

const rootInfo = await lstat(fixtureRoot).catch(() => null);
if (!rootInfo?.isDirectory() || rootInfo.isSymbolicLink()) {
  fail("fixture root must be a non-symlink directory");
}
const resolvedRoot = await realpath(fixtureRoot);
for (const relative of [
  "mcp_simple_auth/legacy_as_server.py",
  "mcp_simple_auth/simple_auth_provider.py",
]) {
  const info = await lstat(path.join(resolvedRoot, relative)).catch(() => null);
  if (!info?.isFile() || info.isSymbolicLink()) fail(`official fixture file is unavailable: ${relative}`);
}

function run(label, command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    env: options.env ?? process.env,
    encoding: "utf8",
    timeout: options.timeout ?? 30_000,
  });
  if (result.status !== 0) {
    fail(`${label} failed (${result.status})\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }
  return result.stdout.trim();
}

const sdkVersion = run("official MCP SDK version check", fixturePython, [
  "-c",
  "import importlib.metadata as m; print(m.version('mcp'))",
]);
if (sdkVersion !== "2.0.0") fail(`official MCP SDK version must be 2.0.0, received ${sdkVersion}`);

const fixtureTag = run("official fixture tag check", "git", [
  "-C",
  resolvedRoot,
  "describe",
  "--tags",
  "--exact-match",
  "HEAD",
]);
if (fixtureTag !== "v2.0.0") fail(`official fixture must be checked out at v2.0.0, received ${fixtureTag}`);
run("official fixture worktree check", "git", [
  "-C",
  resolvedRoot,
  "diff",
  "--quiet",
  "HEAD",
  "--",
  "mcp_simple_auth",
]);
run("official fixture index check", "git", [
  "-C",
  resolvedRoot,
  "diff",
  "--cached",
  "--quiet",
  "HEAD",
  "--",
  "mcp_simple_auth",
]);

run(
  "headless MCP OAuth CLI contract",
  process.execPath,
  ["--test", "tests/core-mcp-oauth-cli.test.mjs"],
  {
    timeout: 120_000,
    env: {
      ...process.env,
      // Preserve the venv launcher path: resolving its symlink would bypass
      // Python's virtual-environment discovery even though the target is safe.
      INK_MCP_OAUTH_FIXTURE_PYTHON: fixturePython,
      INK_MCP_OAUTH_FIXTURE_ROOT: resolvedRoot,
      INK_REQUIRE_CORE_OAUTH_FIXTURE: "1",
    },
  },
);

process.stdout.write(`${JSON.stringify({
  status: "passed",
  evidenceType: "official-mcp-sdk-v2-headless-oauth-cli-contract",
  sdkVersion,
  fixtureTag,
})}\n`);
