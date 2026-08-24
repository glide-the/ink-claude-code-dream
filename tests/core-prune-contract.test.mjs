// [Input] Checked-in core-prune profile, deterministic resolution map, builder/verifier sources, and git ignore policy.
// [Output] Prove local-only ownership, Bun 1.4.0 pin, capability retention, feature separation, resolver rules, and DCE assertions.
// [Pos] Provider-free static contract test; it does not read, copy, modify, or build restored source.
// [Sync] 2026-08-24: require native four-target assets without cross-platform ripgrep mixing.

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
const qualifier = await readFile(resolve(repositoryRoot, "scripts/qualify-core-local.mjs"), "utf8");
const oauthRunner = await readFile(
  resolve(repositoryRoot, "scripts/run-core-oauth-cli-contract.mjs"),
  "utf8",
);
const packageJson = JSON.parse(await readFile(resolve(repositoryRoot, "package.json"), "utf8"));

test("core-prune build is pinned, local-only, and requires an explicit source root", () => {
  assert.equal(profile.builder.version, "1.4.0");
  assert.equal(profile.sourceVersionEvidence, "2.1.88");
  assert.equal(profile.cliCompatibilityVersion, "2.1.241");
  assert.equal(profile.defines["MACRO.VERSION"], profile.cliCompatibilityVersion);
  assert.equal(profile.outputDirectory, "dist/core-local");
  assert.equal(profile.sourceRootEnvironment, "INK_AUTHORIZED_CORE_SOURCE_ROOT");
  assert.equal(profile.packageRootEnvironment, "INK_AUTHORIZED_CORE_PACKAGE_ROOT");
  assert.equal(profile.targetEnvironment, "INK_CLAUDE_CODE_BUILD_TARGET");
  assert.deepEqual(profile.entrypoints, ["src/entrypoints/cli.tsx"]);
  assert.match(builder, /Bun\.version !== profile\.builder\.version/);
  assert.match(builder, /must be an explicit absolute path/);
  assert.match(builder, /must not traverse a symlink/);
  assert.match(builder, /git[\s\S]*check-ignore/);
  assert.match(builder, /cross-target core build is forbidden/);
  assert.doesNotMatch(builder, /claude-code-sourcemap|restored-src/);
  assert.doesNotMatch(verifier, /claude-code-sourcemap|restored-src/);
  const ignored = spawnSync("git", ["check-ignore", "-q", "dist/core-local/.probe"], {
    cwd: repositoryRoot,
  });
  assert.equal(ignored.status, 0, "dist/core-local must be ignored by git");
});

