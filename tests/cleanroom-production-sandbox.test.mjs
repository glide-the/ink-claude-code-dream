#!/usr/bin/env node
// [Input] Official Sandbox Runtime 0.0.73 and a disposable real Workspace/tmpdir on the host OS.
// [Output] Evidence for production filesystem/network/env/process isolation and fail-closed setup.
// [Pos] Real local isolation gate for AnthropicSandboxAdapter; no untrusted process fixture is used.
// [Sync] 2026-08-24: cover workspace writes, network deny, env whitelist, timeout, cancel, and output cap.
// [Sync] 2026-08-30: prove the exact thread-bound Notion environment reaches a real sandboxed Bash process.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { SandboxManager } from "@anthropic-ai/sandbox-runtime";
import {
  AnthropicSandboxAdapter,
  NOTION_SANDBOX_ALLOWED_DOMAINS,
  resolveNtnExecutable,
} from "../src/cleanroom/sandbox/production.ts";

async function fixture(t) {
  const base = await realpath(await mkdtemp(path.join(os.tmpdir(), "ink-production-sandbox-")));
  t.after(() => rm(base, { recursive: true, force: true }));
  const workspaceRoot = path.join(base, "workspace");
  const tmpdir = path.join(workspaceRoot, ".claude-tmp");
  const outside = path.join(base, "outside");
  await mkdir(workspaceRoot, { mode: 0o700 });
  await mkdir(tmpdir, { mode: 0o700 });
  await chmod(tmpdir, 0o700);
  await mkdir(outside, { mode: 0o700 });
  return { base, outside, tmpdir, workspaceRoot };
}

test("official production sandbox enforces Dream filesystem, network, env, and process bounds", async (t) => {
  const f = await fixture(t);
  const previousTmpdir = process.env.CLAUDE_CODE_TMPDIR;
  process.env.CLAUDE_CODE_TMPDIR = f.tmpdir;
  t.after(() => {
    if (previousTmpdir === undefined) delete process.env.CLAUDE_CODE_TMPDIR;
    else process.env.CLAUDE_CODE_TMPDIR = previousTmpdir;
  });
  const adapter = await AnthropicSandboxAdapter.create(f);
  t.after(() => adapter.close());

  const run = (command, options = {}) => adapter.execute({
    command,
    cwd: f.workspaceRoot,
    timeoutMs: options.timeoutMs ?? 5_000,
    ...(options.signal ? { signal: options.signal } : {}),
  });

  const inside = await run("printf workspace-ok > inside.txt && cat inside.txt");
  assert.equal(inside.terminalReason, "completed", inside.stderr);
  assert.equal(inside.exitCode, 0, inside.stderr);
  assert.equal(await readFile(path.join(f.workspaceRoot, "inside.txt"), "utf8"), "workspace-ok");

  const escaped = await run("printf forbidden > ../outside/escape.txt");
  assert.notEqual(escaped.exitCode, 0);
  await assert.rejects(access(path.join(f.outside, "escape.txt")));

  const secret = "sandbox-secret-must-not-leak";
  process.env.INK_SANDBOX_TEST_SECRET = secret;
  t.after(() => delete process.env.INK_SANDBOX_TEST_SECRET);
  const environment = await run('test -z "$INK_SANDBOX_TEST_SECRET" && printf "%s" "$TMPDIR"');
  assert.equal(environment.exitCode, 0, environment.stderr);
  assert.equal(environment.stdout, f.tmpdir);
  assert.equal(`${environment.stdout}${environment.stderr}`.includes(secret), false);

  const network = await run("/usr/bin/curl --max-time 2 --silent --show-error http://example.com");
  assert.equal(network.stdout.includes("Example Domain"), false);
  assert.match(`${network.stdout}${network.stderr}`, /blocked|denied|sandbox/i);

  const timedStarted = performance.now();
  const timed = await run("sleep 5", { timeoutMs: 100 });
  assert.equal(timed.terminalReason, "timed_out");
  assert(performance.now() - timedStarted < 1_500);

  const controller = new AbortController();
  setTimeout(() => controller.abort(), 50);
  const cancelStarted = performance.now();
  const cancelled = await run("sleep 5", { signal: controller.signal });
  assert.equal(cancelled.terminalReason, "cancelled");
  assert(performance.now() - cancelStarted < 1_500);

  const capped = await run("yes x", { timeoutMs: 5_000 });
  assert.equal(capped.terminalReason, "output_limit");
  assert(Buffer.byteLength(capped.stdout) + Buffer.byteLength(capped.stderr) <= 1_048_576);
});

test("production sandbox rejects a tmpdir outside the exact Workspace contract", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    AnthropicSandboxAdapter.create({ workspaceRoot: f.workspaceRoot, tmpdir: f.outside }),
    /exact Workspace\/\.claude-tmp/,
  );
});

