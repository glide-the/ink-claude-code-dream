#!/usr/bin/env node
// [Input] Explicit official/candidate CLI paths and an Ink SDK Python executable.
// [Output] A real-process stdio/HTTP MCP differential receipt.
// [Pos] Protocol release gate for handshake, tools, resources, inventory, and colon names.
// [Sync] 2026-08-24: bind MCP differential evidence to the exact native Runtime target.
// [Sync] 2026-09-13: require candidate identity Runtime 0.1.9 in new MCP evidence.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contractScript = path.join(repoRoot, "scripts", "run-core-mcp-contract.py");
const python = process.env.INK_SDK_PYTHON;
const fixturePython = process.env.INK_MCP_FIXTURE_PYTHON || python;
const referenceCli = process.env.INK_TEST_REFERENCE_CLI;
const candidateCli = process.env.INK_TEST_CANDIDATE_CLI;
const coreBuildReceiptPath = process.env.INK_CORE_BUILD_RECEIPT;
const coreBundlePath = process.env.INK_CORE_BUNDLE_PATH;

for (const [name, value] of Object.entries({
  INK_SDK_PYTHON: python,
  INK_MCP_FIXTURE_PYTHON: fixturePython,
  INK_TEST_REFERENCE_CLI: referenceCli,
  INK_TEST_CANDIDATE_CLI: candidateCli,
})) {
  if (!value || !path.isAbsolute(value)) {
    throw new Error(`${name} must be an explicit absolute path`);
  }
}
if (Boolean(coreBuildReceiptPath) !== Boolean(coreBundlePath)) {
  throw new Error("INK_CORE_BUILD_RECEIPT and INK_CORE_BUNDLE_PATH must be supplied together");
}

const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ink-core-mcp-differential-"));

function runLane(label, cli, transport) {
  const receiptPath = path.join(tempRoot, `${label}-${transport}.json`);
  const result = spawnSync(
    python,
    [
      contractScript,
      "--cli",
      cli,
      "--python",
      fixturePython,
      "--transport",
      transport,
      "--output",
      receiptPath,
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: process.env,
      timeout: 120_000,
    },
  );
  if (result.status !== 0) {
    throw new Error(
      `${label}/${transport} MCP contract failed (${result.status})\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  }
  return receiptPath;
}

function invariant(receipt) {
  const requiredMethods = [
    "initialize",
    "notifications/initialized",
    "tools/list",
    "tools/call",
    "resources/list",
    "resources/read",
  ];
  return {
    contractVersion: receipt.contractVersion,
    transport: receipt.transport,
    serverName: receipt.serverName,
    initializeFirst: receipt.initializeFirst,
    requiredMethods: Object.fromEntries(
      requiredMethods.map((method) => [method, receipt.methods.includes(method)]),
    ),
    inventory: {
      connectedBefore: receipt.inventory?.connectedBefore,
      disabledWithoutIdentityLoss: receipt.inventory?.disabledWithoutIdentityLoss,
      connectedAfter: receipt.inventory?.connectedAfter,
      toolsReported: receipt.inventory?.toolsReported,
    },
    providerTools: receipt.providerTools,
    permissionTools: receipt.permissionTools,
    toolCall: receipt.toolCall,
    resourcesListRead: receipt.resourcesListRead,
    resultSession: receipt.resultSession,
    httpRecovery: receipt.httpRecovery,
  };
}

async function qualificationSubject() {
  if (!coreBuildReceiptPath || !coreBundlePath) return null;
  const coreReceipt = JSON.parse(await readFile(path.resolve(coreBuildReceiptPath), "utf8"));
  if (
    coreReceipt.status !== "built" ||
    coreReceipt.build?.success !== true ||
    coreReceipt.resolution?.edgeGapCount !== 0 ||
    coreReceipt.resolution?.uniqueGapCount !== 0 ||
    !["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"].includes(coreReceipt.runtimeTarget) ||
    !/^[a-f0-9]{64}$/.test(coreReceipt.sourceDigest?.digest ?? "")
  ) {
    throw new Error("core build receipt is not a successful zero-gap build");
  }
  const bundle = await readFile(path.resolve(coreBundlePath));
  return {
    runtime: "ink-claude-code-dream",
    version: "0.1.9",
    coreBundleSha256: createHash("sha256").update(bundle).digest("hex"),
    sourceDigest: coreReceipt.sourceDigest.digest,
    runtimeTarget: coreReceipt.runtimeTarget,
  };
}

try {
  const lanes = {};
  for (const transport of ["stdio", "http"]) {
    const reference = JSON.parse(
      await readFile(runLane("reference", referenceCli, transport), "utf8"),
    );
    const candidate = JSON.parse(
      await readFile(runLane("candidate", candidateCli, transport), "utf8"),
    );
    assert.deepEqual(
      invariant(candidate),
      invariant(reference),
      `candidate differs from official Runtime on ${transport} MCP invariants`,
    );
    lanes[transport] = {
      status: "passed",
      comparedInvariant: invariant(candidate),
      referenceMethodOrder: reference.methods,
      candidateMethodOrder: candidate.methods,
      referenceEnableError: reference.inventory?.enableError ?? null,
      candidateEnableError: candidate.inventory?.enableError ?? null,
    };
  }

  const subject = await qualificationSubject();
  const receipt = {
    schemaVersion: 1,
    status: "passed",
    evidenceType: "real-process-mcp-differential",
    ...(subject ? { subject } : { calibrationOnly: true }),
    lanes,
    allowedObservationalDifferences: [
      "independent discovery order after initialize",
      "transport-generated session identifiers",
      "timestamps and temporary absolute paths",
    ],
  };
  const output = `${JSON.stringify(receipt, null, 2)}\n`;
  if (process.env.INK_CORE_MCP_RECEIPT) {
    await writeFile(path.resolve(process.env.INK_CORE_MCP_RECEIPT), output);
  }
  process.stdout.write(output);
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
