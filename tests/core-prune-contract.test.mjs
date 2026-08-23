// [Input] Checked-in core-prune profile, deterministic resolution map, builder/verifier sources, and git ignore policy.
// [Output] Prove local-only ownership, Bun 1.4.0 pin, capability retention, feature separation, resolver rules, and DCE assertions.
// [Pos] Provider-free static contract test; it does not read, copy, modify, or build restored source.
// [Sync] 2026-08-24: require independent source provenance and Dream-facing CLI compatibility versions.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const repositoryRoot = resolve(import.meta.dirname, "..");
const profile = JSON.parse(
  await readFile(resolve(repositoryRoot, "runtime/core-prune-profile.json"), "utf8"),
);
const resolutionMap = JSON.parse(
  await readFile(resolve(repositoryRoot, "runtime/core-resolution-map.json"), "utf8"),
);
const builder = await readFile(resolve(repositoryRoot, "scripts/build-core-prune.ts"), "utf8");
const verifier = await readFile(resolve(repositoryRoot, "scripts/verify-core-prune.mjs"), "utf8");

test("core-prune build is pinned, local-only, and requires an explicit source root", () => {
  assert.equal(profile.builder.version, "1.4.0");
  assert.equal(profile.sourceVersionEvidence, "2.1.88");
  assert.equal(profile.cliCompatibilityVersion, "2.1.241");
  assert.equal(profile.defines["MACRO.VERSION"], profile.cliCompatibilityVersion);
  assert.equal(profile.outputDirectory, "dist/core-local");
  assert.equal(profile.sourceRootEnvironment, "INK_AUTHORIZED_CORE_SOURCE_ROOT");
  assert.equal(profile.packageRootEnvironment, "INK_AUTHORIZED_CORE_PACKAGE_ROOT");
  assert.deepEqual(profile.entrypoints, ["src/entrypoints/cli.tsx"]);
  assert.match(builder, /Bun\.version !== profile\.builder\.version/);
  assert.match(builder, /must be an explicit absolute path/);
  assert.match(builder, /must not traverse a symlink/);
  assert.match(builder, /git[\s\S]*check-ignore/);
  assert.doesNotMatch(builder, /claude-code-sourcemap|restored-src/);
  assert.doesNotMatch(verifier, /claude-code-sourcemap|restored-src/);
  const ignored = spawnSync("git", ["check-ignore", "-q", "dist/core-local/.probe"], {
    cwd: repositoryRoot,
  });
  assert.equal(ignored.status, 0, "dist/core-local must be ignored by git");
});

test("required Dream capability roots remain explicit", () => {
  assert.deepEqual(
    new Set(profile.requiredCapabilities),
    new Set([
      "sdk.stream-json-jsonl",
      "sdk.bidirectional-control",
      "session.transcript-resume",
      "tools.permissions",
      "workspace.cwd",
      "sandbox",
      "tmpdir.CLAUDE_CODE_TMPDIR",
      "mcp.stdio-http-oauth-resources",
      "extensions.plugins-skills-hooks",
      "subagents.agent-task",
      "attachments.images",
      "authentication.gateway",
    ]),
  );
  assert.deepEqual(
    Object.keys(profile.capabilityInputAssertions).sort(),
    [...profile.requiredCapabilities].sort(),
  );
  for (const inputs of Object.values(profile.capabilityInputAssertions)) {
    assert.ok(inputs.length > 0);
  }
  assert.match(profile.featureDisposition.FORK_SUBAGENT, /ordinary Agent and Task/);
  assert.deepEqual(profile.capabilityInputAssertions["subagents.agent-task"], [
    "src/tools/AgentTool/AgentTool.tsx",
    "src/tools/AgentTool/runAgent.ts",
    "src/tools/TaskCreateTool/TaskCreateTool.ts",
    "src/tools/TaskUpdateTool/TaskUpdateTool.ts",
  ]);
  assert.deepEqual(profile.capabilityInputAssertions["attachments.images"], [
    "src/utils/attachments.ts",
    "src/utils/imageValidation.ts",
    "src/utils/imageResizer.ts",
  ]);
  assert.match(profile.featureDisposition.MCP_SKILLS, /ordinary filesystem\/plugin skills/);
  assert.match(profile.featureDisposition.HOOK_PROMPTS, /hook execution remains required/);
});

