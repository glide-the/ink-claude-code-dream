// [Input] Explicit INK_RESTORED_SOURCE_ROOT pointing to the read-only historical restored-src checkout.
// [Output] Verify recursive/tracked inventory counts and every candidate evidence path recorded by the pruning decision.
// [Pos] Optional local evidence gate; it reads but never copies, builds, patches, or packages restricted source.

import { readdir, readFile, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { isAbsolute, join, resolve } from "node:path";

const configured = process.env.INK_RESTORED_SOURCE_ROOT?.trim();
if (!configured || !isAbsolute(configured)) {
  throw new Error("INK_RESTORED_SOURCE_ROOT must be an explicit absolute restored-src path");
}
const root = resolve(configured);
const sourceRoot = join(root, "src");
if (!(await stat(sourceRoot)).isDirectory()) throw new Error("restored source src directory is missing");

async function filesUnder(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

const files = await filesUnder(sourceRoot);
const typescript = files.filter((path) => path.endsWith(".ts") || path.endsWith(".tsx"));
const tracked = spawnSync("git", ["-C", root, "ls-files", "src"], { encoding: "utf8" });
if (tracked.status !== 0) throw new Error("historical git inventory failed");
const trackedCount = tracked.stdout.split("\n").filter(Boolean).length;
const decision = JSON.parse(await readFile(resolve("runtime/pruning-decision.json"), "utf8"));
const historical = decision.baseline.historicalRestoredSource;
if (
  files.length !== historical.srcFileCountObserved ||
  typescript.length !== historical.typescriptFileCountObserved ||
  trackedCount !== historical.gitTrackedSrcFileCountObserved
) {
  throw new Error(`historical inventory drift: ${JSON.stringify({ files: files.length, typescript: typescript.length, tracked: trackedCount })}`);
}
const evidencePaths = decision.candidateDisposition.flatMap((entry) => entry.historicalCodeEvidence);
for (const path of evidencePaths) {
  try {
    const info = await stat(join(root, path));
    if (path.endsWith("/") ? !info.isDirectory() : !info.isFile()) throw new Error("wrong path type");
  }
  catch { throw new Error(`historical evidence path is missing: ${path}`); }
}
process.stdout.write(`${JSON.stringify({ ok: true, files: files.length, typescript: typescript.length, tracked: trackedCount, evidencePaths: evidencePaths.length })}\n`);
