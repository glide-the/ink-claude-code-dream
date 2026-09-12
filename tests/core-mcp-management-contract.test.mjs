// [Input] Runtime MCP management harness, provider-free fake CLI, optional official 2.1.241, and read-only Dream production driver source.
// [Output] Prove exact driver reuse, candidate colon lifecycle, secret-safe receipts, identity isolation, and official reference calibration.
// [Pos] Real process-boundary management contract; it performs no OAuth, provider, model, Dream business, or persistent user operation.
// [Sync] 2026-08-24: aggregate qualification binds source provenance separately from the Dream-facing CLI version.
// [Sync] 2026-09-13: bind candidate management evidence to Runtime 0.1.7 and honor explicit isolated-worktree Python selection.

import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(repositoryRoot, "scripts", "run-core-mcp-management-contract.py");
const fakeCli = path.join(repositoryRoot, "tests", "fixtures", "mcp_management_fake_cli.py");
const httpFixture = path.join(
  repositoryRoot,
  "tests",
  "fixtures",
  "mcp_management_http_server.py",
);
const dreamRoot = path.resolve(
  process.env.INK_DREAM_ROOT ?? path.join(repositoryRoot, "..", "ink-dream-memory"),
);
const dreamBackend = path.join(dreamRoot, "backend");
const dreamPython = process.env.INK_DREAM_PYTHON ?? path.join(dreamBackend, ".venv", "bin", "python");
const officialCli = path.resolve(
  process.env.INK_OFFICIAL_CLAUDE_2_1_241 ??
    "/tmp/claude-code-2.1.241.KpY24a/native/package/claude",
);
const secretMarker = "ink-mcp-management-secret-marker-7f6d4a";

async function available(path_) {
  try {
    await access(path_);
    return true;
  } catch {
    return false;
  }
}

function runContract({ cli, output, mode, coreReceipt, coreBundle }) {
  const bindingArguments =
    mode === "candidate"
      ? ["--core-receipt", coreReceipt, "--core-bundle", coreBundle]
      : [];
  return spawnSync(
    dreamPython,
    [
      script,
      "--cli",
      cli,
      "--output",
      output,
      "--dream-backend",
      dreamBackend,
      "--mode",
      mode,
      ...bindingArguments,
    ],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      timeout: 120_000,
    },
  );
}

async function coreBindingFixture(root) {
  const coreReceipt = path.join(root, "core-build-receipt.json");
  const coreBundle = path.join(root, "cli.js");
  await writeFile(coreBundle, "// deterministic management test core\n");
  await writeFile(
    coreReceipt,
    `${JSON.stringify({
      status: "built",
      build: { success: true },
      runtimeTarget: `${process.platform}-${process.arch}`,
      sourceDigest: { digest: "4".repeat(64) },
    })}\n`,
  );
  return { coreReceipt, coreBundle };
}

test("management harness imports Dream's production driver and preserves its exact public argv contract", async t => {
  if (!(await available(path.join(dreamBackend, "claude_mcp", "driver.py")))) {
    t.skip("sibling Dream production driver is unavailable");
    return;
  }
  const [source, driver] = await Promise.all([
    readFile(script, "utf8"),
    readFile(path.join(dreamBackend, "claude_mcp", "driver.py"), "utf8"),
  ]);
  assert.match(source, /from claude_mcp\.driver import ClaudeMcpCliDriver/);
  assert.match(source, /driver\.add_http_user_server/);
  assert.match(source, /driver\.remove_user_server/);
  assert.match(source, /driver\.login_help/);
  assert.match(source, /driver\.logout_help/);
  assert.doesNotMatch(source, /shell\s*=\s*True/);
  assert.match(source, /must be an explicit absolute path/);
  assert.match(source, /COLON_SERVER_NAME = "user:management:contract"/);
  assert.match(driver, /\("mcp", "list"\)/);
  assert.match(driver, /\("mcp", "get", server_name\)/);
  assert.match(driver, /"--transport",\s*"http",\s*"--scope",\s*"user"/s);
  assert.match(driver, /\("mcp", "remove", "--scope", "user", server_name\)/);
  assert.match(driver, /env\["CLAUDE_CONFIG_DIR"\]/);
  assert.match(driver, /env\["CLAUDE_SECURESTORAGE_CONFIG_DIR"\]/);
});

