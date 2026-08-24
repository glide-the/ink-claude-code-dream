#!/usr/bin/env node
// [Input] Official Sandbox Runtime 0.0.73 and a disposable real Workspace/tmpdir on the host OS.
// [Output] Evidence for production filesystem/network/env/process isolation and fail-closed setup.
// [Pos] Real local isolation gate for AnthropicSandboxAdapter; no untrusted process fixture is used.
// [Sync] 2026-08-24: cover workspace writes, network deny, env whitelist, timeout, cancel, and output cap.

import assert from "node:assert/strict";
import { access, chmod, mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AnthropicSandboxAdapter } from "../src/cleanroom/sandbox/production.ts";

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
