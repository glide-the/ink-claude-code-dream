// [Input] Exact MCP server names and MCP tool names from discovery.
// [Output] Claude-model-safe MCP tool names with a reversible registry binding.
// [Pos] Naming boundary between exact MCP identities and the model tool namespace.
// [Sync] 2026-08-24: implement mcp__<sanitized-server>__<tool> naming.

const SAFE_TOOL_NAME = /^[A-Za-z0-9_-]+$/;

export function sanitizeMcpServerName(serverName: string): string {
  const sanitized = serverName.replace(/[^A-Za-z0-9_-]/g, "_");
  if (!sanitized) throw new Error("MCP server name has no model-safe characters");
  return sanitized;
}

export function mcpModelToolName(serverName: string, toolName: string): string {
  if (!SAFE_TOOL_NAME.test(toolName)) {
    throw new Error(`MCP tool name is not model-safe: ${toolName}`);
  }
  return `mcp__${sanitizeMcpServerName(serverName)}__${toolName}`;
}
