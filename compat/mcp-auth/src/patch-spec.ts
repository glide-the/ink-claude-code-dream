// [Input] Exact restored-source text plus hash-bound MCP compatibility transform definitions.
// [Output] Fail-closed in-memory source transforms, assertion receipts, and stable helper-module wiring.
// [Pos] Executable clean-room patch boundary; it never reads, writes, or executes restored source itself.

import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

export const MCP_COMPATIBILITY_VIRTUAL_MODULE_IDS = {
  headersPolicy: "ink:mcp-auth/headers-helper-policy",
  reconnectPolicy: "ink:mcp-auth/reconnect-policy",
  redaction: "ink:mcp-auth/redaction",
} as const;

export const MCP_COMPATIBILITY_VIRTUAL_MODULE_RESOLUTIONS = {
  [MCP_COMPATIBILITY_VIRTUAL_MODULE_IDS.headersPolicy]: fileURLToPath(
    new URL("./headers-helper-policy.ts", import.meta.url),
  ),
  [MCP_COMPATIBILITY_VIRTUAL_MODULE_IDS.reconnectPolicy]: fileURLToPath(
    new URL("./reconnect-policy.ts", import.meta.url),
  ),
  [MCP_COMPATIBILITY_VIRTUAL_MODULE_IDS.redaction]: fileURLToPath(
    new URL("./redaction.ts", import.meta.url),
  ),
} as const;

export function resolveMcpCompatibilityVirtualModule(id: string): string | undefined {
  return MCP_COMPATIBILITY_VIRTUAL_MODULE_RESOLUTIONS[
    id as keyof typeof MCP_COMPATIBILITY_VIRTUAL_MODULE_RESOLUTIONS
  ];
}

export interface SourceAssertion {
  id: string;
  contains: string;
  occurrenceCount: number;
}

export type McpCompatibilityTransformStrategy =
  | "compose-helper"
  | "enforce-ordering"
  | "assert-existing-contract"
  | "guard-before-connect"
  | "wrap-existing-entrypoint";

export interface McpCompatibilityTransformDefinition {
  id: string;
  targetPath: string;
  sourceSha256: string;
  strategy: McpCompatibilityTransformStrategy;
  boundarySymbol: string;
  helperExports: readonly string[];
  sourceAssertions: readonly SourceAssertion[];
  postconditions: readonly string[];
  artifactReachability: "headless" | "interactive-only";
  mutatesSource: boolean;
}

export interface AppliedSourceAssertion extends SourceAssertion {
  actualOccurrenceCount: number;
}

export interface McpCompatibilityTransformResult {
  contents: string;
  appliedIds: string[];
  assertions: AppliedSourceAssertion[];
}