test("full Runtime qualification and packaging require the digest-bound management receipt", async () => {
  const [qualifier, packager, verifier, policy] = await Promise.all([
    readFile(path.join(repositoryRoot, "scripts", "qualify-core-local.mjs"), "utf8"),
    readFile(path.join(repositoryRoot, "scripts", "package-core-local.mjs"), "utf8"),
    readFile(path.join(repositoryRoot, "scripts", "verify-core-package-local.mjs"), "utf8"),
    readFile(path.join(repositoryRoot, "runtime", "local-artifact-policy.json"), "utf8"),
  ]);
  assert.match(qualifier, /INK_CORE_MCP_MANAGEMENT_RECEIPT/);
  assert.match(qualifier, /real-process-mcp-management-contract/);
  assert.match(qualifier, /mcpManagementReceiptSha256/);
  assert.match(qualifier, /mcpManagementIdentityQualified: true/);
  assert.match(qualifier, /colonLifecyclePassed/);
  assert.match(qualifier, /cliCompatibilityVersion !== "2\.1\.241"/);
  assert.match(qualifier, /receipt\.runtime\?\.version !== cliCompatibilityVersion/);
  assert.match(packager, /lacks bound passing MCP management evidence/);
  assert.match(packager, /qualified-process-contract/);
  assert.match(verifier, /qualification lost MCP management evidence/);
  const policyValue = JSON.parse(policy);
  const fullGate = policyValue.qualificationGates.find(gate => gate.id === "full");
  assert.deepEqual(fullGate.requiredEmbeddedEvidence, {
    inputDigestField: "mcpManagementReceiptSha256",
    evidenceType: "real-process-mcp-management-contract",
    qualifiedField: "mcpManagementIdentityQualified",
  });
});

