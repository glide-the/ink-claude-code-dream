// [Input] Repository source, Bun/package contract, Runtime manifests, headers, and git inventory.
// [Output] Fail on version/contract drift, missing headers, vendor material, secrets, or unsafe package scripts.
// [Pos] Read-only clean-room lint gate; it never reads user configuration or external Runtime data.

import { readFile, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { extname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
if (packageJson.name !== "ink-claude-code-dream") {
  throw new Error("package name must be the unscoped Runtime distribution identity");
}
if (packageJson.bin?.["ink-claude-code-dream"] !== "dist/release/ink-claude-code-dream-0.1.0/bin/ink-claude-code-dream") {
  throw new Error("console bin must expose the extensionless Runtime entrypoint");
}
if (packageJson.private !== true || packageJson.license !== "UNLICENSED") {
  throw new Error("package must remain private and UNLICENSED");
}
if (packageJson.inkBuild?.archiveNode !== "24.13.0") {
  throw new Error("archive Node/zlib toolchain pin drift");
}
for (const script of ["lint", "build", "test", "package", "verify"]) {
  if (!packageJson.scripts?.[script]) throw new Error(`missing package script: ${script}`);
}

const jsonFiles = [
  "runtime/release-manifest.json",
  "runtime/capabilities.json",
  "runtime/platforms.json",
  "runtime/artifact-manifest.json",
  "runtime/entrypoint-policy.json",
  "runtime/runtime-data-contract.json",
  "runtime/bare-profile.json",
  "runtime/dependency-licenses.json",
  "runtime/pruning-decision.json",
];
const parsed = new Map();
for (const path of jsonFiles) {
  parsed.set(path, JSON.parse(await readFile(resolve(root, path), "utf8")));
}
const release = parsed.get("runtime/release-manifest.json");
if (
  release.runtime?.name !== "ink-claude-code-dream" ||
  release.runtime?.integration?.sdkVersion !== "0.2.143" ||
  release.core?.version !== "2.1.241" ||
  release.core?.execution !== "unmodified-as-published" ||
  release.core?.corePruned !== false ||
  release.core?.productionEligible !== false ||
  !Array.isArray(release.core?.blockingReasons) ||
  release.legalGate?.authentication !== "unaltered-opaque-pass-through"
) {
  throw new Error("release baseline/legal contract drift");
}
const bare = parsed.get("runtime/bare-profile.json");
if (
  bare.activation?.wrapperMustNotInjectFlag !== true ||
  bare.authentication?.automaticConversion !== false
) {
  throw new Error("bare profile must remain explicit and auth-neutral");
}
const licenses = parsed.get("runtime/dependency-licenses.json");
if (
  licenses.legalGate?.officialBinaryMustBeUnmodified !== true ||
  licenses.legalGate?.vendorBinaryMayBeCommitted !== false
) {
  throw new Error("license gate drift");
}
const pruning = parsed.get("runtime/pruning-decision.json");
if (
  pruning.decision?.corePruned !== false ||
  pruning.decision?.productionEligible !== false ||
  pruning.decision?.coreLoadingReductionBytes !== 0 ||
  !Array.isArray(pruning.decision?.reasonCodes) ||
  pruning.decision.reasonCodes.length < 4 ||
  !Array.isArray(pruning.authorizationAndInputsRequiredToProceed) ||
  pruning.authorizationAndInputsRequiredToProceed.length < 6 ||
  !pruning.candidateDisposition?.every((entry) => entry.coreDeleted === false)
) {
  throw new Error("pruning decision must fail closed until authorization and build inputs exist");
}

const inventoryResult = spawnSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { cwd: root, encoding: "buffer" },
);
if (inventoryResult.status !== 0) throw new Error("git inventory failed");
const paths = inventoryResult.stdout
  .toString("utf8")
  .split("\0")
  .filter(Boolean);
for (const path of paths) {
  if (path.startsWith("restored-src/") || path.startsWith("vendor/")) {
    throw new Error(`restricted source path found: ${path}`);
  }
  let info;
  try {
    info = await stat(resolve(root, path));
  } catch (error) {
    if (error.code === "ENOENT") continue;
    throw error;
  }
  if (info.size > 10 * 1024 * 1024) {
    throw new Error(`unexpected large file (possible vendor artifact): ${path}`);
  }
  if (path.startsWith("dist/")) continue;
  if ([".js", ".mjs", ".ts", ".py", ".md"].includes(extname(path))) {
    const head = (await readFile(resolve(root, path), "utf8")).split("\n").slice(0, 8).join("\n");
    if (!head.includes("[Input]") || !head.includes("[Output]") || !head.includes("[Pos]")) {
      throw new Error(`missing file contract header: ${path}`);
    }
  }
}

process.stdout.write(`${JSON.stringify({ ok: true, files: paths.length, json: jsonFiles.length })}\n`);