export const MCP_COMPATIBILITY_TRANSFORMS = [
  {
    id: "headers-helper-launch-policy-v1",
    targetPath: "src/services/mcp/headersHelper.ts",
    sourceSha256: "1929f72cf719af79f6c112f16ea676a23f04a40e30c127ef0fed86821a17733b",
    strategy: "compose-helper",
    boundarySymbol: "getMcpHeadersFromHelper",
    helperExports: ["buildHeadersHelperLaunchPolicy", "redactSensitiveText"],
    sourceAssertions: [
      {
        id: "headers-helper-entrypoint",
        contains: "export async function getMcpHeadersFromHelper(",
        occurrenceCount: 1,
      },
      {
        id: "credential-env-spread-gap",
        contains: "...process.env,",
        occurrenceCount: 1,
      },
      {
        id: "helper-spawn-boundary",
        contains: "execFileNoThrowWithCwd(config.headersHelper, [], {",
        occurrenceCount: 1,
      },
    ],
    postconditions: [
      "The existing helper spawn consumes only buildHeadersHelperLaunchPolicy output.",
      "Project/local scopes require an accepted trust receipt and use the explicit origin cwd.",
      "User/managed/claudeai scopes use the Claude config cwd; all other scopes fail closed.",
      "Diagnostics pass through redaction without changing functional header values.",
    ],
    artifactReachability: "headless",
    mutatesSource: true,
  },
  {
    id: "stdio-initialize-before-discovery-v1",
    targetPath: "src/services/mcp/client.ts",
    sourceSha256: "787bba952e1f37dead67afab114b4ee71f66c95e8dba4559afa55679b113b8d2",
    strategy: "enforce-ordering",
    boundarySymbol: "connectToServer",
    helperExports: [],
    sourceAssertions: [
      {
        id: "connect-entrypoint",
        contains: "export const connectToServer = memoize(",
        occurrenceCount: 1,
      },
      {
        id: "client-connect-anchor",
        contains: "const connectPromise = client.connect(transport)",
        occurrenceCount: 1,
      },
      {
        id: "stdio-transport-branch",
        contains: "} else if (serverRef.type === 'stdio' || !serverRef.type) {",
        occurrenceCount: 1,
      },
    ],
    postconditions: [
      "For stdio, initialize and notifications/initialized complete before any server/discover request.",
      "The existing Client, transport, timeout, and connection-state ownership remain unchanged.",
    ],
    artifactReachability: "headless",
    mutatesSource: true,
  },
  {
    id: "client-transient-5xx-surface-v1",
    targetPath: "src/services/mcp/client.ts",
    sourceSha256: "787bba952e1f37dead67afab114b4ee71f66c95e8dba4559afa55679b113b8d2",
    strategy: "compose-helper",
    boundarySymbol: "connectToServer",
    helperExports: ["classifyReconnectFailure", "runWithReconnectRetry"],
    sourceAssertions: [
      {
        id: "connection-failure-return",
        contains: "error: errorMessage(error),",
        occurrenceCount: 1,
      },
      {
        id: "reconnect-connect-call",
        contains: "const client = await connectToServer(name, config)",
        occurrenceCount: 1,
      },
      {
        id: "connection-cache-key-export",
        contains: "export function getServerCacheKey(",
        occurrenceCount: 1,
      },
    ],
    postconditions: [
      "Remote 5xx failures escape connectToServer after its memoized cache entry is cleared.",
      "reconnectMcpServerImpl retries only through runWithReconnectRetry and retains its result/state shape.",
      "401/403 and other 4xx failures keep the existing non-retry result path.",
    ],
    artifactReachability: "headless",
    mutatesSource: true,
  },
  {
    id: "disabled-central-inventory-v1",
    targetPath: "src/services/mcp/client.ts",
    sourceSha256: "787bba952e1f37dead67afab114b4ee71f66c95e8dba4559afa55679b113b8d2",
    strategy: "assert-existing-contract",
    boundarySymbol: "getMcpToolsCommandsAndResources",
    helperExports: [],
    sourceAssertions: [
      {
        id: "central-inventory-entrypoint",
        contains: "export async function getMcpToolsCommandsAndResources(",
        occurrenceCount: 1,
      },
      {
        id: "disabled-partition",
        contains: "// Partition into disabled and active entries — disabled servers should",
        occurrenceCount: 1,
      },
      {
        id: "disabled-inventory-record",
        contains: "client: { name: entry[0], type: 'disabled', config: entry[1] },",
        occurrenceCount: 1,
      },
    ],
    postconditions: [
      "Disabled servers remain visible in the central inventory with empty tools and commands.",
      "Disabled servers never enter local or remote connection batches.",
    ],
    artifactReachability: "headless",
    mutatesSource: false,
  },
  {
    id: "mcp-list-get-disabled-guard-v1",
    targetPath: "src/cli/handlers/mcp.tsx",
    sourceSha256: "694aa1a5dea2fbad368290290eecbb90a72e5398058c9f3cfd0e5b932f014859",
    strategy: "guard-before-connect",
    boundarySymbol: "checkMcpServerHealth",
    helperExports: [],
    sourceAssertions: [
      {
        id: "health-connect-gap",
        contains: "const result = await connectToServer(name, server);",
        occurrenceCount: 1,
      },
      {
        id: "list-health-gap",
        contains: "status: await checkMcpServerHealth(name, server)",
        occurrenceCount: 1,
      },
      {
        id: "get-health-gap",
        contains: "const status = await checkMcpServerHealth(name, server);",
        occurrenceCount: 1,
      },
    ],
    postconditions: [
      "mcp list and mcp get render disabled servers as disabled without calling connectToServer.",
      "Enabled-server health checks retain the existing concurrency and shutdown behavior.",
    ],
    artifactReachability: "interactive-only",
    mutatesSource: true,
  },
  {
    id: "print-headless-control-reconnect-v1",
    targetPath: "src/cli/print.ts",
    sourceSha256: "77bb8bed6ebe3e5fbc3c6521dcddab479af8ce9e3df82b2a103c27bf14cc573d",
    strategy: "wrap-existing-entrypoint",
    boundarySymbol: "mcp_reconnect",
    helperExports: ["redactSensitiveText"],
    sourceAssertions: [
      {
        id: "headless-reconnect-handler",
        contains: "} else if (message.request.subtype === 'mcp_reconnect') {",
        occurrenceCount: 1,
      },
      {
        id: "headless-reconnect-call",
        contains: "const result = await reconnectMcpServerImpl(serverName, config)",
        occurrenceCount: 3,
      },
      {
        id: "dynamic-state-update",
        contains: "dynamicMcpState = {",
        occurrenceCount: 2,
      },
    ],
    postconditions: [
      "The existing headless reconnect call remains owned by reconnectMcpServerImpl in the transformed client.",
      "Control-protocol failure text is redacted through the stable clean-room helper import.",
      "The existing appState and dynamicMcpState update paths remain the sole state owners.",
    ],
    artifactReachability: "headless",
    mutatesSource: true,
  },
  {
    id: "sdk-set-mcp-servers-reconcile-retry-v1",
    targetPath: "src/cli/print.ts",
    sourceSha256: "77bb8bed6ebe3e5fbc3c6521dcddab479af8ce9e3df82b2a103c27bf14cc573d",
    strategy: "wrap-existing-entrypoint",
    boundarySymbol: "reconcileMcpServers",
    helperExports: ["runWithReconnectRetry", "classifyReconnectFailure", "redactSensitiveText"],
    sourceAssertions: [
      {
        id: "set-servers-reconcile-call",
        contains: "const processResult = await reconcileMcpServers(",
        occurrenceCount: 1,
      },
      {
        id: "reconcile-entrypoint",
        contains: "export async function reconcileMcpServers(",
        occurrenceCount: 1,
      },
      {
        id: "reconcile-connect-gap",
        contains: "const client = await connectToServer(name, scopedConfig)",
        occurrenceCount: 1,
      },
    ],
    postconditions: [
      "The existing reconcileMcpServers add/replace loop remains the sole SDK setMcpServers state owner.",
      "The connectToServer add/replace boundary retries numeric-code 5xx with a bounded budget.",
      "401/403 and other 4xx failures remain terminal and preserve the existing errors response path.",
      "A successful retry continues through the existing tool fetch, added list, newState, and AppState update.",
      "Failure diagnostics and returned error text are redacted.",
    ],
    artifactReachability: "headless",
    mutatesSource: true,
  },
  {
    id: "managed-reconnect-backoff-v1",
    targetPath: "src/services/mcp/useManageMCPConnections.ts",
    sourceSha256: "2536c13da7f1a19ff272d58d0d9d1616433bdcdc57546d17d2c352911e12175b",
    strategy: "compose-helper",
    boundarySymbol: "useManageMCPConnections",
    helperExports: ["classifyReconnectFailure", "computeReconnectBackoffMs"],
    sourceAssertions: [
      {
        id: "manager-entrypoint",
        contains: "export function useManageMCPConnections(",
        occurrenceCount: 1,
      },
      {
        id: "existing-reconnect-entrypoint",
        contains: "const result = await reconnectMcpServerImpl(",
        occurrenceCount: 3,
      },
      {
        id: "existing-reconnect-budget",
        contains: "MAX_RECONNECT_ATTEMPTS",
        occurrenceCount: 7,
      },
    ],
    postconditions: [
      "The existing reconnect timer/state orchestration remains intact.",
      "Retry classification and delay calculation come from the clean-room helpers.",
      "Retry attempts remain bounded and cancellation still clears existing timers.",
    ],
    artifactReachability: "interactive-only",
    mutatesSource: true,
  },
] as const satisfies readonly McpCompatibilityTransformDefinition[];

