// [Input] Clean-room MCP configuration, registry, management, naming, and built-in modules.
// [Output] Stable public API for provider-free MCP integration.
// [Pos] Public export surface for the clean-room MCP client slice.
// [Sync] 2026-08-24: expose headless OAuth, registry lifecycle, and Dream management CLI APIs.

import { parseMcpConfigArgv } from "./config.ts";
import { McpRegistry, type McpRegistryOptions } from "./registry.ts";
import {
  createUserOAuthContext,
  UserMcpStateStore,
} from "./management-cli/index.ts";
import type { PersistentOAuthClientProvider } from "./oauth/provider.ts";

export { ListMcpResourcesTool, ReadMcpResourceTool } from "./builtin-tools.ts";
export { parseMcpConfig, parseMcpConfigArgv } from "./config.ts";
export {
  mcp_reconnect,
  mcp_status,
  mcp_toggle,
  runMcpManagementCli,
  type McpManagementCliOptions,
} from "./management.ts";
export { mcpModelToolName, sanitizeMcpServerName } from "./naming.ts";
export { isMcpServerStatus, McpAuthorizationRequiredError, McpRegistry } from "./registry.ts";
export * from "./oauth/index.ts";
export type * from "./types.ts";

export async function createMcpRegistryFromArgv(
  argv: string[],
  options: McpRegistryOptions & {
    cwd?: string;
    projectedOAuthIdentity?: {
      configDir: string;
      redirectUrl: string;
    };
  } = {},
): Promise<McpRegistry> {
  const { cwd, projectedOAuthIdentity, ...registryOptions } = options;
  const configs = await parseMcpConfigArgv(argv, cwd);
  if (projectedOAuthIdentity) {
    if (registryOptions.oauthProviderFactory) {
      throw new Error("MCP OAuth provider configuration is ambiguous");
    }
    const store = await UserMcpStateStore.open(projectedOAuthIdentity.configDir);
    const providers = new Map<string, PersistentOAuthClientProvider>();
    for (const [serverName, config] of configs) {
      if (config.type !== "http" || !config.requiresOAuth) continue;
      const context = await createUserOAuthContext({
        store,
        serverName,
        serverUrl: config.url,
        redirectUrl: projectedOAuthIdentity.redirectUrl,
      });
      providers.set(serverName, context.provider);
    }
    registryOptions.oauthProviderFactory = (serverName) => providers.get(serverName);
  }
  return new McpRegistry(configs, registryOptions);
}
