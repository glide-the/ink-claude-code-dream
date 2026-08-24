// [Input] An in-memory registry or public MCP management argv with explicit process identity.
// [Output] Registry lifecycle results or Dream-compatible MCP CLI completion codes.
// [Pos] Stable management API boundary for Agent control frames and the outer CLI.
// [Sync] 2026-08-24: expose registry controls and the private user-scope management CLI wire.

import type { McpRegistryEntry } from "./types.ts";
import { McpRegistry } from "./registry.ts";
export {
  runMcpManagementCli,
  type McpManagementCliOptions,
} from "./management-cli/index.ts";

export function mcp_status(
  registry: McpRegistry,
  serverName?: string,
): McpRegistryEntry[] {
  return registry.status(serverName);
}

export function mcp_toggle(
  registry: McpRegistry,
  serverName: string,
  enabled: boolean,
): Promise<McpRegistryEntry> {
  return registry.toggle(serverName, enabled);
}

export function mcp_reconnect(
  registry: McpRegistry,
  serverName: string,
): Promise<McpRegistryEntry> {
  return registry.reconnect(serverName);
}