export function assertSourceAssertions(
  source: string,
  assertions: readonly SourceAssertion[],
  label = "source",
): void {
  evaluateSourceAssertions(source, assertions, label);
}

export function applyMcpCompatibilityTransforms(
  path: string,
  source: string,
  options: { transformIds?: readonly string[] } = {},
): McpCompatibilityTransformResult {
  const selectedIds = options.transformIds ? new Set(options.transformIds) : undefined;
  const definitions = MCP_COMPATIBILITY_TRANSFORMS.filter(
    definition => definition.targetPath === path && (!selectedIds || selectedIds.has(definition.id)),
  );
  if (definitions.length === 0) {
    return { contents: source, appliedIds: [], assertions: [] };
  }

  const actualSha256 = createHash("sha256").update(source).digest("hex");
  for (const definition of definitions) {
    if (actualSha256 !== definition.sourceSha256) {
      throw new Error(`${path}:${definition.id} source sha256 mismatch`);
    }
  }

  const assertions = definitions.flatMap(definition =>
    evaluateSourceAssertions(source, definition.sourceAssertions, `${path}:${definition.id}`),
  );
  let contents = source;
  for (const definition of definitions) {
    contents = applyTransformDefinition(definition.id, contents);
    assertTransformPostconditions(definition.id, contents);
  }
  return {
    contents,
    appliedIds: definitions.map(definition => definition.id),
    assertions,
  };
}

