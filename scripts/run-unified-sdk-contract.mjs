#!/usr/bin/env node
// [Input] Canonical source bundle, an explicitly selected unmodified Dream SDK/Python, and the existing local-provider SDK harness.
// [Output] Exercise the real original-module Runtime's SDK streaming/tools/sandbox/session contract, with no external model calls.
// [Pos] Portable launcher reusing the existing public-SDK contract rather than a second Runtime or protocol harness.
// [Sync] 2026-09-13: remove the legacy envelope lane from current SDK qualification.

import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const python = process.env.INK_DREAM_PYTHON;
if (!python) throw new Error("set INK_DREAM_PYTHON to the installed SDK 0.2.145 interpreter");
const bun = join(process.env.INK_CORE_TOOLCHAIN_ROOT || root, "node_modules/.bin/bun");
const pin = spawnSync(python, ["-c", "from importlib.metadata import version; print(version('ink-claude-dream-agent-sdk'))"], { encoding: "utf8" });
if (pin.status !== 0 || pin.stdout.trim() !== "0.2.145") throw new Error("unmodified SDK 0.2.145 is required");
const fixture = await mkdtemp(join(tmpdir(), "ink-original-sdk-launch-"));
const mcp = process.argv.includes("--mcp");
const mcpPython = process.env.INK_MCP_FIXTURE_PYTHON || python;
if (mcp) {
  const fixturePin = spawnSync(mcpPython, ["-c", "from importlib.metadata import version; from mcp.server import MCPServer; assert version('mcp') == '2.0.0'"], { encoding: "utf8" });
  if (fixturePin.status !== 0) {
    await rm(fixture, { recursive: true, force: true });
    throw new Error("set INK_MCP_FIXTURE_PYTHON to the MCP 2.0.0 fixture interpreter; Dream's MCP 1.x environment is not this fixture");
  }
}
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
try {
  const home = join(fixture, "home");
  await mkdir(home, { mode: 0o700 });
  const wrapper = join(fixture, "cli");
  await writeFile(wrapper, "#!/bin/sh\nexec " + quote(bun) + " " + quote(join(root, "dist/core-local/bundle/cli.js")) + " \"$@\"\n", { mode: 0o755 });
  const env = { PATH: process.env.PATH, HOME: home, PYTHONDONTWRITEBYTECODE: "1",
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1", DISABLE_AUTOUPDATER: "1" };
  const contracts = [];
  for (const transport of mcp ? ["stdio", "http"] : [null]) {
    const args = [join(root, mcp ? "scripts/run-core-mcp-contract.py" : "scripts/run-core-sdk-contract.py"), "--cli", wrapper];
    if (transport) args.push("--python", mcpPython, "--transport", transport);
    const result = spawnSync(python, args, { cwd: root, env, encoding: "utf8", timeout: 180000 });
    if (result.status !== 0) {
      process.stderr.write(result.stderr || result.stdout || "source SDK/MCP contract failed\n");
      process.exitCode = result.status || 1;
      break;
    }
    contracts.push(JSON.parse(result.stdout));
  }
  if (!process.exitCode) console.log(JSON.stringify({ ok: true, sdkVersion: pin.stdout.trim(), sdkModified: false,
    implementationRoot: "src", provider: "existing-local-fixture-only", kind: mcp ? "mcp" : "sdk", contracts }));
} finally { await rm(fixture, { recursive: true, force: true }); }
