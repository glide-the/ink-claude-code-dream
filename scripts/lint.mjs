// [Input] Repository source, Bun/package contract, Runtime manifests, headers, and git inventory.
// [Output] Fail on clean-room/legacy contract drift, restored-snapshot drift, missing headers, secrets, or unsafe package scripts.
// [Pos] Read-only clean-room lint gate; it never reads user configuration or external Runtime data.
// [Sync] 2026-08-24: verify the final Dream receipt digest and authorized clean-room publication gate.
// [Sync] 2026-09-13: admit the verified research snapshot while keeping it outside every clean-room package and closing 0.1.7 release gates.

import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { extname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const sourcePackage = JSON.parse(await readFile(resolve(root, "package/package.json"), "utf8"));
const repositoryLicense = await readFile(resolve(root, "LICENSE"));
const sourcePackageLicense = await readFile(resolve(root, "package/LICENSE.md"));
if (
  packageJson.name !== "ink-claude-code-dream" ||
  packageJson.version !== "0.1.7" ||
  packageJson.private !== true ||
  Object.hasOwn(packageJson, "bin") ||
  sourcePackage.name !== "@glide-the/ink-claude-code-dream" ||
  sourcePackage.version !== packageJson.version ||
  sourcePackage.private !== true ||
  sourcePackage.bin?.claude !== "cli.js" ||
  sourcePackage.bin?.["ink-claude-code-dream"] !== "cli.js" ||
  Object.hasOwn(sourcePackage, "exports") ||
  !sourcePackageLicense.equals(repositoryLicense)
) {
  throw new Error("private workspace or package-root selector contract drift");
}
if (packageJson.license !== "UNLICENSED" || sourcePackage.license !== "MIT") {
  throw new Error("mixed-source repository must be unlicensed while its clean-room package remains MIT-licensed");
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
  "runtime/local-artifact-policy.json",
  "runtime/npm-release-policy.json",
  "runtime/cleanroom-artifact-policy.json",
  "runtime/cleanroom-npm-policy.json",
  "runtime/cleanroom-sandbox-policy.json",
  "runtime/cleanroom-dependency-licenses.json",
  "runtime/attestations/dream-real-business-acceptance-0.1.3.json",
  "runtime/attestations/dream-real-business-acceptance-0.1.5.json",
];
const parsed = new Map();
for (const path of jsonFiles) {
  parsed.set(path, JSON.parse(await readFile(resolve(root, path), "utf8")));
}
const release = parsed.get("runtime/release-manifest.json");
if (
  release.runtime?.name !== "ink-claude-code-dream" ||
  release.runtime?.integration?.sdkVersion !== "0.2.145" ||
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
  licenses.legalGate?.vendorSourceMayBeCommitted !== false ||
  licenses.legalGate?.restoredResearchSnapshotMayBeCommitted !== true ||
  licenses.legalGate?.restoredResearchSnapshot !== "restored-src/source-snapshot.json" ||
  licenses.legalGate?.restoredResearchSnapshotMayBePublished !== false ||
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
const historicalReceiptPath = "runtime/attestations/dream-real-business-acceptance-0.1.3.json";
const historicalReceiptBody = await readFile(resolve(root, historicalReceiptPath));
const historicalReceipt = parsed.get(historicalReceiptPath);
const historicalReceiptSha256 = createHash("sha256").update(historicalReceiptBody).digest("hex");
const previousReceiptPath = "runtime/attestations/dream-real-business-acceptance-0.1.5.json";
const previousReceiptBody = await readFile(resolve(root, previousReceiptPath));
const previousReceipt = parsed.get(previousReceiptPath);
const previousReceiptSha256 = createHash("sha256").update(previousReceiptBody).digest("hex");
const targetQualification = cleanroom.publicationGate?.targetHostQualification;
if (
  cleanroom.schemaVersion !== "ink-cleanroom-runtime-policy/v1" ||
  cleanroom.artifact?.version !== "0.1.7" ||
  cleanroom.artifact?.entrypoint !== "cli.js" ||
  cleanroom.artifact?.license !== "MIT" ||
  cleanroom.source?.root !== "src/cleanroom" ||
  cleanroom.source?.externalImplementationInputAllowed !== false ||
  cleanroom.source?.restoredSourceAllowed !== false ||
  cleanroom.source?.derivedAnthropicRuntimeAllowed !== false ||
  cleanroom.source?.repositoryResearchSnapshot !== "restored-src/source-snapshot.json" ||
  cleanroom.source?.repositoryResearchSnapshotAllowed !== true ||
  cleanroom.source?.repositoryResearchSnapshotIsBuildInput !== false ||
  cleanroom.publicationGate?.publicationAllowed !== false ||
  cleanroom.publicationGate?.productionEligible !== false ||
  cleanroom.publicationGate?.redistributionAllowed !== false ||
  cleanroom.publicationGate?.businessAcceptance?.required !== true ||
  cleanroom.publicationGate?.businessAcceptance?.passed !== false ||
  cleanroom.publicationGate?.businessAcceptance?.receiptPath !== null ||
  cleanroom.publicationGate?.businessAcceptance?.receiptSha256 !== null ||
  Object.keys(targetQualification ?? {}).sort().join(",") !==
    "darwin-arm64,darwin-x64,linux-arm64,linux-x64" ||
  Object.values(targetQualification ?? {}).some(value => value !== false) ||
  historicalReceiptSha256 !== "2e7da1f41a41af3b229b79080085e587cdae39e664d7630ed209592ec8c73d4b" ||
  historicalReceipt?.schemaVersion !== "ink-dream-real-business-acceptance/v2" ||
  historicalReceipt?.subject?.runtime !== "ink-claude-code-dream" ||
  historicalReceipt?.subject?.version !== "0.1.3" ||
  historicalReceipt?.subject?.acceptedTarget !== "darwin-arm64" ||
  !/^[a-f0-9]{64}$/.test(historicalReceipt?.subject?.sourceTreeSha256 ?? "") ||
  !/^[a-f0-9]{64}$/.test(historicalReceipt?.subject?.acceptedExecutableSha256 ?? "") ||
  historicalReceipt?.acceptance?.status !== "passed" ||
  historicalReceipt?.acceptance?.publicProductionEntrypoints !== true ||
  historicalReceipt?.privacy?.accountIdentifierIncluded !== false ||
  historicalReceipt?.privacy?.oauthCredentialsIncluded !== false ||
  historicalReceipt?.authorization?.explicitPublicNpmReleaseApproved !== true ||
  historicalReceipt?.authorization?.pypiPublicationApproved !== false ||
  previousReceiptSha256 !== "dbe6f521e51c62a774afcb90f1969b66b422ad34e420b1d73f875b989597e662" ||
  previousReceipt?.schemaVersion !== "ink-dream-real-business-acceptance/v2" ||
  previousReceipt?.subject?.runtime !== "ink-claude-code-dream" ||
  previousReceipt?.subject?.version !== "0.1.5" ||
  previousReceipt?.subject?.acceptedTarget !== "darwin-arm64" ||
  previousReceipt?.subject?.sourceTreeSha256 !== "94a2daad5c679d743e9c7b1185dc83d12525224e701887db5fd3c4261fecb8df" ||
  previousReceipt?.subject?.acceptedExecutableSha256 !== "0ba860a59fe58c2f0c51a78ed954555dc5e561790e0ef7d5328cff69e577015b" ||
  previousReceipt?.acceptance?.status !== "passed" ||
  previousReceipt?.acceptance?.publicProductionEntrypoints !== true ||
  previousReceipt?.acceptance?.sameThreadResume !== true ||
  previousReceipt?.acceptance?.ordinaryChatSucceeded !== true ||
  previousReceipt?.acceptance?.notionCliContract?.notionMutationPerformed !== false ||
  previousReceipt?.privacy?.accountIdentifierIncluded !== false ||
  previousReceipt?.privacy?.oauthCredentialsIncluded !== false ||
  previousReceipt?.privacy?.environmentValuesIncluded !== false ||
  previousReceipt?.privacy?.notionApiBodiesIncluded !== false ||
  previousReceipt?.authorization?.explicitPublicNpmReleaseApproved !== true ||
  previousReceipt?.authorization?.pypiPublicationApproved !== false ||
  !Array.isArray(cleanroom.requiredCapabilities) ||
  cleanroom.requiredCapabilities.length !== 14 ||
  !cleanroom.requiredCapabilities.includes("sandbox.notion-cli")
) {
  throw new Error("clean-room source/material/publication contract drift");
}
const localArtifact = parsed.get("runtime/local-artifact-policy.json");
if (
  localArtifact.schemaVersion !== "ink-core-local-artifact-policy/v1" ||
  localArtifact.artifact?.version !== "0.1.7" ||
  localArtifact.legalGate?.publicationAllowed !== false ||
  localArtifact.legalGate?.redistributionAllowed !== false ||
  localArtifact.legalGate?.restoredSourceMayBeCommitted !== true ||
  localArtifact.legalGate?.restoredSourceUse !== "checked-research-and-local-qualification-only" ||
  localArtifact.legalGate?.restoredSourceSnapshot !== "restored-src/source-snapshot.json" ||
  localArtifact.legalGate?.restoredSourceMayBePublished !== false ||
  localArtifact.materialPolicy?.restoredSourceBundled !== false
) {
  throw new Error("local research-source/artifact boundary drift");
}
const cleanroomNpm = parsed.get("runtime/cleanroom-npm-policy.json");
if (
  cleanroomNpm.schemaVersion !== "ink-cleanroom-npm-policy/v1" ||
  cleanroomNpm.version !== "0.1.7" ||
  cleanroomNpm.license !== "MIT" ||
  cleanroomNpm.bunVersion !== "1.4.0" ||
  cleanroomNpm.entrypoint !== "src/cleanroom/cli.ts" ||
  cleanroomNpm.metaPackage?.name !== "@glide-the/ink-claude-code-dream" ||
  cleanroomNpm.metaPackage?.sourceRoot !== "package" ||
  cleanroomNpm.metaPackage?.entrypoint !== "cli.js" ||
  Object.keys(cleanroomNpm.platforms ?? {}).sort().join(",") !==
    "darwin-arm64,darwin-x64,linux-arm64,linux-x64" ||
  cleanroomNpm.materialPolicy?.sourceMapsAllowed !== false ||
  cleanroomNpm.publication?.packageGenerationAllowed !== true ||
  cleanroomNpm.publication?.npmPublishAllowed !== false
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
  JSON.stringify(cleanroomSandbox.network?.allowedDomains) !==
    JSON.stringify(["api.notion.com:443", "developers.notion.com:443", "ntn.dev:443"]) ||
  cleanroomSandbox.network?.strictAllowlist !== true ||
  cleanroomSandbox.process?.terminateProcessGroup !== true ||
  cleanroomSandbox.process?.sessionCache !== false ||
  cleanroomSandbox.notionCli?.observedVersion !== "0.15.1" ||
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
const restoredSourceResult = spawnSync(
  process.execPath,
  [resolve(root, "scripts/sync-restored-source.mjs"), "verify"],
  { cwd: root, encoding: "utf8" },
);
if (restoredSourceResult.status !== 0) {
  throw new Error(`restored source snapshot verification failed: ${restoredSourceResult.stderr}`);
}
const paths = inventoryResult.stdout
  .toString("utf8")
  .split("\0")
  .filter(Boolean);
for (const path of paths) {
  if (path.startsWith("vendor/")) {
    throw new Error(`restricted source path found: ${path}`);
  }
  if (path.startsWith("restored-src/src/")) continue;
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
    if (path.endsWith("/LICENSE.md")) continue;
    const head = (await readFile(resolve(root, path), "utf8")).split("\n").slice(0, 8).join("\n");
    if (!head.includes("[Input]") || !head.includes("[Output]") || !head.includes("[Pos]")) {
      throw new Error(`missing file contract header: ${path}`);
    }
  }
}

process.stdout.write(`${JSON.stringify({ ok: true, files: paths.length, json: jsonFiles.length })}\n`);