test("feature profile is closed and DCE asserts absent bootstrap branches", () => {
  assert.deepEqual(profile.features.enabled, ["IS_LIBC_GLIBC"]);
  assert.ok(profile.features.disabled.includes("IS_LIBC_MUSL"));
  assert.equal(
    profile.features.enabled.some(feature => profile.features.disabled.includes(feature)),
    false,
  );
  for (const feature of [
    "DAEMON",
    "BG_SESSIONS",
    "TEMPLATES",
    "BYOC_ENVIRONMENT_RUNNER",
    "SELF_HOSTED_RUNNER",
    "BRIDGE_MODE",
  ]) {
    assert.ok(profile.features.disabled.includes(feature), `${feature} must be disabled`);
  }
  for (const suffix of [
    "src/services/analytics/firstPartyEventLogger.ts",
    "src/services/analytics/growthbook.ts",
    "src/services/lsp/manager.ts",
    "src/services/policyLimits/index.ts",
    "src/services/remoteManagedSettings/index.ts",
    "src/utils/telemetry/instrumentation.ts",
  ]) {
    assert.ok(profile.dceAssertions.forbiddenInputSuffixes.includes(suffix));
  }
  for (const specifier of [
    "@grpc/grpc-js",
    "@grpc/proto-loader",
    "@opentelemetry/exporter-logs-otlp-grpc",
    "@opentelemetry/exporter-metrics-otlp-grpc",
    "@opentelemetry/exporter-trace-otlp-grpc",
  ]) {
    assert.ok(profile.dceAssertions.forbiddenResolutionSpecifiers.includes(specifier));
  }
  assert.match(builder, /features: profile\.features\.enabled/);
  assert.match(builder, /resolver reached disabled import/);
});

test("headless transforms are source-bound and keep only print plus version entry paths", () => {
  const transformByPath = new Map(
    profile.sourceTransforms.map(({ path, transform }) => [path, transform]),
  );
  for (const [path, transform] of [
    ["src/entrypoints/cli.tsx", "headless-cli-entry-v1"],
    ["src/main.tsx", "headless-main-v1"],
    ["src/commands.ts", "headless-commands-v1"],
    ["src/entrypoints/init.ts", "headless-runtime-ui-v1"],
    ["src/services/api/claude.ts", "headless-provider-v1"],
    ["src/services/api/withRetry.ts", "headless-closure-v1"],
    ["src/tools/AgentTool/AgentTool.tsx", "headless-agent-tool-v1"],
    ["src/tools/FileReadTool/imageProcessor.ts", "headless-closure-v1"],
  ]) {
    assert.equal(transformByPath.get(path), transform);
  }
  for (const transform of profile.sourceTransforms) {
    assert.match(transform.sha256, /^[a-f0-9]{64}$/);
    assert.ok(transform.reason.length > 20);
  }
  assert.match(builder, /source transform target digest drift/);
  assert.match(builder, /marker must occur exactly once/);
  assert.match(builder, /source transform produced invalid syntax/);
  assert.match(builder, /accepts only print, authenticated Python SDK stream-json, or MCP management mode/);
  assert.match(builder, /const hasPrintFlag = true/);
  assert.match(builder, /const isNonInteractiveSession = true/);
  assert.match(builder, /management registration below is unreachable/);
  assert.match(builder, /runMcpManagement/);
  assert.match(builder, /headless-agent-tool-v1\.renderProperties/);
  for (const suffix of [
    "src/screens/REPL.tsx",
    "src/ink/ink.tsx",
    "src/dialogLaunchers.tsx",
    "src/commands/ide/ide.tsx",
    "src/commands/feedback/feedback.tsx",
    "src/cli/update.ts",
    "src/bridge/bridgeUI.ts",
    "src/components/teams/TeamsDialog.tsx",
  ]) {
    assert.ok(profile.dceAssertions.forbiddenInputSuffixes.includes(suffix));
  }
  for (const prefix of [
    "src/bridge/",
    "src/cli/transports/",
    "src/utils/teleport/",
    "src/utils/swarm/",
    "src/utils/teammate",
    "src/services/teamMemorySync/",
    "src/tools/TaskOutputTool/",
    "src/tools/TaskStopTool/",
    "src/services/lsp/",
    "node_modules/@ant/claude-for-chrome-mcp/",
    "src/services/settingsSync/",
  ]) assert.ok(profile.dceAssertions.forbiddenInputPrefixes.includes(prefix));
  assert.deepEqual(profile.dceAssertions.forbiddenOutputSubstrings, [
    "forwardMessagesToBridge", "bridgeHandle", "remote_control", "initReplBridge",
  ]);
  assert.match(builder, /metafile included forbidden prefix/);
  assert.match(verifier, /forbidden output substring survived/);
});