export function getMcpCompatibilityTransformsForArtifact(
  artifactKind: "headless" | "interactive-full",
): readonly McpCompatibilityTransformDefinition[] {
  return artifactKind === "headless"
    ? MCP_COMPATIBILITY_TRANSFORMS.filter(
        definition => definition.artifactReachability === "headless",
      )
    : MCP_COMPATIBILITY_TRANSFORMS;
}

function evaluateSourceAssertions(
  source: string,
  assertions: readonly SourceAssertion[],
  label: string,
): AppliedSourceAssertion[] {
  const results: AppliedSourceAssertion[] = [];
  for (const assertion of assertions) {
    if (!assertion.contains || !Number.isSafeInteger(assertion.occurrenceCount) || assertion.occurrenceCount < 1) {
      throw new Error(`${label}:${assertion.id} has an invalid assertion definition`);
    }
    const actual = countOccurrences(source, assertion.contains);
    if (actual !== assertion.occurrenceCount) {
      throw new Error(
        `${label}:${assertion.id} expected ${assertion.occurrenceCount} exact occurrence(s), found ${actual}`,
      );
    }
    results.push({ ...assertion, actualOccurrenceCount: actual });
  }
  return results;
}

function countOccurrences(source: string, needle: string): number {
  let count = 0;
  let offset = 0;
  while (offset <= source.length) {
    const index = source.indexOf(needle, offset);
    if (index === -1) return count;
    count += 1;
    offset = index + needle.length;
  }
  return count;
}

