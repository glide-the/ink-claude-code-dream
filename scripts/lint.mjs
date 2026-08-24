// [Input] Repository source, Bun/package contract, Runtime manifests, headers, and git inventory.
// [Output] Fail on clean-room/legacy contract drift, missing headers, restricted material, secrets, or unsafe package scripts.
// [Pos] Read-only clean-room lint gate; it never reads user configuration or external Runtime data.
// [Sync] 2026-08-24: verify the final Dream receipt digest and authorized clean-room publication gate.

import { createHash } from "node:crypto";
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
if (packageJson.private !== true || packageJson.license !== "MIT") {
  throw new Error("repository orchestrator must remain private while its clean-room source is MIT-licensed");
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
  "runtime/npm-release-policy.json",
  "runtime/cleanroom-artifact-policy.json",
  "runtime/cleanroom-npm-policy.json",
  "runtime/cleanroom-sandbox-policy.json",
  "runtime/cleanroom-dependency-licenses.json",
  "runtime/attestations/dream-real-business-acceptance-0.1.0.json",
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
const cleanroom = parsed.get("runtime/cleanroom-artifact-policy.json");
const businessReceiptPath = "runtime/attestations/dream-real-business-acceptance-0.1.0.json";
const businessReceiptBody = await readFile(resolve(root, businessReceiptPath));
const businessReceipt = parsed.get(businessReceiptPath);
const businessReceiptSha256 = createHash("sha256").update(businessReceiptBody).digest("hex");
const targetQualification = cleanroom.publicationGate?.targetHostQualification;
if (
  cleanroom.schemaVersion !== "ink-cleanroom-runtime-policy/v1" ||
  cleanroom.artifact?.license !== "MIT" ||
  cleanroom.source?.root !== "src/cleanroom" ||
  cleanroom.source?.externalImplementationInputAllowed !== false ||
  cleanroom.source?.restoredSourceAllowed !== false ||
  cleanroom.source?.derivedAnthropicRuntimeAllowed !== false ||
  cleanroom.publicationGate?.publicationAllowed !== true ||
  cleanroom.publicationGate?.productionEligible !== true ||
  cleanroom.publicationGate?.redistributionAllowed !== true ||
  cleanroom.publicationGate?.businessAcceptance?.required !== true ||
  cleanroom.publicationGate?.businessAcceptance?.passed !== true ||
  cleanroom.publicationGate?.businessAcceptance?.receiptPath !== businessReceiptPath ||
  cleanroom.publicationGate?.businessAcceptance?.receiptSha256 !== businessReceiptSha256 ||
  Object.keys(targetQualification ?? {}).sort().join(",") !==
    "darwin-arm64,darwin-x64,linux-arm64,linux-x64" ||
  Object.values(targetQualification ?? {}).some(value => value !== true) ||
  businessReceipt?.schemaVersion !== "ink-dream-real-business-acceptance/v1" ||
  businessReceipt?.subject?.runtime !== "ink-claude-code-dream" ||
  businessReceipt?.subject?.version !== cleanroom.artifact?.version ||
  businessReceipt?.acceptance?.status !== "passed" ||
  businessReceipt?.acceptance?.publicProductionEntrypoints !== true ||
  businessReceipt?.privacy?.accountIdentifierIncluded !== false ||
  businessReceipt?.privacy?.oauthCredentialsIncluded !== false ||
  businessReceipt?.authorization?.explicitPublicNpmReleaseApproved !== true ||
  businessReceipt?.authorization?.pypiPublicationApproved !== false ||
  !Array.isArray(cleanroom.requiredCapabilities) ||
  cleanroom.requiredCapabilities.length !== 13
) {
  throw new Error("clean-room source/material/publication contract drift");
}
const cleanroomNpm = parsed.get("runtime/cleanroom-npm-policy.json");
if (
  cleanroomNpm.schemaVersion !== "ink-cleanroom-npm-policy/v1" ||
  cleanroomNpm.license !== "MIT" ||
  cleanroomNpm.bunVersion !== "1.4.0" ||
  cleanroomNpm.entrypoint !== "src/cleanroom/cli.ts" ||
  cleanroomNpm.metaPackage?.name !== "@glide-the/ink-claude-code-dream" ||
  Object.keys(cleanroomNpm.platforms ?? {}).sort().join(",") !==
    "darwin-arm64,darwin-x64,linux-arm64,linux-x64" ||
  cleanroomNpm.materialPolicy?.sourceMapsAllowed !== false ||
  cleanroomNpm.publication?.packageGenerationAllowed !== true ||
  cleanroomNpm.publication?.npmPublishAllowed !== true
) {
  throw new Error("clean-room npm identity/target/material contract drift");
}
const cleanroomSandbox = parsed.get("runtime/cleanroom-sandbox-policy.json");
if (
  cleanroomSandbox.schema !== "ink-cleanroom-sandbox-policy/v1" ||
  cleanroomSandbox.adapter !== "@anthropic-ai/sandbox-runtime" ||
  cleanroomSandbox.version !== "0.0.73" ||
  cleanroomSandbox.license !== "Apache-2.0" ||
  cleanroomSandbox.network?.default !== "deny" ||
  cleanroomSandbox.process?.terminateProcessGroup !== true ||
  cleanroomSandbox.fallback !== "fail-closed"
) {
  throw new Error("clean-room production sandbox contract drift");
}
const cleanroomDependencies = parsed.get("runtime/cleanroom-dependency-licenses.json");
if (
  cleanroomDependencies.schemaVersion !== "ink-cleanroom-dependency-licenses/v1" ||
  !Array.isArray(cleanroomDependencies.components) ||
  cleanroomDependencies.components.length < 20 ||
  !cleanroomDependencies.components.some(component =>
    component.name === "@anthropic-ai/sandbox-runtime" &&
    component.version === "0.0.73" &&
    component.license === "Apache-2.0"
  ) ||
  cleanroomDependencies.components.some(component =>
    typeof component.name !== "string" ||
    typeof component.version !== "string" ||
    typeof component.license !== "string" ||
    typeof component.packageRoot !== "string" ||
    typeof component.licenseFile !== "string"
  )
) {
  throw new Error("clean-room dependency license inventory drift");
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
  // Generated artifacts are validated by their dedicated manifest/tarball
  // gates. The source lint must not interpret a cross-compiled executable as
  // checked-in vendor material.
  if (path.startsWith("dist/")) continue;
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
  if ([".js", ".mjs", ".ts", ".py", ".md"].includes(extname(path))) {
    const head = (await readFile(resolve(root, path), "utf8")).split("\n").slice(0, 8).join("\n");
    if (!head.includes("[Input]") || !head.includes("[Output]") || !head.includes("[Pos]")) {
      throw new Error(`missing file contract header: ${path}`);
    }
  }
}

process.stdout.write(`${JSON.stringify({ ok: true, files: paths.length, json: jsonFiles.length })}\n`);
