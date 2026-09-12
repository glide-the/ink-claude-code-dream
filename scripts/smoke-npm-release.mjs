#!/usr/bin/env node
// [Input] One legally authorized generated native platform package stage.
// [Output] Reviewed Bun postinstall, dry-run/real pack, strict tgz verification, clean install, and executable smoke evidence.
// [Pos] Pre-publish npm acceptance for exactly qualified original-source platform artifacts.
// [Sync] 2026-09-13: preserve the upstream CLI version banner instead of expecting the retired cleanroom format.

import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const [stageArgument] = process.argv.slice(2);
if (!stageArgument) throw new Error("[npm-smoke] usage: smoke-npm-release.mjs <dist/npm-stage/<target>>");
const stageRoot = path.resolve(stageArgument);
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ink-npm-smoke-"));
const verifier = path.resolve(import.meta.dirname, "verify-npm-tarball.mjs");
function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", timeout: 300_000 });
  if (result.status !== 0) throw new Error(`[npm-smoke] ${command} ${args.join(" ")} failed\n${result.stdout}${result.stderr}`);
  return result.stdout;
}
function parseNpmPackJson(output) {
  const marker = output.lastIndexOf("\n[");
  const body = marker >= 0 ? output.slice(marker + 1) : output;
  return JSON.parse(body);
}
try {
  const packageRoot = path.join(stageRoot, "platform");
  const platformPackage = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
  if (JSON.stringify(platformPackage.dependencies) !== JSON.stringify({ bun: "1.4.0" })) {
    throw new Error("[npm-smoke] platform package must depend only on exact bun@1.4.0");
  }
  run("npm", ["install", "--foreground-scripts", "--no-audit", "--no-fund"], packageRoot);
  const installedBunPackage = JSON.parse(
    await readFile(path.join(packageRoot, "node_modules", "bun", "package.json"), "utf8"),
  );
  if (
    installedBunPackage.version !== "1.4.0" ||
    installedBunPackage.scripts?.postinstall !== "node install.js"
  ) {
    throw new Error("[npm-smoke] installed Bun package/postinstall contract drift");
  }
  const dryRun = parseNpmPackJson(run("npm", ["pack", "--dry-run", "--json"], packageRoot));
  if (dryRun[0].files.some(file => file.path.toLowerCase().endsWith(".map"))) {
    throw new Error("[npm-smoke] npm dry-run inventory contains a source map");
  }
  const packed = parseNpmPackJson(run("npm", ["pack", "--json", "--pack-destination", tempRoot], packageRoot));
  const tarball = path.join(tempRoot, packed[0].filename);
  run(process.execPath, [verifier, tarball], stageRoot);
  const installRoot = path.join(tempRoot, "install");
  await mkdir(installRoot, { recursive: true });
  run("npm", ["init", "-y"], installRoot);
  run("npm", ["install", "--foreground-scripts", "--no-audit", "--no-fund", tarball], installRoot);
  const bunVersion = run(
    path.join(installRoot, "node_modules", ".bin", "bun"),
    ["--version"],
    installRoot,
  ).trim();
  if (bunVersion !== "1.4.0") throw new Error(`[npm-smoke] expected Bun 1.4.0, received ${bunVersion}`);
  const platformRoot = path.join(
    installRoot,
    "node_modules",
    ...platformPackage.name.split("/"),
  );
  const cliVersion = run(
    path.join(platformRoot, "bin", "ink-claude-code-dream-platform"),
    ["--version"],
    installRoot,
  ).trim();
  if (!/^2\.1\.241(?: \(Claude Code\))?$/.test(cliVersion)) {
    throw new Error(`[npm-smoke] expected CLI compatibility version 2.1.241, received ${cliVersion}`);
  }
  process.stdout.write(`${JSON.stringify({ status: "npm-smoke-passed", platformPackage: platformPackage.name, bunVersion, cliVersion, tarballs: 1, sourceMaps: 0 })}\n`);
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