function applyTransformDefinition(id: string, source: string): string {
  switch (id) {
    case "headers-helper-launch-policy-v1":
      return transformHeadersHelper(source);
    case "stdio-initialize-before-discovery-v1":
      return transformClientInitializeOrdering(source);
    case "client-transient-5xx-surface-v1":
      return transformClientTransientReconnect(source);
    case "disabled-central-inventory-v1":
      return source;
    case "mcp-list-get-disabled-guard-v1":
      return transformMcpListGet(source);
    case "print-headless-control-reconnect-v1":
      return transformPrintControlReconnect(source);
    case "sdk-set-mcp-servers-reconcile-retry-v1":
      return transformPrintSetServers(source);
    case "managed-reconnect-backoff-v1":
      return transformManagedReconnect(source);
    default:
      throw new Error(`unknown MCP compatibility transform: ${id}`);
  }
}

function transformHeadersHelper(source: string): string {
  let transformed = replaceExactOnce(
    source,
    "import { getIsNonInteractiveSession } from '../../bootstrap/state.js'",
    `import { getOriginalCwd } from '../../bootstrap/state.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { buildHeadersHelperLaunchPolicy } from '${MCP_COMPATIBILITY_VIRTUAL_MODULE_IDS.headersPolicy}'
import { redactSensitiveText } from '${MCP_COMPATIBILITY_VIRTUAL_MODULE_IDS.redaction}'`,
    "headers-helper imports",
  );
  transformed = replaceExactOnce(
    transformed,
    "import { logAntError } from '../../utils/debug.js'\n",
    "",
    "headers-helper obsolete diagnostic import",
  );
  transformed = replaceExactOnce(
    transformed,
    "import { logEvent } from '../analytics/index.js'\n",
    "",
    "headers-helper obsolete analytics import",
  );

  const policyBlock = `  let launchPolicy
  try {
    launchPolicy = buildHeadersHelperLaunchPolicy({
      scope:
        'scope' in config
          ? (config as ScopedMcpServerConfig).scope
          : 'unknown',
      serverName,
      serverUrl: config.url,
      inheritedEnv: process.env,
      claudeConfigDir: getClaudeConfigHomeDir(),
      originDir: getOriginalCwd(),
      trust: { workspaceAccepted: checkHasTrustDialogAccepted() },
    })
  } catch (error) {
    logMCPError(
      serverName,
      \`Headers helper launch denied: \${redactSensitiveText(errorMessage(error))}\`,
    )
    return null
  }

`;
  transformed = replaceExactSpan(
    transformed,
    "  // Security check for project/local settings",
    "  try {\n    logMCPDebug",
    `${policyBlock}  try {\n    logMCPDebug`,
    "headers-helper trust block",
  );
  transformed = replaceExactOnce(
    transformed,
    `      env: {
        ...process.env,
        CLAUDE_CODE_MCP_SERVER_NAME: serverName,
        CLAUDE_CODE_MCP_SERVER_URL: config.url,
      },`,
    `      cwd: launchPolicy.cwd,
      env: launchPolicy.env,`,
    "headers-helper spawn policy",
  );
  return transformed.replaceAll(
    "errorMessage(error)}",
    "redactSensitiveText(errorMessage(error))}",
  );
}

function transformClientInitializeOrdering(source: string): string {
  let transformed = prependImport(
    source,
    `import { connectWithInitializeOrdering } from '${MCP_COMPATIBILITY_VIRTUAL_MODULE_IDS.reconnectPolicy}'`,
  );
  transformed = replaceExactOnce(
    transformed,
    "const connectPromise = client.connect(transport)",
    "const connectPromise = connectWithInitializeOrdering(() => client.connect(transport))",
    "client initialize ordering",
  );
  return transformed;
}

