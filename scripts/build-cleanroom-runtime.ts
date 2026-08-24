// [Input] Independently implemented src/cleanroom TypeScript and locked Bun dependencies.
// [Output] A local standalone dist/cleanroom/claude executable with no dotenv/bunfig autoload.
// [Pos] Reproducible native build entry for the publishable clean-room Runtime slice.
// [Sync] 2026-08-24: add the first clean-room standalone Bun build.

import { chmod, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..");
const outputRoot = join(repositoryRoot, "dist", "cleanroom");
const executable = join(outputRoot, "claude");

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });

const build = Bun.spawn(
  [
    process.execPath,
    "build",
    "--compile",
    "--no-compile-autoload-dotenv",
    "--no-compile-autoload-bunfig",
    "--sourcemap=none",
    `--outfile=${executable}`,
    join(repositoryRoot, "src", "cleanroom", "cli.ts"),
  ],
  {
    cwd: repositoryRoot,
    env: process.env,
    stdout: "inherit",
    stderr: "inherit",
  },
);

const status = await build.exited;
if (status !== 0) {
  throw new Error(`clean-room Runtime build failed with exit code ${status}`);
}
await chmod(executable, 0o755);
process.stdout.write(`${executable}\n`);