test("provider-free candidate fixture passes colon lifecycle, isolation, and production redaction", async t => {
  if (!(await available(dreamPython))) {
    t.skip("Dream backend Python is unavailable");
    return;
  }
  const root = await mkdtemp(path.join(os.tmpdir(), "ink-mcp-management-node-test-"));
  try {
    const output = path.join(root, "receipt.json");
    const binding = await coreBindingFixture(root);
    const result = runContract({
      cli: fakeCli,
      output,
      mode: "candidate",
      ...binding,
    });
    assert.equal(result.status, 0, result.stderr);
    const receiptText = await readFile(output, "utf8");
    const receipt = JSON.parse(receiptText);
    assert.equal(receipt.status, "passed");
    assert.equal(receipt.calibrationOnly, false);
    assert.equal(receipt.subject.runtime, "ink-claude-code-dream");
    assert.equal(receipt.subject.version, "0.1.7");
    assert.match(receipt.subject.coreBundleSha256, /^[a-f0-9]{64}$/);
    assert.equal(receipt.subject.sourceDigest, "4".repeat(64));
    assert.equal(receipt.subject.runtimeTarget, `${process.platform}-${process.arch}`);
    assert.equal(receipt.evidenceType, "real-process-mcp-management-contract");
    assert.equal(receipt.httpUserScope.addGetListRemove, "passed");
    assert.equal(receipt.httpUserScope.colonNameSupported, true);
    assert.equal(receipt.httpUserScope.colonLifecyclePassed, true);
    assert.deepEqual(receipt.identity, {
      configAndSecureStorageSamePath: true,
      configDirectoryMode: "0700",
      disposableHomeBound: true,
      disposableHomeChanged: false,
      homeInventoryExcluded: true,
      homePoisonExcludedFromInventoryAndConfig: true,
      homeWritesContained: true,
      neutralCwd: true,
      operatorHomeInherited: false,
    });
    assert.equal(receipt.safeErrors.productionDreamRedactionUsed, true);
    assert.equal(receipt.safeErrors.sensitiveMaterialAbsentFromResult, true);
    assert.equal(receipt.oauth.noBrowserLogin, "deferred-to-real-business-qa");
    assert.doesNotMatch(receiptText, new RegExp(secretMarker));
    assert.doesNotMatch(receiptText, /access_token=/);
    assert.doesNotMatch(receiptText, /\/Users\/dmeck\/|\/home\//);
    assert.ok(receipt.commands.every(command => !Object.hasOwn(command, "output")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("official 2.1.241 calibrates all non-OAuth management commands and records its colon-name gap", async t => {
  if (!(await available(dreamPython)) || !(await available(officialCli))) {
    t.skip("official 2.1.241 comparator or Dream backend Python is unavailable");
    return;
  }
  const root = await mkdtemp(path.join(os.tmpdir(), "ink-mcp-management-official-test-"));
  try {
    const output = path.join(root, "receipt.json");
    const result = runContract({ cli: officialCli, output, mode: "reference" });
    assert.equal(result.status, 0, result.stderr);
    const receiptText = await readFile(output, "utf8");
    const receipt = JSON.parse(receiptText);
    assert.equal(receipt.status, "passed-calibration");
    assert.equal(receipt.calibrationOnly, true);
    assert.equal(Object.hasOwn(receipt, "subject"), false);
    assert.equal(receipt.runtime.version, "2.1.241");
    assert.equal(
      receipt.runtime.cliSha256,
      "1495eb7c42d3b4451f5f1cd38b6d498d22a4a38c802bc2be5c1cf1795e64820d",
    );
    assert.equal(receipt.httpUserScope.addGetListRemove, "passed");
    assert.equal(receipt.httpUserScope.colonNameSupported, false);
    assert.equal(receipt.httpUserScope.colonLifecyclePassed, false);
    assert.match(receipt.referenceObservation, /2\.1\.241 rejects colon-bearing names/);
    assert.equal(receipt.identity.operatorHomeInherited, false);
    assert.equal(receipt.identity.homePoisonExcludedFromInventoryAndConfig, true);
    assert.equal(receipt.safeErrors.sensitiveMaterialAbsentFromReceipt, true);
    assert.doesNotMatch(receiptText, new RegExp(secretMarker));
    assert.doesNotMatch(receiptText, /access_token=/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("failed candidate gates write a bounded secret-safe failure receipt", async t => {
  if (!(await available(dreamPython)) || !(await available(officialCli))) {
    t.skip("official comparator is unavailable for strict candidate rejection");
    return;
  }
  const root = await mkdtemp(path.join(os.tmpdir(), "ink-mcp-management-failure-test-"));
  try {
    const output = path.join(root, "receipt.json");
    const binding = await coreBindingFixture(root);
    const result = runContract({
      cli: officialCli,
      output,
      mode: "candidate",
      ...binding,
    });
    assert.notEqual(result.status, 0);
    const receiptText = await readFile(output, "utf8");
    const receipt = JSON.parse(receiptText);
    assert.deepEqual(receipt, {
      evidenceType: "real-process-mcp-management-contract",
      failedGate: "candidate CLI rejected a colon-bearing MCP server name",
      mode: "candidate",
      schemaVersion: 1,
      status: "failed",
    });
    assert.doesNotMatch(result.stderr + receiptText, new RegExp(secretMarker));
    assert.doesNotMatch(result.stderr + receiptText, /access_token=/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("management fixtures remain provider-free and do not implement OAuth or Agent state", async () => {
  const [fakeSource, httpSource] = await Promise.all([
    readFile(fakeCli, "utf8"),
    readFile(httpFixture, "utf8"),
  ]);
  assert.match(fakeSource, /does not implement Agent, MCP, OAuth, or Dream state machines/);
  assert.match(httpSource, /FastMCP/);
  assert.match(httpSource, /stateless_http=True/);
  assert.doesNotMatch(
    httpSource,
    /auth_server_provider\s*=|token_verifier\s*=|@server\.(?:resource|tool)\([^)]*(?:oauth|authorize|token)/i,
  );
  assert.doesNotMatch(fakeSource, /claude_agent_sdk|Dream Run|transcript|SSE/);
});
