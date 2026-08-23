// [Input] uv, an optional UV_DEFAULT_INDEX override, and exact public SDK/MCP package versions.
// [Output] Create disposable environments and execute MCP 1.27.0/1.27.1 in-memory compatibility tests.
// [Pos] Networked regression runner; it never installs into or changes Dream/the SDK checkout.

import { mkdtemp, realpath, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

const repository = resolve(import.meta.dirname, "..");
const matrixPrefix = "ink-mcp-matrix-";
const matrixParent = await realpath(tmpdir());
const matrixRoot = await mkdtemp(join(matrixParent, matrixPrefix));
const receipts = [];
const environment = { ...process.env };

function command(executable, args) {
  const result = spawnSync(executable, args, {
    cwd: repository,
    env: environment,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    process.stderr.write(result.stdout || "");
    process.stderr.write(result.stderr || "");
    throw new Error(`${executable} ${args.join(" ")} failed with ${result.status}`);
  }
  return result.stdout.trim();
}

try {
  for (const version of ["1.27.0", "1.27.1"]) {
    const environmentRoot = join(matrixRoot, `mcp-${version}`);
    command("uv", ["venv", environmentRoot, "--python", "3.12"]);
    const python = join(environmentRoot, "bin", "python");
    command("uv", [
      "pip",
      "install",
      "--python",
      python,
      "claude-agent-sdk==0.2.140",
      `mcp==${version}`,
    ]);
    receipts.push(
      JSON.parse(command(python, ["scripts/verify-mcp-version.py", version])),
    );
  }
} finally {
  const createdRoot = await realpath(matrixRoot);
  if (
    dirname(createdRoot) !== matrixParent ||
    !basename(createdRoot).startsWith(matrixPrefix)
  ) {
    throw new Error(`refusing to clean unexpected matrix path: ${createdRoot}`);
  }
  await rm(createdRoot, { recursive: true, force: false });
}
process.stdout.write(`${JSON.stringify({ ok: true, environments: "disposable", receipts })}\n`);