function transformClientTransientReconnect(source: string): string {
  let transformed = replaceExactOnce(
    source,
    `import { connectWithInitializeOrdering } from '${MCP_COMPATIBILITY_VIRTUAL_MODULE_IDS.reconnectPolicy}'`,
    `import {
  classifyReconnectFailure,
  connectWithInitializeOrdering,
  runWithReconnectRetry,
} from '${MCP_COMPATIBILITY_VIRTUAL_MODULE_IDS.reconnectPolicy}'`,
    "client reconnect policy imports",
  );
  transformed = replaceExactOnce(
    transformed,
    `      if (inProcessServer) {
        inProcessServer.close().catch(() => {})
      }
      return {
        name,
        type: 'failed' as const,`,
    `      if (inProcessServer) {
        inProcessServer.close().catch(() => {})
      }
      const reconnectFailure = classifyReconnectFailure(error)
      if (
        (serverRef.type === 'http' ||
          serverRef.type === 'sse' ||
          serverRef.type === 'claudeai-proxy') &&
        reconnectFailure.kind === 'server' &&
        reconnectFailure.retryable
      ) {
        connectToServer.cache.delete(getServerCacheKey(name, serverRef))
        throw error
      }
      return {
        name,
        type: 'failed' as const,`,
    "client transient failure surface",
  );
  transformed = replaceExactOnce(
    transformed,
    "const client = await connectToServer(name, config)",
    `const client = await runWithReconnectRetry(() =>
      connectToServer(name, config),
    )`,
    "client reconnect retry composition",
  );
  return transformed;
}

function transformMcpListGet(source: string): string {
  let transformed = replaceExactOnce(
    source,
    "import { addMcpConfig, getAllMcpConfigs, getMcpConfigByName, getMcpConfigsByScope, removeMcpConfig } from '../../services/mcp/config.js';",
    "import { addMcpConfig, getAllMcpConfigs, getMcpConfigByName, getMcpConfigsByScope, isMcpServerDisabled, removeMcpConfig } from '../../services/mcp/config.js';",
    "mcp handler disabled import",
  );
  transformed = replaceExactOnce(
    transformed,
    "async function checkMcpServerHealth(name: string, server: ScopedMcpServerConfig): Promise<string> {\n  try {",
    "async function checkMcpServerHealth(name: string, server: ScopedMcpServerConfig): Promise<string> {\n  if (isMcpServerDisabled(name)) return '⊘ Disabled';\n  try {",
    "mcp handler disabled guard",
  );
  return transformed;
}

function transformPrintControlReconnect(source: string): string {
  let transformed = prependImportAfter(
    source,
    "// biome-ignore-all assist/source/organizeImports: ANT-ONLY import markers must not be reordered\n",
    `import { redactSensitiveText } from '${MCP_COMPATIBILITY_VIRTUAL_MODULE_IDS.redaction}'`,
    "print redaction import",
  );
  const start = transformed.indexOf("} else if (message.request.subtype === 'mcp_reconnect') {");
  const end = transformed.indexOf("} else if (message.request.subtype === 'mcp_toggle') {", start);
  if (start === -1 || end === -1) throw new Error("print mcp_reconnect block markers changed");
  const block = transformed.slice(start, end);
  const patchedBlock = replaceExactOnce(
    block,
    "sendControlResponseError(message, errorMessage)",
    "sendControlResponseError(message, redactSensitiveText(errorMessage))",
    "print reconnect redaction",
  );
  return transformed.slice(0, start) + patchedBlock + transformed.slice(end);
}

function transformPrintSetServers(source: string): string {
  let transformed = replaceExactOnce(
    source,
    `import { redactSensitiveText } from '${MCP_COMPATIBILITY_VIRTUAL_MODULE_IDS.redaction}'`,
    `import { runWithReconnectRetry } from '${MCP_COMPATIBILITY_VIRTUAL_MODULE_IDS.reconnectPolicy}'
import { redactSensitiveText } from '${MCP_COMPATIBILITY_VIRTUAL_MODULE_IDS.redaction}'`,
    "print retry import",
  );
  transformed = replaceExactOnce(
    transformed,
    "const client = await connectToServer(name, scopedConfig)",
    `const client = await runWithReconnectRetry(() =>
        connectToServer(name, scopedConfig),
      )`,
    "print reconcile retry",
  );
  return transformed;
}

