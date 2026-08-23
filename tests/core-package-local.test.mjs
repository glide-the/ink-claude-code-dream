// [Input] Synthetic zero-gap core bundles/receipts and local artifact package/verify scripts.
// [Output] Prove reproducibility, qualification gating/binding, Bun wrapper behavior, tamper detection, and user/source material exclusion.
// [Pos] Provider-free local artifact contract tests; fixtures contain no restored/vendor implementation or Dream business state.
// [Sync] 2026-08-24: assert packaged source provenance and qualified CLI compatibility version remain distinct.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageScript = path.join(repositoryRoot, "scripts", "package-core-local.mjs");
const verifyScript = path.join(repositoryRoot, "scripts", "verify-core-package-local.mjs");
const artifactId = "ink-claude-code-dream-0.1.0";
const sourceDigest = "4".repeat(64);

function digest(body) {
  return createHash("sha256").update(body).digest("hex");
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "ink-core-package-local-test-"));
  const inputRoot = path.join(root, "core-local");
  const outputRoot = path.join(root, "packages");
  const bundleRoot = path.join(inputRoot, "bundle");
  await mkdir(path.join(bundleRoot, "chunks"), { recursive: true });
  const cli = "process.stdout.write(JSON.stringify({runtime:'fixture'}) + '\\n');\n";
  await writeFile(path.join(bundleRoot, "cli.js"), cli);
  await writeFile(path.join(bundleRoot, "chunks", "shared-fixture.js"), "export const fixture = true;\n");
  const capabilitiesTemplate = JSON.parse(
    await readFile(path.join(repositoryRoot, "runtime", "local-capabilities.json"), "utf8"),
  );
  const requiredCapabilities = capabilitiesTemplate.requiredCapabilities.map(capability => capability.id);
  const capabilityInputAssertions = Object.fromEntries(
    requiredCapabilities.map(capability => [capability, [`fixture/${capability}.ts`]]),
  );
  const requiredTransformIds = [
    "client-transient-5xx-surface-v1",
    "disabled-central-inventory-v1",
    "headers-helper-launch-policy-v1",
    "print-headless-control-reconnect-v1",
    "sdk-set-mcp-servers-reconcile-retry-v1",
    "stdio-initialize-before-discovery-v1",
  ];
  const receipt = {
    schemaVersion: "ink-core-prune-build/v1",
    status: "built",
    sourceVersionEvidence: "2.1.88",
    cliCompatibilityVersion: "2.1.241",
    sourceDigest: { algorithm: "sha256", digest: sourceDigest, fileCount: 10, bytes: 1000 },
    builder: { runtime: "bun", version: "1.4.0", target: "bun", format: "esm" },
    requiredCapabilities,
    capabilityInputAssertions,
    dependencyRoots: {
      protobufjs: {
        version: "7.5.4",
        license: "BSD-3-Clause",
        treeSha256: "1".repeat(64),
        fallbackOnly: false,
      },
      "zod-to-json-schema": {
        version: "3.25.2",
        license: "ISC",
        treeSha256: "2".repeat(64),
        fallbackOnly: false,
      },
      zod: {
        version: "4.0.0",
        license: "MIT",
        treeSha256: "3".repeat(64),
        fallbackOnly: true,
      },
    },
    mcpCompatibility: {
      artifactKind: "headless",
      requiredTransformIds,
      appliedTransformIds: [...requiredTransformIds],
      assertions: [{ id: "fixture", actualOccurrenceCount: 1 }],
    },
    dceAssertions: { status: "passed", violations: [] },
    resolution: { edgeGapCount: 0, uniqueGapCount: 0 },
    build: { success: true, outputCount: 2, logs: [], thrown: null },
  };
  const gaps = {
    schemaVersion: "ink-core-resolution-gaps/v1",
    edgeCount: 0,
    uniqueGapCount: 0,
    uniqueGaps: [],
    gaps: [],
  };
  await writeFile(path.join(inputRoot, "build-receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
  await writeFile(path.join(inputRoot, "resolution-gaps.json"), `${JSON.stringify(gaps, null, 2)}\n`);
  return {
    root,
    inputRoot,
    outputRoot,
    receipt,
    gaps,
    coreDigest: digest(Buffer.from(cli)),
    artifactRoot: path.join(outputRoot, artifactId),
  };
}

function runPackage(context, extra = [], environment = {}) {
  return spawnSync(
    process.execPath,
    [packageScript, "--input-root", context.inputRoot, "--output-root", context.outputRoot, ...extra],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: { ...process.env, SOURCE_DATE_EPOCH: "1787443200", ...environment },
    },
  );
}