test("production sandbox exposes only the bound thread Notion environment", async (t) => {
  const f = await fixture(t);
  const notionHome = path.join(f.workspaceRoot, ".notion-home");
  const workersFile = path.join(notionHome, "workers.json");
  await mkdir(notionHome, { mode: 0o700 });
  await chmod(notionHome, 0o700);
  await writeFile(workersFile, "{}\n", { mode: 0o600 });
  const toolRoot = await realpath(await mkdtemp(path.join(os.homedir(), ".ink-notion-cli-sandbox-")));
  t.after(() => rm(toolRoot, { recursive: true, force: true }));
  const ntn = path.join(toolRoot, "ntn");
  const source = path.join(toolRoot, "ntn.c");
  await writeFile(source, `#include <stdio.h>
#include <stdlib.h>
#include <string.h>
int main(void) {
  const char *home = getenv("NOTION_HOME");
  const char *token = getenv("NOTION_API_TOKEN");
  const char *keyring = getenv("NOTION_KEYRING");
  const char *workers = getenv("NOTION_WORKERS_CONFIG_FILE");
  if (!home || strcmp(home, ${JSON.stringify(notionHome)}) != 0) return 11;
  if (!token || token[0] == '\\0') return 12;
  if (!keyring || strcmp(keyring, "0") != 0) return 13;
  if (!workers || strcmp(workers, ${JSON.stringify(workersFile)}) != 0) return 14;
  fputs("notion-env-ok", stdout);
  return 0;
}
`);
  const compiled = spawnSync("/usr/bin/cc", [source, "-o", ntn], { encoding: "utf8" });
  assert.equal(compiled.status, 0, `${compiled.stdout}\n${compiled.stderr}`);

  const previous = Object.fromEntries([
    "CLAUDE_CODE_TMPDIR",
    "NOTION_HOME",
    "NOTION_API_TOKEN",
    "NOTION_KEYRING",
    "NOTION_WORKERS_CONFIG_FILE",
    "PATH",
  ].map((name) => [name, process.env[name]]));
  Object.assign(process.env, {
    CLAUDE_CODE_TMPDIR: f.tmpdir,
    NOTION_HOME: notionHome,
    NOTION_API_TOKEN: "synthetic-notion-token",
    NOTION_KEYRING: "1",
    NOTION_WORKERS_CONFIG_FILE: workersFile,
    PATH: `${toolRoot}${path.delimiter}${process.env.PATH ?? ""}`,
  });
  t.after(() => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  const adapter = await AnthropicSandboxAdapter.create(f);
  t.after(() => adapter.close());
  assert.deepEqual(SandboxManager.getConfig().network.allowedDomains, [
    ...NOTION_SANDBOX_ALLOWED_DOMAINS,
  ]);
  assert.deepEqual(SandboxManager.getConfig().network.deniedDomains, []);
  assert.equal(SandboxManager.getConfig().network.strictAllowlist, true);
  const result = await adapter.execute({
    command: "ntn --version",
    cwd: f.workspaceRoot,
    timeoutMs: 5_000,
  });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "notion-env-ok");
  assert.equal(`${result.stdout}${result.stderr}`.includes("synthetic-notion-token"), false);
});

test("installed ntn 0.15.1 is a directly executable native sandbox carve-out", async (t) => {
  const resolved = await resolveNtnExecutable(process.env);
  if (!resolved) return t.skip("canonical native ntn is not installed on Runtime PATH");
  const version = spawnSync(resolved.path, ["--version"], {
    encoding: "utf8",
    env: { PATH: "/usr/bin:/bin" },
  });
  if (version.status !== 0 || version.stdout.trim() !== "ntn 0.15.1") {
    return t.skip("installed canonical ntn is not version 0.15.1");
  }

  const f = await fixture(t);
  const notionHome = path.join(f.workspaceRoot, ".notion-home");
  await mkdir(notionHome, { mode: 0o700 });
  await chmod(notionHome, 0o700);
  const previous = Object.fromEntries([
    "CLAUDE_CODE_TMPDIR",
    "NOTION_HOME",
    "NOTION_API_TOKEN",
    "NOTION_KEYRING",
    "NOTION_WORKERS_CONFIG_FILE",
    "PATH",
  ].map((name) => [name, process.env[name]]));
  Object.assign(process.env, {
    CLAUDE_CODE_TMPDIR: f.tmpdir,
    NOTION_HOME: notionHome,
    NOTION_KEYRING: "1",
    PATH: `${path.dirname(resolved.path)}${path.delimiter}${process.env.PATH ?? ""}`,
  });
  delete process.env.NOTION_API_TOKEN;
  delete process.env.NOTION_WORKERS_CONFIG_FILE;
  t.after(() => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  const adapter = await AnthropicSandboxAdapter.create(f);
  t.after(() => adapter.close());
  assert(SandboxManager.getConfig().filesystem.allowRead.includes(resolved.path));
  const result = await adapter.execute({
    command: "ntn --version",
    cwd: f.workspaceRoot,
    timeoutMs: 5_000,
  });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout.trim(), "ntn 0.15.1");
  assert.equal(result.stderr, "");
});
