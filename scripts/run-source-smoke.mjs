#!/usr/bin/env node
// [Input] The actual compiled original Runtime bundle and locked Bun, not a fake or cleanroom entrypoint.
// [Output] Prove version and empty MCP inventory work; interactive mode is explicitly rejected by the headless profile.
// [Pos] Provider-free source Runtime smoke; no user prompt, model, or credential is used.
// [Sync] 2026-09-13: replace the obsolete supervisor/fake-core acceptance path.

import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const bun = join(process.env.INK_CORE_TOOLCHAIN_ROOT || root, "node_modules/.bin/bun");
const fixture = await mkdtemp(join(tmpdir(), "ink-original-source-smoke-"));
try {
  const home = join(fixture, "home");
  const workspace = join(fixture, "workspace");
  const scratch = join(workspace, ".claude-tmp");
  await mkdir(home, { mode: 0o700 });
  await mkdir(scratch, { recursive: true, mode: 0o700 });
  const env = { PATH: process.env.PATH, HOME: home, CLAUDE_CONFIG_DIR: home,
    CLAUDE_CODE_TMPDIR: scratch, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1", DISABLE_AUTOUPDATER: "1" };
  const run = args => spawnSync(bun, [join(root, "dist/core-local/bundle/cli.js"), ...args],
    { cwd: workspace, env, encoding: "utf8", timeout: 20000 });
  const version = run(["--version"]);
  if (version.status !== 0 || version.stdout.trim() !== "2.1.241 (Claude Code)") {
    throw new Error("original version smoke failed: " + (version.stderr || version.stdout));
  }
  const inventory = run(["mcp", "list"]);
  if (inventory.status !== 0 || !/No MCP servers configured/i.test(inventory.stdout)) {
    throw new Error("original MCP inventory smoke failed: " + (inventory.stderr || inventory.stdout));
  }
  const interactive = run([]);
  if (interactive.status !== 2 || !interactive.stderr.includes("accepts only print")) {
    throw new Error("headless interactive-mode rejection failed");
  }
  console.log(JSON.stringify({ ok: true, runtime: "0.1.9", implementationRoot: "src",
    version: version.stdout.trim(), mcpInventory: true, interactiveMode: "rejected",
    providerRequests: 0, fakeCore: false }));
} finally { await rm(fixture, { recursive: true, force: true }); }
