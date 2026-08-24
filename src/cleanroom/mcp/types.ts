// [Input] Untrusted mcpServers JSON and official MCP SDK discovery/call results.
// [Output] Normalized configuration and immutable public registry/model-tool shapes.
// [Pos] Shared type contract for the clean-room MCP client slice.
// [Sync] 2026-08-24: add headless OAuth authorization state to registry snapshots.

export type McpServerStatus =
  | "connected"
  | "failed"
  | "pending"
  | "disabled"
  | "needs-auth";

interface McpServerConfigBase {
  enabled: boolean;
  requiresOAuth: boolean;
}

export interface StdioMcpServerConfig extends McpServerConfigBase {
  type: "stdio";
  command: string;
  args: string[];
  cwd?: string;
  env: Record<string, string>;
}

export interface HttpMcpServerConfig extends McpServerConfigBase {
  type: "http";
  url: string;
  headers: Record<string, string>;
}

export interface UnsupportedMcpServerConfig extends McpServerConfigBase {
  type: "unsupported";
  transport: string;
}

export type McpServerConfig =
  | StdioMcpServerConfig
  | HttpMcpServerConfig
  | UnsupportedMcpServerConfig;

export interface McpToolDescription {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown> & { type: "object" };
  [key: string]: unknown;
}

export interface McpResourceDescription {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
  [key: string]: unknown;
}

export interface McpPromptDescription {
  name: string;
  description?: string;
  [key: string]: unknown;
}

export interface McpRegistryEntry {
  name: string;
  type: McpServerConfig["type"];
  status: McpServerStatus;
  enabled: boolean;
  error?: string;
  serverInfo?: { name: string; version: string; [key: string]: unknown };
  tools: McpToolDescription[];
  resources: McpResourceDescription[];
  prompts: McpPromptDescription[];
  oauth?: {
    authorizationUrl: string;
    state: string;
  };
}

export interface ModelToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface ModelToolBinding extends ModelToolDefinition {
  serverName: string;
  mcpToolName: string;
}

export interface McpToolResult {
  content?: unknown[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  [key: string]: unknown;
}

export interface McpResourceContents {
  contents: Array<
    | { uri: string; text: string; mimeType?: string; [key: string]: unknown }
    | { uri: string; blob: string; mimeType?: string; [key: string]: unknown }
  >;
  [key: string]: unknown;
}
