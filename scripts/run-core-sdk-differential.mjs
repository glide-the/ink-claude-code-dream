#!/usr/bin/env node
// [Input] Explicit official/candidate CLI paths and a Python with the Ink SDK installed.
// [Output] A fail-closed protocol-differential receipt for two real Runtime processes.
// [Pos] Process-boundary release gate; it never substitutes an envelope or fake CLI.
// [Sync] 2026-08-30: isolate the official nested-Docker Unix-socket exemption to the reference lane.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contractScript = path.join(repoRoot, "scripts", "run-core-sdk-contract.py");
const python = process.env.INK_SDK_PYTHON;
const referenceCli = process.env.INK_TEST_REFERENCE_CLI;
const candidateCli = process.env.INK_TEST_CANDIDATE_CLI;
const coreBuildReceiptPath = process.env.INK_CORE_BUILD_RECEIPT;
const coreBundlePath = process.env.INK_CORE_BUNDLE_PATH;

for (const [name, value] of Object.entries({
  INK_SDK_PYTHON: python,
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

const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ink-core-sdk-differential-"));

function runLane(label, cli) {
  const receiptPath = path.join(tempRoot, `${label}.json`);
  const laneEnvironment = { ...process.env };
  delete laneEnvironment.INK_CORE_REFERENCE_ALLOW_ALL_UNIX_SOCKETS;
  if (label === "reference") {
    laneEnvironment.INK_CORE_REFERENCE_ALLOW_ALL_UNIX_SOCKETS = "1";
  }
  const result = spawnSync(
    python,
    [contractScript, "--cli", cli, "--output", receiptPath],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: laneEnvironment,
      timeout: 120_000,
    },
  );
  if (result.status !== 0) {
    throw new Error(
      `${label} SDK contract failed (${result.status})\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  }
  return { receiptPath, stdout: result.stdout, stderr: result.stderr };
}

function invariant(receipt) {
  return {
    contractVersion: receipt.contractVersion,
    initialize: receipt.initialize,
    stream: receipt.stream,
    tools: receipt.tools,
    extensions: receipt.extensions,
    session: receipt.session,
    interrupt: {
      completedWithinProviderDelay:
        receipt.interrupt?.completedWithinProviderDelay === true,
      resultSeen: receipt.interrupt?.resultSeen === true,
    },
    runtime: receipt.runtime,
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
    version: "0.1.4",
    coreBundleSha256: createHash("sha256").update(bundle).digest("hex"),
    sourceDigest: coreReceipt.sourceDigest.digest,
    runtimeTarget: coreReceipt.runtimeTarget,
  };
}

try {
  const referenceRun = runLane("reference", referenceCli);
  const candidateRun = runLane("candidate", candidateCli);
  const reference = JSON.parse(await readFile(referenceRun.receiptPath, "utf8"));
  const candidate = JSON.parse(await readFile(candidateRun.receiptPath, "utf8"));

  assert.deepEqual(
    invariant(candidate),
    invariant(reference),
    "candidate differs from the official Runtime on required SDK invariants",
  );

  const subject = await qualificationSubject();
  const receipt = {
    schemaVersion: 1,
    status: "passed",
    evidenceType: "real-process-sdk-differential",
    ...(subject ? { subject } : { calibrationOnly: true }),
    reference: {
      cliVersion: reference.cliVersion,
      sandboxSetup: reference.sandboxSetup,
      interruptTerminalReason: reference.interrupt?.terminalReason ?? null,
      requestCount: reference.provider?.requestCount ?? null,
    },
    candidate: {
      cliVersion: candidate.cliVersion,
      sandboxSetup: candidate.sandboxSetup,
      interruptTerminalReason: candidate.interrupt?.terminalReason ?? null,
      requestCount: candidate.provider?.requestCount ?? null,
    },
    comparedInvariant: invariant(candidate),
    allowedObservationalDifferences: [
      "CLI version string",
      "provider request count",
      "optional terminalReason introduced after the restored baseline",
      "official Docker comparator disables only its embedded Unix-socket filter while candidate exercises the restored on-disk helper",
      "timestamps, UUID values, and temporary absolute paths",
    ],
  };
  const output = `${JSON.stringify(receipt, null, 2)}\n`;
  if (process.env.INK_CORE_SDK_RECEIPT) {
    const outputPath = path.resolve(process.env.INK_CORE_SDK_RECEIPT);
    await writeFile(outputPath, output);
  }
  process.stdout.write(output);
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
