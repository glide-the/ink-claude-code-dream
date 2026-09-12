#!/usr/bin/env node
// [Input] Package metadata, process argv/environment/stdio, and one matching optional native package.
// [Output] Select and supervise the exact Dream Runtime executable for the current Node platform.
// [Pos] Package-root CLI entrypoint; both `claude` and `ink-claude-code-dream` npm bins resolve here.
// [Sync] 2026-09-12: restore the reference package's package-root `cli.js` shape while retaining Dream's native target split.

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Capability marker forwarded by every verified platform Runtime:
// CLAUDE_SECURESTORAGE_CONFIG_DIR
const packageRoot = path.dirname(fileURLToPath(import.meta.url));
const packageMetadata = JSON.parse(
  readFileSync(path.join(packageRoot, "package.json"), "utf8"),
);
const target = `${process.platform}-${process.arch}`;
const platformPackage = `${packageMetadata.name}-${target}`;
const expectedVersion = packageMetadata.optionalDependencies?.[platformPackage];

if (expectedVersion !== packageMetadata.version) {
  console.error(`ink-claude-code-dream: unsupported platform ${target}`);
  process.exit(78);
}

const require = createRequire(import.meta.url);
let platformPackageJson;
try {
  platformPackageJson = require.resolve(`${platformPackage}/package.json`);
} catch {
  console.error(
    `ink-claude-code-dream: missing optional platform package ${platformPackage}@${expectedVersion}`,
  );
  process.exit(78);
}

const installedPlatform = JSON.parse(readFileSync(platformPackageJson, "utf8"));
if (
  installedPlatform.name !== platformPackage ||
  installedPlatform.version !== expectedVersion ||
  installedPlatform.os?.[0] !== process.platform ||
  installedPlatform.cpu?.[0] !== process.arch
) {
  console.error(
    `ink-claude-code-dream: incompatible optional platform package ${platformPackage}`,
  );
  process.exit(78);
}

const executable = path.join(
  path.dirname(platformPackageJson),
  "runtime",
  "bin",
  "ink-claude-code-dream",
);
const child = spawn(executable, process.argv.slice(2), {
  stdio: "inherit",
  env: process.env,
});

let terminatingSignal;
let forceChild;
let forceLauncher;
const signals = ["SIGINT", "SIGTERM"];
const forward = new Map(
  signals.map((signal) => [
    signal,
    () => {
      if (terminatingSignal) return;
      terminatingSignal = signal;
      if (child.exitCode === null && child.signalCode === null) child.kill(signal);
      forceChild = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      }, 2_000);
      forceLauncher = setTimeout(
        () => process.exit(signal === "SIGINT" ? 130 : 143),
        2_500,
      );
    },
  ]),
);
for (const [signal, handler] of forward) process.on(signal, handler);

const cleanup = () => {
  for (const [signal, handler] of forward) process.off(signal, handler);
  if (forceChild) clearTimeout(forceChild);
  if (forceLauncher) clearTimeout(forceLauncher);
};

child.once("error", (error) => {
  cleanup();
  console.error(`ink-claude-code-dream: ${error.message}`);
  process.exit(1);
});
child.once("exit", (status, signal) => {
  cleanup();
  if (signal) process.kill(process.pid, signal);
  else process.exit(status ?? 1);
});
