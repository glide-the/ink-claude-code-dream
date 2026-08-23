// [Input] Optional INK_DREAM_REPO/INK_DREAM_PYTHON overrides or the documented sibling-repository topology.
// [Output] Run the read-only upstream SDK/Dream helper acceptance with a verified Python interpreter.
// [Pos] Portable cross-repository test launcher; it never installs or changes Python packages.

import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dreamRepository = resolve(
  process.env.INK_DREAM_REPO || join(repository, "..", "ink-dream-memory"),
);
const dreamPython = resolve(
  process.env.INK_DREAM_PYTHON || join(dreamRepository, "backend", ".venv", "bin", "python"),
);

try {
  await access(join(dreamRepository, "backend", "libs", "claude_agent_kit", "server", "sdk_env.py"));
  await access(dreamPython, fsConstants.X_OK);
} catch {
  throw new Error(
    "Dream checkout/Python was not found; set INK_DREAM_REPO and INK_DREAM_PYTHON explicitly",
  );
}

const result = spawnSync(
  dreamPython,
  [join(repository, "scripts", "verify-upstream-sdk-contract.py")],
  {
    cwd: repository,
    env: { ...process.env, INK_DREAM_REPO: dreamRepository },
    encoding: "utf8",
  },
);
process.stdout.write(result.stdout || "");
process.stderr.write(result.stderr || "");
if (result.error) throw result.error;
if (result.status !== 0) process.exitCode = result.status ?? 1;