test("runtime asset matrix covers four native targets with distinct pinned ripgrep", () => {
  assert.deepEqual(Object.keys(profile.runtimeAssetTargets).sort(), [
    "darwin-arm64",
    "darwin-x64",
    "linux-arm64",
    "linux-x64",
  ]);
  const seen = new Set();
  for (const [target, assets] of Object.entries(profile.runtimeAssetTargets)) {
    assert.equal(assets.length, 1, `${target} must carry exactly one target-specific asset`);
    const asset = assets[0];
    assert.match(asset.output, new RegExp(`${target.split("-").reverse().join("-")}/rg$`));
    assert.match(asset.sha256, /^[a-f0-9]{64}$/);
    assert.equal(seen.has(asset.sha256), false, `${target} reused another platform binary`);
    seen.add(asset.sha256);
  }
  assert.deepEqual(profile.runtimeAssets.map(asset => asset.output), [
    "chunks/vendor/ripgrep/COPYING",
  ]);
  assert.match(verifier, /core receipt target does not match the verifying host/);
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

test("headless MCP login owns one listener-free manual callback path and safe stage receipt", () => {
  assert.match(builder, /\.option\('--no-browser'/);
  assert.match(builder, /const noBrowser = options\.browser === false/);
  assert.match(builder, /callbackPort: Number\(new URL\(buildRedirectUri\(\)\)\.port\)/);
  assert.match(builder, /const headlessManualOAuthTransform = \{/);
  assert.match(builder, /path: "src\/services\/mcp\/auth\.ts"/);
  assert.match(builder, /headless manual OAuth transform target digest drift/);
  assert.match(builder, /private _clientInformation\?: OAuthClientInformation/);
  assert.match(builder, /headless-manual-oauth\.clientInformationMemoField/);
  assert.match(builder, /headless-manual-oauth\.clientInformationMemoRead/);
  assert.match(builder, /headless-manual-oauth\.clientInformationMemoWrite/);
  assert.match(
    builder,
    /if \(this\._clientInformation\)[\s\S]*return this\._clientInformation[\s\S]*const storage = getSecureStorage\(\)/,
  );
  assert.match(
    builder,
    /this\._clientInformation = \{\s*client_id: clientInformation\.client_id,\s*client_secret: clientInformation\.client_secret/,
  );
  assert.match(builder, /secure-storage selector transform target digest drift/);
  assert.match(builder, /secure-storage-selector\.keychainIdentity/);
  assert.match(builder, /secure-storage-selector\.plainTextIdentity/);
  assert.match(builder, /secure-storage-selector\.deterministicActorStorage/);
  assert.match(builder, /return plainTextStorage/);
  assert.match(builder, /isAbsolute\(secureSelector\)/);
  assert.match(builder, /normalize\(secureSelector\) === secureSelector/);
  assert.match(
    builder,
    /CLAUDE_SECURESTORAGE_CONFIG_DIR must be an absolute normalized NFC path/,
  );
  assert.match(
    builder,
    /!selectedSecureDir && !process\.env\.CLAUDE_CONFIG_DIR/,
  );
  assert.match(builder, /const storageResult = storage\.update\(updatedData\)/);
  assert.match(builder, /if \(!storageResult\.success\)/);
  assert.match(
    builder,
    /if \(!savedTokens\)[\s\S]*recordInkOAuthStage\('credentials_missing'\)[\s\S]*throw new Error\('OAuth credentials unavailable after token exchange'\)/,
  );
  assert.match(builder, /token_exchange_failed_credentials_unavailable/);
  assert.doesNotMatch(builder, /_pendingSavedTokens/);
  assert.match(builder, /if \(options\?\.onWaitingForCallback\) \{/);
  assert.match(builder, /void startSdkAuth\(\)/);
  assert.match(builder, /else \{\s*server = createServer/);
  assert.match(builder, /const lifecyclePin = noBrowser \? setInterval/);
  assert.match(builder, /let callbackInput/);
  assert.match(builder, /callbackInput = createInterface/);
  assert.match(
    builder,
    /callbackInput\.once\('line', line => \{\s*recordStage\('callback_line_received'\)\s*submit\(line\.trim\(\)\)/,
  );
  assert.match(builder, /await new Promise\(resolve => process\.stdout\.write\(message, resolve\)\)/);
  assert.match(
    builder,
    /finally \{\s*callbackInput\?\.close\(\)\s*if \(noBrowser\) process\.stdin\.pause\(\)/,
  );
  assert.match(
    builder,
    /await new Promise\(resolve => process\.stderr\.write\('MCP OAuth login failed\\\\n', resolve\)\)/,
  );
  assert.doesNotMatch(builder, /forceFailureExit/);
  assert.doesNotMatch(builder, /line => \{ input\.close\(\); submit/);
  assert.match(builder, /\.ink-runtime-diagnostics/);
  assert.match(builder, /mcp-oauth-stage\.jsonl/);
  assert.match(builder, /constants\.O_NOFOLLOW/);
  assert.match(builder, /chmodSync\(diagnosticsDirectory, 0o700\)/);
  assert.match(builder, /chmodSync\(receiptPath, 0o600\)/);
  assert.match(builder, /sequence >= 16/);
  assert.match(builder, /Diagnostics are fail-safe and must never change OAuth behavior/);
  for (const stage of [
    "action_started",
    "reader_ready",
    "callback_line_received",
    "callback_validated",
    "initial_sdk_auth_started",
    "initial_sdk_auth_completed",
    "client_information_present",
    "client_information_missing",
    "code_verifier_present",
    "token_save_started",
    "token_save_completed",
    "token_save_failed",
    "token_exchange_started",
    "token_exchange_completed",
    "credentials_present",
    "credentials_missing",
    "flow_resolved",
    "success_stdout_flushed",
    "flow_failed",
    "token_exchange_failed_invalid_client",
    "token_exchange_failed_invalid_grant",
    "token_exchange_failed_invalid_request",
    "token_exchange_failed_access_denied",
    "token_exchange_failed_unsupported_grant_type",
    "token_exchange_failed_server_error",
    "token_exchange_failed_temporarily_unavailable",
    "token_exchange_failed_http_400",
    "token_exchange_failed_http_401",
    "token_exchange_failed_http_403",
    "token_exchange_failed_http_404",
    "token_exchange_failed_http_429",
    "token_exchange_failed_http_4xx",
    "token_exchange_failed_http_5xx",
    "token_exchange_failed_oauth_other",
    "token_exchange_failed_schema_access_token",
    "token_exchange_failed_schema_token_type",
    "token_exchange_failed_schema_expires_in",
    "token_exchange_failed_schema_scope",
    "token_exchange_failed_schema_refresh_token",
    "token_exchange_failed_schema_id_token",
    "token_exchange_failed_schema_other",
    "token_exchange_failed_invalid_json",
    "token_exchange_failed_network_type_error",
    "token_exchange_failed_network_timeout",
    "token_exchange_failed_runtime_unknown",
  ]) assert.match(builder, new RegExp(`['"]${stage}['"]`));
  assert.match(builder, /if \(authorizationCodeObtained\) \{/);
  assert.match(builder, /failureStage = oauthErrorCode \? oauthFailureStages\[oauthErrorCode\]/);
  assert.match(builder, /recordInkOAuthStage\(failureStage\)/);
  assert.match(builder, /errorName === 'ZodError' && Array\.isArray\(errorObject\?\.issues\)/);
  assert.match(builder, /errorName === 'SyntaxError'/);
  assert.match(builder, /errorName === 'TypeError'/);
  assert.match(builder, /errorName === 'AbortError' \|\| errorName === 'TimeoutError'/);
  assert.match(builder, /performMCPOAuthFlow\([\s\S]*loginServer/);
  assert.match(builder, /noBrowser \? \{/);
  assert.match(builder, /skipBrowserOpen: true/);
  assert.match(builder, /createInterface\(\{ input: process\.stdin, terminal: false \}\)/);
  assert.doesNotMatch(builder, /options\.noBrowser \? \{/);
});

test("full qualification requires the exact official MCP SDK OAuth process contract", () => {
  assert.equal(packageJson.scripts["test:core-oauth"], "node scripts/run-core-oauth-cli-contract.mjs");
  assert.match(qualifier, /official MCP SDK headless OAuth CLI contract/);
  assert.match(qualifier, /scripts\/run-core-oauth-cli-contract\.mjs/);
  assert.match(oauthRunner, /INK_MCP_OAUTH_FIXTURE_PYTHON: fixturePython/);
  assert.match(oauthRunner, /INK_MCP_OAUTH_FIXTURE_ROOT: fixtureRoot/);
  assert.match(oauthRunner, /must be an explicit absolute path/);
  assert.match(oauthRunner, /sdkVersion !== "2\.0\.0"/);
  assert.match(oauthRunner, /fixtureTag !== "v2\.0\.0"/);
  assert.match(oauthRunner, /INK_REQUIRE_CORE_OAUTH_FIXTURE: "1"/);
  assert.doesNotMatch(oauthRunner, /\/private\/tmp\//);
});
