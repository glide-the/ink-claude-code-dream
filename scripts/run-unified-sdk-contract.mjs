#!/usr/bin/env node
// [Input] Canonical source bundle, an explicitly selected unmodified Dream SDK/Python, and the existing local-provider SDK harness.
// [Output] Exercise the real original-module Runtime's SDK streaming/tools/sandbox/session contract, with no external model calls.
// [Pos] Portable launcher reusing the existing public-SDK contract rather than a second Runtime or protocol harness.
// [Sync] 2026-09-13: remove the legacy envelope lane from current SDK qualification.

import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
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
const differential = process.argv.includes("--differential");
const dreamCompat = process.argv.includes("--dream-compat");
if (dreamCompat && (differential || mcp)) throw new Error("--dream-compat is a candidate SDK contract, not a reference/MCP lane");
if (differential && !process.env.INK_TEST_REFERENCE_CLI?.startsWith("/")) {
  await rm(fixture, { recursive: true, force: true });
  throw new Error("differential qualification requires an explicit absolute official CLI");
}
const mcpPython = process.env.INK_MCP_FIXTURE_PYTHON || python;
if (mcp || dreamCompat) {
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
  if (differential) {
    const qualification = join(root, "dist/core-local/qualification");
    await mkdir(qualification, { recursive: true });
    Object.assign(env, { INK_SDK_PYTHON: python, INK_MCP_FIXTURE_PYTHON: mcpPython,
      INK_TEST_REFERENCE_CLI: process.env.INK_TEST_REFERENCE_CLI, INK_TEST_CANDIDATE_CLI: wrapper,
      INK_CORE_BUILD_RECEIPT: join(root, "dist/core-local/build-receipt.json"),
      INK_CORE_BUNDLE_PATH: join(root, "dist/core-local/bundle/cli.js"),
      [mcp ? "INK_CORE_MCP_RECEIPT" : "INK_CORE_SDK_RECEIPT"]: join(qualification, mcp ? "mcp-differential.json" : "sdk-differential.json") });
  }
  const contracts = [];
  for (const transport of !differential && mcp ? ["stdio", "http"] : [null]) {
    const args = differential
      ? [join(root, mcp ? "scripts/run-core-mcp-differential.mjs" : "scripts/run-core-sdk-differential.mjs")]
      : [join(root, mcp ? "scripts/run-core-mcp-contract.py" : "scripts/run-core-sdk-contract.py"), "--cli", wrapper];
    if (transport) args.push("--python", mcpPython, "--transport", transport);
    if (dreamCompat) args.push("--dream-compat");
    const result = spawnSync(differential ? process.execPath : python, args, { cwd: root, env, encoding: "utf8", timeout: differential ? 600000 : 180000 });
    if (result.status !== 0) {
      process.stderr.write(result.stderr || result.stdout || "source SDK/MCP contract failed\n");
      process.exitCode = result.status || 1;
      break;
    }
    contracts.push(JSON.parse(result.stdout));
  }
  if (dreamCompat && !process.exitCode) {
    const mcpResult = spawnSync(python, [join(root, "scripts/run-core-mcp-contract.py"), "--cli", wrapper, "--python", mcpPython, "--transport", "stdio", "--dream-compat"], { cwd: root, env, encoding: "utf8", timeout: 180000 });
    if (mcpResult.status !== 0) throw new Error(mcpResult.stderr || mcpResult.stdout || "Dream stdio MCP child isolation failed");
    const mcpContract = JSON.parse(mcpResult.stdout);
    contracts[0].dreamCompatibility.notionStdioExcluded = mcpContract.notionStdioExcluded === true;
    const build = JSON.parse(await readFile(join(root, "dist/core-local/build-receipt.json"), "utf8"));
    const receipt = { schemaVersion: 1, status: "passed", evidenceType: "real-process-dream-runtime-contract", calibrationOnly: false,
      subject: { runtime: "ink-claude-code-dream", version: "0.1.9", sourceDigest: build.sourceDigest.digest,
        runtimeTarget: build.runtimeTarget, coreBundleSha256: createHash("sha256").update(await readFile(join(root, "dist/core-local/bundle/cli.js"))).digest("hex") },
      facts: contracts[0].dreamCompatibility, businessAcceptanceIncluded: false };
    const directory = join(root, "dist/core-local/qualification");
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "dream-runtime.json"), JSON.stringify(receipt, null, 2) + "\n", { mode: 0o600 });
  }
  if (!process.exitCode) console.log(JSON.stringify({ ok: true, sdkVersion: pin.stdout.trim(), sdkModified: false,
    implementationRoot: "src", provider: "existing-local-fixture-only", kind: mcp ? "mcp" : "sdk", contracts }));
} finally { await rm(fixture, { recursive: true, force: true }); }