function transformManagedReconnect(source: string): string {
  let transformed = prependImport(
    source,
    `import { computeReconnectBackoffMs } from '${MCP_COMPATIBILITY_VIRTUAL_MODULE_IDS.reconnectPolicy}'`,
  );
  transformed = replaceExactOnce(
    transformed,
    `const backoffMs = Math.min(
                    INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1),
                    MAX_BACKOFF_MS,
                  )`,
    `const backoffMs = computeReconnectBackoffMs(attempt, {
                    maxAttempts: MAX_RECONNECT_ATTEMPTS,
                    initialDelayMs: INITIAL_BACKOFF_MS,
                    maxDelayMs: MAX_BACKOFF_MS,
                    multiplier: 2,
                  })`,
    "managed reconnect backoff",
  );
  return transformed;
}

function assertTransformPostconditions(id: string, source: string): void {
  const mustContain = (marker: string) => {
    if (!source.includes(marker)) throw new Error(`${id} postcondition missing: ${marker}`);
  };
  const mustNotContain = (marker: string) => {
    if (source.includes(marker)) throw new Error(`${id} old marker survived: ${marker}`);
  };
  switch (id) {
    case "headers-helper-launch-policy-v1":
      mustContain("cwd: launchPolicy.cwd");
      mustContain("env: launchPolicy.env");
      mustNotContain("...process.env,");
      break;
    case "stdio-initialize-before-discovery-v1":
      mustContain("connectWithInitializeOrdering(() => client.connect(transport))");
      mustNotContain("const connectPromise = client.connect(transport)");
      if (source.indexOf("connectWithInitializeOrdering(() => client.connect(transport))") > source.indexOf("client.getServerCapabilities()")) {
        throw new Error(`${id} initialize boundary moved after capability discovery`);
      }
      break;
    case "client-transient-5xx-surface-v1":
      mustContain("reconnectFailure.kind === 'server'");
      mustContain("connectToServer.cache.delete(getServerCacheKey(name, serverRef))");
      mustContain("runWithReconnectRetry(() =>");
      break;
    case "disabled-central-inventory-v1":
      mustContain("type: 'disabled'");
      break;
    case "mcp-list-get-disabled-guard-v1":
      mustContain("if (isMcpServerDisabled(name)) return '⊘ Disabled';");
      if (source.indexOf("if (isMcpServerDisabled(name)) return '⊘ Disabled';") > source.indexOf("connectToServer(name, server)")) {
        throw new Error(`${id} disabled guard moved after connection`);
      }
      break;
    case "print-headless-control-reconnect-v1":
      mustContain("sendControlResponseError(message, redactSensitiveText(errorMessage))");
      break;
    case "sdk-set-mcp-servers-reconcile-retry-v1":
      mustContain("runWithReconnectRetry(() =>");
      mustNotContain("const client = await connectToServer(name, scopedConfig)");
      break;
    case "managed-reconnect-backoff-v1":
      mustContain("computeReconnectBackoffMs(attempt");
      mustNotContain("INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1)");
      break;
  }
}

function replaceExactOnce(
  source: string,
  marker: string,
  replacement: string,
  label: string,
): string {
  const occurrences = countOccurrences(source, marker);
  if (occurrences !== 1) {
    throw new Error(`${label} expected one exact marker, found ${occurrences}`);
  }
  return source.replace(marker, replacement);
}

function replaceExactSpan(
  source: string,
  startMarker: string,
  endMarker: string,
  replacement: string,
  label: string,
): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start === -1 || end === -1 || source.indexOf(startMarker, start + 1) !== -1) {
    throw new Error(`${label} exact span markers changed`);
  }
  return source.slice(0, start) + replacement + source.slice(end + endMarker.length);
}

function prependImport(source: string, statement: string): string {
  if (source.includes(statement)) throw new Error(`virtual import already present: ${statement}`);
  return `${statement}\n${source}`;
}

function prependImportAfter(
  source: string,
  marker: string,
  statement: string,
  label: string,
): string {
  return replaceExactOnce(source, marker, `${marker}${statement}\n`, label);
}
