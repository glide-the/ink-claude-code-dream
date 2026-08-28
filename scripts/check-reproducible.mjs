// [Input] Consume the repository source, Bun lock, deterministic builder/packer, and fixed SOURCE_DATE_EPOCH.
// [Output] Build and pack twice, then fail if either release inventory or archive SHA-256 changes.
// [Pos] Reproducibility acceptance gate.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const environment = { ...process.env, SOURCE_DATE_EPOCH: "1787443200" };
const archive = resolve("dist/ink-claude-code-dream-0.1.2.tar.gz");
const checksums = resolve(
  "dist/release/ink-claude-code-dream-0.1.2/manifest/checksums.sha256",
);

function command(executable, args) {
  const result = spawnSync(executable, args, { env: environment, encoding: "utf8" });
  if (result.status !== 0) {
    process.stderr.write(result.stdout || "");
    process.stderr.write(result.stderr || "");
    throw new Error(`${executable} ${args.join(" ")} failed with ${result.status}`);
  }
}

async function buildReceipt() {
  command("bun", ["run", "build"]);
  command(process.execPath, ["scripts/verify-release.mjs"]);
  command(process.execPath, ["scripts/pack-release.mjs"]);
  return {
    archive: createHash("sha256").update(await readFile(archive)).digest("hex"),
    inventory: createHash("sha256").update(await readFile(checksums)).digest("hex"),
  };
}

const first = await buildReceipt();
const second = await buildReceipt();
if (first.archive !== second.archive || first.inventory !== second.inventory) {
  throw new Error(`reproducibility mismatch: ${JSON.stringify({ first, second })}`);
}
process.stdout.write(`${JSON.stringify({ ok: true, first, second })}\n`);