function runVerify(packageRoot) {
  return spawnSync(process.execPath, [verifyScript, "--package-root", packageRoot], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
}

async function runDreamManifestGate(executable) {
  const dreamRoot = path.resolve(
    process.env.INK_DREAM_ROOT ?? path.join(repositoryRoot, "..", "ink-dream-memory"),
  );
  const backendRoot = path.join(dreamRoot, "backend");
  const python = path.join(backendRoot, ".venv", "bin", "python");
  try {
    await access(path.join(backendRoot, "libs", "claude_agent_kit", "server", "sdk_env.py"));
    await access(python);
  } catch {
    return null;
  }
  const program = [
    "import json",
    "import sys",
    "from pathlib import Path",
    "backend = Path(sys.argv[1]).resolve()",
    "sys.path.insert(0, str(backend))",
    "import tests._sdk_stubs",
    "from libs.claude_agent_kit.server.sdk_env import require_dream_claude_runtime_manifest",
    "from claude_mcp.identity import _cli_has_secure_storage_marker",
    "executable = Path(sys.argv[2])",
    "marker = _cli_has_secure_storage_marker(str(executable))",
    "manifest = require_dream_claude_runtime_manifest(executable)",
    "print(json.dumps({'manifest': str(manifest), 'secureStorageMarker': marker}, sort_keys=True))",
  ].join("\n");
  return spawnSync(python, ["-c", program, backendRoot, executable], {
    cwd: backendRoot,
    encoding: "utf8",
  });
}

async function artifactEntries(root) {
  const entries = [];
  async function visit(directory) {
    const children = await import("node:fs/promises").then(fs => fs.readdir(directory, { withFileTypes: true }));
    for (const child of children) {
      const absolute = path.join(directory, child.name);
      if (child.isDirectory()) await visit(absolute);
      else {
        const body = await readFile(absolute);
        entries.push([path.relative(root, absolute), digest(body), body.length]);
      }
    }
  }
  await visit(root);
  return entries.sort(([left], [right]) => left.localeCompare(right));
}

async function writeQualification(context, id, evidenceType, overrides = {}) {
  const file = path.join(context.root, `${id}-qualification.json`);
  const receipt = {
    schemaVersion: 1,
    status: "passed",
    evidenceType,
    subject: {
      runtime: "ink-claude-code-dream",
      version: "0.1.0",
      coreBundleSha256: context.coreDigest,
      sourceDigest,
    },
    ...overrides,
  };
  if (id === "full" && !Object.hasOwn(overrides, "management")) {
    receipt.inputs = { mcpManagementReceiptSha256: "7".repeat(64) };
    receipt.management = {
      evidenceType: "real-process-mcp-management-contract",
      status: "passed",
      mcpManagementIdentityQualified: true,
    };
  }
  await writeFile(file, `${JSON.stringify(receipt, null, 2)}\n`);
  return file;
}

test("packages a reproducible local candidate with closed production/publication gates", async () => {
  const context = await fixture();
  try {
    const result = runPackage(context);
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout.trim());
    assert.equal(output.productionEligible, false);
    assert.equal(output.publicationAllowed, false);
    assert.equal(output.redistributionAllowed, false);
    assert.equal(output.reproduciblePasses, 2);

    const verification = runVerify(context.artifactRoot);
    assert.equal(verification.status, 0, verification.stderr);
    const qualification = JSON.parse(
      await readFile(path.join(context.artifactRoot, "manifest", "qualification-summary.json"), "utf8"),
    );
    assert.deepEqual(
      Object.fromEntries(Object.entries(qualification.gates).map(([id, value]) => [id, value.status])),
      { sdk: "missing", mcp: "missing", full: "missing" },
    );
    assert.equal(qualification.productionEligible, false);
    const release = JSON.parse(
      await readFile(path.join(context.artifactRoot, "release-manifest.json"), "utf8"),
    );
    assert.equal(release.schemaVersion, "ink-claude-cli-envelope/v1");
    assert.equal(release.core.corePruned, true);
    assert.equal(release.core.sourceVersionEvidence, "2.1.88");
    assert.equal(release.core.cliCompatibilityVersion, "2.1.241");
    assert.equal(release.core.productionEligible, false);
    assert.equal(release.capabilityEvidence, "manifest/capabilities.json");
    const reproducibility = JSON.parse(
      await readFile(path.join(context.artifactRoot, "manifest", "reproducible-build.json"), "utf8"),
    );
    assert.equal(reproducibility.byteIdentical, true);
    assert.equal(reproducibility.passCount, 2);
    assert.equal(reproducibility.generatedAt, "2026-08-23T00:00:00.000Z");
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test("Dream's real production manifest gate rejects an unqualified artifact and accepts a fully qualified one", async t => {
  const context = await fixture();
  try {
    const unqualified = runPackage(context);
    assert.equal(unqualified.status, 0, unqualified.stderr);
    const executable = path.join(context.artifactRoot, "bin", "ink-claude-code-dream");
    const rejected = await runDreamManifestGate(executable);
    if (rejected === null) {
      t.skip("sibling Dream backend or its Python environment is unavailable");
      return;
    }
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /not production-qualified/);

    const sdk = await writeQualification(context, "sdk", "real-process-sdk-differential");
    const mcp = await writeQualification(context, "mcp", "real-process-mcp-differential");
    const full = await writeQualification(context, "full", "full-runtime-qualification");
    const qualified = runPackage(context, [
      "--sdk-receipt",
      sdk,
      "--mcp-receipt",
      mcp,
      "--full-receipt",
      full,
    ]);
    assert.equal(qualified.status, 0, qualified.stderr);
    const accepted = await runDreamManifestGate(executable);
    assert.equal(accepted.status, 0, accepted.stderr);
    const dreamReceipt = JSON.parse(accepted.stdout.trim());
    assert.equal(
      dreamReceipt.manifest,
      await realpath(path.join(context.artifactRoot, "release-manifest.json")),
    );
    assert.equal(dreamReceipt.secureStorageMarker, true);
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test("all three digest-bound qualification receipts are required for production eligibility", async () => {
  const context = await fixture();
  try {
    const sdk = await writeQualification(context, "sdk", "real-process-sdk-differential");
    const mcp = await writeQualification(context, "mcp", "real-process-mcp-differential");
    const full = await writeQualification(context, "full", "full-runtime-qualification");
    const result = runPackage(context, [
      "--sdk-receipt",
      sdk,
      "--mcp-receipt",
      mcp,
      "--full-receipt",
      full,
    ]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout.trim()).productionEligible, true);
    const qualification = JSON.parse(
      await readFile(path.join(context.artifactRoot, "manifest", "qualification-summary.json"), "utf8"),
    );
    assert.equal(qualification.productionEligible, true);
    assert.deepEqual(
      ["sdk", "mcp", "full"].map(id => qualification.gates[id].status),
      ["passed", "passed", "passed"],
    );
    const artifactText = (await artifactEntries(context.artifactRoot)).map(entry => entry[0]).join("\n");
    assert.doesNotMatch(artifactText, /(?:sdk|mcp|full)-qualification\.json/);
    assert.equal(runVerify(context.artifactRoot).status, 0);
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test("qualification evidence bound to another bundle is rejected", async () => {
  const context = await fixture();
  try {
    const sdk = await writeQualification(context, "sdk", "real-process-sdk-differential", {
      subject: {
        runtime: "ink-claude-code-dream",
        version: "0.1.0",
        coreBundleSha256: "9".repeat(64),
        sourceDigest,
      },
    });
    const result = runPackage(context, ["--sdk-receipt", sdk]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /not bound to this core bundle\/source/);
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test("full qualification without digest-bound MCP management evidence is rejected", async () => {
  const context = await fixture();
  try {
    const sdk = await writeQualification(context, "sdk", "real-process-sdk-differential");
    const mcp = await writeQualification(context, "mcp", "real-process-mcp-differential");
    const full = await writeQualification(
      context,
      "full",
      "full-runtime-qualification",
      { management: null },
    );
    const result = runPackage(context, [
      "--sdk-receipt",
      sdk,
      "--mcp-receipt",
      mcp,
      "--full-receipt",
      full,
    ]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /lacks bound passing MCP management evidence/);
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test("blocked, non-zero-gap, or partially applied MCP core receipts fail closed", async () => {
  for (const mutation of [
    receipt => {
      receipt.status = "blocked";
      receipt.build.success = false;
    },
    receipt => {
      receipt.resolution.edgeGapCount = 1;
    },
    receipt => {
      receipt.mcpCompatibility.appliedTransformIds.pop();
    },
  ]) {
    const context = await fixture();
    try {
      mutation(context.receipt);
      await writeFile(
        path.join(context.inputRoot, "build-receipt.json"),
        `${JSON.stringify(context.receipt, null, 2)}\n`,
      );
      const result = runPackage(context);
      assert.notEqual(result.status, 0);
    } finally {
      await rm(context.root, { recursive: true, force: true });
    }
  }
});

test("source maps, restored source files, mutable Runtime paths, and secret material are excluded", async () => {
  const additions = [
    ["debug.map", "{}\n", /source\/source-map material is forbidden/],
    ["implementation.ts", "export {};\n", /source\/source-map material is forbidden/],
    ["workspace/content.json", "{}\n", /mutable\/user Runtime data path is forbidden/],
    ["secret.js", `export const value = "sk-ant-${"x".repeat(32)}";\n`, /sensitive\/source-root material found/],
  ];
  for (const [relative, body, expected] of additions) {
    const context = await fixture();
    try {
      const target = path.join(context.inputRoot, "bundle", relative);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, body);
      const result = runPackage(context);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, expected);
    } finally {
      await rm(context.root, { recursive: true, force: true });
    }
  }
});

test("the wrapper enforces Bun 1.4.0 and verifier detects post-package tampering", async () => {
  const context = await fixture();
  try {
    const result = runPackage(context);
    assert.equal(result.status, 0, result.stderr);
    const fakeBun = path.join(context.root, "fake-bun.sh");
    await writeFile(
      fakeBun,
      '#!/bin/sh\nif [ "$1" = "--version" ]; then echo 1.4.0; exit 0; fi\nprintf "fake-bun:%s\\n" "$*"\n',
    );
    await chmod(fakeBun, 0o755);
    const wrapper = path.join(context.artifactRoot, "bin", "ink-claude-code-dream");
    const wrapperResult = spawnSync(wrapper, ["--version"], {
      encoding: "utf8",
      env: { ...process.env, INK_CLAUDE_CODE_BUN_PATH: fakeBun },
    });
    assert.equal(wrapperResult.status, 0, wrapperResult.stderr);
    assert.match(wrapperResult.stdout, /fake-bun:.*lib\/core\/cli\.js --version/);

    await writeFile(path.join(context.artifactRoot, "lib", "core", "cli.js"), "tampered\n");
    const verification = runVerify(context.artifactRoot);
    assert.notEqual(verification.status, 0);
    assert.match(verification.stderr, /qualification subject|release identity|artifact manifest|checksum mismatch/);
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test("independent package runs with the same epoch are byte-identical", async () => {
  const context = await fixture();
  try {
    const first = runPackage(context);
    assert.equal(first.status, 0, first.stderr);
    const firstEntries = await artifactEntries(context.artifactRoot);
    const secondOutput = path.join(context.root, "packages-second");
    const second = runPackage({ ...context, outputRoot: secondOutput });
    assert.equal(second.status, 0, second.stderr);
    const secondEntries = await artifactEntries(path.join(secondOutput, artifactId));
    assert.deepEqual(secondEntries, firstEntries);
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});