test("resolution map has deterministic exact and longest-prefix rules", () => {
  assert.equal(resolutionMap.schemaVersion, "ink-core-resolution-map/v1");
  assert.equal(resolutionMap.exact["@commander-js/extra-typings"], "node_modules/@commander-js/extra-typings/esm.mjs");
  assert.equal(resolutionMap.prefix["lodash-es/"], "node_modules/lodash-es/");
  for (const target of [
    ...Object.values(resolutionMap.exact),
    ...Object.values(resolutionMap.prefix),
  ]) {
    assert.equal(target.startsWith("/"), false);
    assert.equal(target.split("/").includes(".."), false);
  }
  assert.match(builder, /right\.length - left\.length/);
  assert.match(builder, /missing-map-target/);
  assert.match(builder, /unmapped-bare/);
  assert.match(builder, /`\$\{base\}\.json`/);
  assert.match(builder, /join\(base, "index\.json"\)/);
  assert.deepEqual(Object.keys(resolutionMap.virtualFacades), [
    "@anthropic-ai/mcpb",
    "@inquirer/prompts",
    "diff",
    "lodash-es",
  ]);
  assert.deepEqual(Object.keys(resolutionMap.virtualFacades["lodash-es"].exports).sort(), [
    "cloneDeep",
    "isEqual",
    "memoize",
  ]);
  assert.deepEqual(Object.keys(resolutionMap.virtualFacades["@anthropic-ai/mcpb"].exports).sort(), [
    "McpbManifestSchema",
    "getMcpConfigForManifest",
  ]);
  assert.deepEqual(Object.keys(resolutionMap.virtualFacades["@inquirer/prompts"].exports).sort(), [
    "confirm",
    "input",
    "select",
  ]);
  assert.deepEqual(Object.keys(resolutionMap.virtualFacades.diff.exports).sort(), [
    "createPatch",
    "diffArrays",
    "diffLines",
    "diffWordsWithSpace",
    "structuredPatch",
  ]);
  assert.deepEqual(profile.emptyModuleAllowlist, []);
  assert.match(builder, /virtual facade target digest drift/);
  assert.match(builder, /empty module importer digest drift/);
});

test("MCP compatibility, runtime facades, and dependency roots are executable and fail closed", () => {
  assert.equal(profile.mcpCompatibility.artifactKind, "headless");
  assert.deepEqual(profile.mcpCompatibility.requiredTransformIds, [
    "client-transient-5xx-surface-v1",
    "disabled-central-inventory-v1",
    "headers-helper-launch-policy-v1",
    "print-headless-control-reconnect-v1",
    "sdk-set-mcp-servers-reconcile-retry-v1",
    "stdio-initialize-before-discovery-v1",
  ]);
  assert.doesNotMatch(
    profile.mcpCompatibility.requiredTransformIds.join("\n"),
    /useManage|mcp\.tsx|interactive/i,
  );
  assert.match(builder, /applyMcpCompatibilityTransforms/);
  assert.match(builder, /MCP_COMPATIBILITY_VIRTUAL_MODULE_RESOLUTIONS/);
  assert.match(builder, /profile MCP compatibility IDs must match the executable headless transform set/);

  for (const [name, dependency] of Object.entries(resolutionMap.dependencyRoots)) {
    assert.match(dependency.version, /^\d/);
    assert.match(dependency.packageJsonSha256, /^[a-f0-9]{64}$/);
    assert.match(dependency.licenseSha256, /^[a-f0-9]{64}$/);
    assert.match(dependency.treeSha256, /^[a-f0-9]{64}$/);
    assert.equal(dependency.root, `node_modules/${name}`);
  }
  assert.equal(resolutionMap.dependencyRoots.sharp.version, "0.34.5");
  assert.equal(resolutionMap.dependencyRoots["@grpc/grpc-js"].fallbackOnly, true);
  assert.equal(resolutionMap.dependencyTransforms.length, 2);
  const runtimeFacades = new Set(Object.keys(resolutionMap.runtimeFacades));
  for (const facade of [
      "first-party-event-logging-disabled",
      "growthbook-disabled",
      "lsp-disabled",
      "policy-limits-disabled",
      "remote-managed-settings-disabled",
      "repository-detection-disabled",
      "telemetry-disabled",
      "mcp-management-entry",
      "teammate-disabled",
      "remote-settings-sync-disabled",
      "claude-chrome-setup-disabled",
    ]) assert.ok(runtimeFacades.has(facade));
  assert.match(builder, /dependency tree digest drift/);
  assert.match(builder, /runtime facade target digest drift/);
});
