#!/usr/bin/env node
// [Input] A verified local core bundle plus digest-bound SDK, session-MCP, and MCP-management process receipts.
// [Output] An ignored full-runtime qualification receipt bound to the exact core bytes/source digest.
// [Pos] Technical release gate before packaging and real Dream business acceptance; no user data is read.
// [Sync] 2026-08-24: bind every qualification lane to the exact native Runtime target.
// [Sync] 2026-09-12: bind new local qualification receipts to Runtime 0.1.6 only.

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaults = {
  coreReceipt: path.join(repoRoot, "dist/core-local/build-receipt.json"),
  coreBundle: path.join(repoRoot, "dist/core-local/bundle/cli.js"),
  sdkReceipt: path.join(repoRoot, "dist/core-local/qualification/sdk-differential.json"),
  mcpReceipt: path.join(repoRoot, "dist/core-local/qualification/mcp-differential.json"),
  managementReceipt: path.join(
    repoRoot,
    "dist/core-local/qualification/mcp-management.json",
  ),
  output: path.join(repoRoot, "dist/core-local/qualification/full-runtime-qualification.json"),
};

const locations = {
  coreReceipt: path.resolve(process.env.INK_CORE_BUILD_RECEIPT ?? defaults.coreReceipt),
  coreBundle: path.resolve(process.env.INK_CORE_BUNDLE_PATH ?? defaults.coreBundle),
  sdkReceipt: path.resolve(process.env.INK_CORE_SDK_RECEIPT ?? defaults.sdkReceipt),
  mcpReceipt: path.resolve(process.env.INK_CORE_MCP_RECEIPT ?? defaults.mcpReceipt),
  managementReceipt: path.resolve(
    process.env.INK_CORE_MCP_MANAGEMENT_RECEIPT ?? defaults.managementReceipt,
  ),
  output: path.resolve(process.env.INK_CORE_FULL_RECEIPT ?? defaults.output),
};

function fail(message) {
  throw new Error(`[qualify-core-local] ${message}`);
}

async function readJson(file, label) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    fail(`${label} is not readable JSON: ${error.message}`);
  }
}

function run(label, command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    env: process.env,
    timeout: 180_000,
  });
  if (result.status !== 0) {
    fail(
      `${label} failed (${result.status})\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  }
  return { label, exitCode: result.status };
}

function subjectMatches(receiptSubject, expectedSubject) {
  return (
    receiptSubject?.runtime === expectedSubject.runtime &&
    receiptSubject?.version === expectedSubject.version &&
    receiptSubject?.coreBundleSha256 === expectedSubject.coreBundleSha256 &&
    receiptSubject?.sourceDigest === expectedSubject.sourceDigest &&
    receiptSubject?.runtimeTarget === expectedSubject.runtimeTarget
  );
}

function assertDifferential(receipt, evidenceType, subject, label) {
  if (
    receipt.schemaVersion !== 1 ||
    receipt.status !== "passed" ||
    receipt.evidenceType !== evidenceType ||
    receipt.calibrationOnly === true
  ) {
    fail(`${label} is not a bound passing ${evidenceType} receipt`);
  }
  if (!subjectMatches(receipt.subject, subject)) {
    fail(`${label} subject does not bind the selected core bundle/source digest`);
  }
}

function assertManagement(receipt, subject, cliCompatibilityVersion) {
  if (
    receipt.schemaVersion !== 1 ||
    receipt.status !== "passed" ||
    receipt.evidenceType !== "real-process-mcp-management-contract" ||
    receipt.mode !== "candidate" ||
    receipt.calibrationOnly !== false ||
    receipt.runtime?.version !== cliCompatibilityVersion ||
    !subjectMatches(receipt.subject, subject)
  ) {
    fail("MCP management receipt is not a bound passing candidate receipt");
  }
  if (
    receipt.httpUserScope?.addGetListRemove !== "passed" ||
    receipt.httpUserScope?.colonNameSupported !== true ||
    receipt.httpUserScope?.colonLifecyclePassed !== true ||
    receipt.identity?.configAndSecureStorageSamePath !== true ||
    receipt.identity?.configDirectoryMode !== "0700" ||
    receipt.identity?.neutralCwd !== true ||
    receipt.identity?.operatorHomeInherited !== false ||
    receipt.identity?.homePoisonExcludedFromInventoryAndConfig !== true ||
    receipt.safeErrors?.productionDreamRedactionUsed !== true ||
    receipt.safeErrors?.sensitiveMaterialAbsentFromResult !== true ||
    receipt.safeErrors?.sensitiveMaterialAbsentFromReceipt !== true ||
    receipt.oauth?.helpCommandsPassed !== true
  ) {
    fail("MCP management receipt does not satisfy Dream identity/safety capability gates");
  }
  const commands = new Map(
    (receipt.commands ?? []).map(command => [command.label, command]),
  );
  for (const label of [
    "version",
    "initial-list",
    "login-help",
    "logout-help",
    "add-help",
    "remove-help",
    "user-http-add",
    "user-http-get",
    "user-http-list",
    "user-http-remove",
    "list-after-remove",
    "colon-user-http-add",
    "colon-user-http-get",
    "colon-user-http-list",
    "colon-user-http-remove",
    "sensitive-error-add",
    "sensitive-error-get",
    "sensitive-error-list",
    "sensitive-error-remove",
  ]) {
    const command = commands.get(label);
    if (!command || command.exitCode !== 0 || command.timedOut !== false) {
      fail(`MCP management receipt is missing a passing command: ${label}`);
    }
  }
}

const [coreReceipt, coreBundle, sdkReceipt, mcpReceipt, managementReceipt] = await Promise.all([
  readJson(locations.coreReceipt, "core build receipt"),
  readFile(locations.coreBundle),
  readJson(locations.sdkReceipt, "SDK differential receipt"),
  readJson(locations.mcpReceipt, "MCP differential receipt"),
  readJson(locations.managementReceipt, "MCP management receipt"),
]);

if (
  coreReceipt.status !== "built" ||
  coreReceipt.build?.success !== true ||
  coreReceipt.sourceVersionEvidence !== "2.1.88" ||
  coreReceipt.cliCompatibilityVersion !== "2.1.241" ||
  coreReceipt.resolution?.edgeGapCount !== 0 ||
  coreReceipt.resolution?.uniqueGapCount !== 0 ||
  coreReceipt.dceAssertions?.status !== "passed" ||
  coreReceipt.dceAssertions?.violations?.length !== 0 ||
  !/^[a-f0-9]{64}$/.test(coreReceipt.sourceDigest?.digest ?? "") ||
  !["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"].includes(coreReceipt.runtimeTarget)
) {
  fail("core build receipt is not a built, zero-gap, DCE-passed artifact");
}

const subject = {
  runtime: "ink-claude-code-dream",
  version: "0.1.6",
  coreBundleSha256: createHash("sha256").update(coreBundle).digest("hex"),
  sourceDigest: coreReceipt.sourceDigest.digest,
  runtimeTarget: coreReceipt.runtimeTarget,
};
assertDifferential(sdkReceipt, "real-process-sdk-differential", subject, "SDK receipt");
assertDifferential(mcpReceipt, "real-process-mcp-differential", subject, "MCP receipt");
assertManagement(managementReceipt, subject, coreReceipt.cliCompatibilityVersion);

const checks = [
  run("core verifier", process.execPath, ["scripts/verify-core-prune.mjs"]),
  run("static core/package contracts", process.execPath, [
    "--test",
    "tests/core-prune-contract.test.mjs",
    "tests/core-package-local.test.mjs",
    "tests/core-mcp-management-contract.test.mjs",
  ]),
  run("MCP compatibility unit contracts", path.join(repoRoot, "node_modules/.bin/bun"), [
    "--cwd",
    "compat/mcp-auth",
    "test",
  ]),
  run("official MCP SDK headless OAuth CLI contract", process.execPath, [
    "scripts/run-core-oauth-cli-contract.mjs",
  ]),
  run("repository lint", process.execPath, ["scripts/lint.mjs"]),
];

const receipt = {
  schemaVersion: 1,
  status: "passed",
  evidenceType: "full-runtime-qualification",
  subject,
  versionContract: {
    sourceVersionEvidence: coreReceipt.sourceVersionEvidence,
    cliCompatibilityVersion: coreReceipt.cliCompatibilityVersion,
  },
  checks,
  inputs: {
    coreBuildReceiptSha256: createHash("sha256")
      .update(await readFile(locations.coreReceipt))
      .digest("hex"),
    sdkDifferentialReceiptSha256: createHash("sha256")
      .update(await readFile(locations.sdkReceipt))
      .digest("hex"),
    mcpDifferentialReceiptSha256: createHash("sha256")
      .update(await readFile(locations.mcpReceipt))
      .digest("hex"),
    mcpManagementReceiptSha256: createHash("sha256")
      .update(await readFile(locations.managementReceipt))
      .digest("hex"),
  },
  management: {
    evidenceType: managementReceipt.evidenceType,
    status: managementReceipt.status,
    cliCompatibilityVersion: managementReceipt.runtime.version,
    mcpManagementIdentityQualified: true,
    colonLifecyclePassed: managementReceipt.httpUserScope.colonLifecyclePassed,
    productionDreamRedactionUsed:
      managementReceipt.safeErrors.productionDreamRedactionUsed,
    oauthNoBrowserLogin: managementReceipt.oauth.noBrowserLogin,
  },
  scope:
    "provider-boundary SDK/session-MCP protocol, MCP management process identity, and static Runtime artifact gates",
  businessAcceptanceIncluded: false,
};
await mkdir(path.dirname(locations.output), { recursive: true, mode: 0o700 });
await writeFile(locations.output, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
