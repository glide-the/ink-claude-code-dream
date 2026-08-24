// [Input] Normalized MCP configs and official SDK v1 client/transports.
// [Output] Lifecycle registry, discovery inventory, calls, reads, and model tool bindings.
// [Pos] Stateful connection owner for the clean-room MCP client slice.
// [Sync] 2026-08-24: integrate headless OAuth provider, callback, logout, and auth-state transitions.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { mcpModelToolName } from "./naming.ts";
import {
  HeadlessMcpOAuthFlow,
  PersistentOAuthClientProvider,
} from "./oauth/index.ts";
import type {
  HttpMcpServerConfig,
  McpPromptDescription,
  McpRegistryEntry,
  McpResourceContents,
  McpResourceDescription,
  McpServerConfig,
  McpServerStatus,
  McpToolDescription,
  McpToolResult,
  ModelToolBinding,
  StdioMcpServerConfig,
} from "./types.ts";

interface LiveConnection {
  client: Client;
  transport: Transport;
}

interface MutableEntry extends McpRegistryEntry {
  config: McpServerConfig;
  connection?: LiveConnection;
  oauthProvider?: PersistentOAuthClientProvider;
}

export interface McpRegistryOptions {
  clientName?: string;
  clientVersion?: string;
  requestTimeoutMs?: number;
  oauthProviderFactory?: (
    serverName: string,
    config: HttpMcpServerConfig,
  ) => PersistentOAuthClientProvider | undefined;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "MCP connection failed";
}

function errorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const candidate = error as { code?: unknown; status?: unknown };
  if (typeof candidate.status === "number") return candidate.status;
  if (typeof candidate.code === "number") return candidate.code;
  return undefined;
}

function isNeedsAuth(error: unknown): boolean {
  const status = errorStatus(error);
  return error instanceof UnauthorizedError || status === 401 || status === 403;
}

function cloneEntry(entry: MutableEntry): McpRegistryEntry {
  return {
    name: entry.name,
    type: entry.type,
    status: entry.status,
    enabled: entry.enabled,
    ...(entry.error ? { error: entry.error } : {}),
    ...(entry.serverInfo ? { serverInfo: { ...entry.serverInfo } } : {}),
    tools: entry.tools.map((tool) => ({ ...tool })),
    resources: entry.resources.map((resource) => ({ ...resource })),
    prompts: entry.prompts.map((prompt) => ({ ...prompt })),
    ...(entry.oauth ? { oauth: { ...entry.oauth } } : {}),
  };
}

function makeTransport(
  config: StdioMcpServerConfig | HttpMcpServerConfig,
  oauthProvider?: PersistentOAuthClientProvider,
): Transport {
  if (config.type === "stdio") {
    return new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: { ...getDefaultEnvironment(), ...config.env },
      ...(config.cwd ? { cwd: config.cwd } : {}),
      stderr: "pipe",
    });
  }
  return new StreamableHTTPClientTransport(new URL(config.url), {
    requestInit: { headers: config.headers },
    ...(oauthProvider ? { authProvider: oauthProvider } : {}),
  });
}

export class McpAuthorizationRequiredError extends Error {
  readonly status = "needs-auth" as const;
  readonly code = "mcp_oauth_required" as const;

  constructor(serverName: string) {
    super(`MCP server ${serverName} requires authorization`);
    this.name = "McpAuthorizationRequiredError";
  }
}

export class McpRegistry {
  private readonly entries = new Map<string, MutableEntry>();
  private readonly clientName: string;
  private readonly clientVersion: string;
  private readonly requestTimeoutMs: number;
  private readonly oauthProviderFactory?: McpRegistryOptions["oauthProviderFactory"];

  constructor(configs: ReadonlyMap<string, McpServerConfig>, options: McpRegistryOptions = {}) {
    this.clientName = options.clientName ?? "ink-claude-code-dream";
    this.clientVersion = options.clientVersion ?? "0.1.0";
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.oauthProviderFactory = options.oauthProviderFactory;
    if (!Number.isSafeInteger(this.requestTimeoutMs) || this.requestTimeoutMs <= 0) {
      throw new Error("requestTimeoutMs must be a positive integer");
    }
    for (const [name, config] of configs) {
      this.entries.set(name, {
        name,
        type: config.type,
        status: config.enabled ? "pending" : "disabled",
        enabled: config.enabled,
        config,
        tools: [],
        resources: [],
        prompts: [],
      });
    }
  }

  status(serverName?: string): McpRegistryEntry[] {
    if (serverName !== undefined) return [cloneEntry(this.requireEntry(serverName))];
    return [...this.entries.values()].map(cloneEntry);
  }

  async connectAll(): Promise<McpRegistryEntry[]> {
    await Promise.all([...this.entries.keys()].map((name) => this.connect(name)));
    return this.status();
  }

  async connect(serverName: string): Promise<McpRegistryEntry> {
    const entry = this.requireEntry(serverName);
    if (!entry.enabled) return cloneEntry(entry);
    await this.closeConnection(entry);
    this.clearDiscovery(entry);
    entry.status = "pending";
    delete entry.error;
    delete entry.oauth;

    if (entry.config.requiresOAuth) {
      if (entry.config.type !== "http") {
        entry.status = "failed";
        entry.error = "OAuth is supported only for Streamable HTTP MCP servers";
        return cloneEntry(entry);
      }
      entry.oauthProvider ??= this.oauthProviderFactory?.(entry.name, entry.config);
      if (!entry.oauthProvider) {
        entry.status = "needs-auth";
        entry.error = "MCP authorization is required";
        return cloneEntry(entry);
      }
    }
    if (entry.config.type === "unsupported") {
      entry.status = "failed";
      entry.error = `unsupported MCP transport: ${entry.config.transport}`;
      return cloneEntry(entry);
    }

    const client = new Client(
      { name: this.clientName, version: this.clientVersion },
      { capabilities: {} },
    );
    const transport = makeTransport(entry.config, entry.oauthProvider);
    entry.connection = { client, transport };
    try {
      await client.connect(transport, { timeout: this.requestTimeoutMs });
      await this.discover(entry);
      entry.status = "connected";
      return cloneEntry(entry);
    } catch (error) {
      entry.status = isNeedsAuth(error) ? "needs-auth" : "failed";
      entry.error = entry.status === "needs-auth"
        ? "MCP authorization is required"
        : errorMessage(error);
      const pending = entry.oauthProvider?.takePendingAuthorization();
      if (pending) entry.oauth = pending;
      await this.closeConnection(entry);
      return cloneEntry(entry);
    }
  }

  async finishAuth(
    serverName: string,
    callback: { code: string; state: string },
  ): Promise<McpRegistryEntry> {
    const entry = this.requireEntry(serverName);
    if (entry.config.type !== "http" || !entry.oauthProvider) {
      throw new Error(`MCP server ${serverName} has no configured OAuth provider`);
    }
    const result = await new HeadlessMcpOAuthFlow({
      serverUrl: entry.config.url,
      provider: entry.oauthProvider,
    }).completeCallback(callback);
    if (!result.ok) {
      entry.status = "needs-auth";
      entry.error = result.message;
      return cloneEntry(entry);
    }
    delete entry.oauth;
    delete entry.error;
    return this.connect(serverName);
  }

  async logoutOAuth(serverName: string): Promise<McpRegistryEntry> {
    const entry = this.requireEntry(serverName);
    if (!entry.oauthProvider) {
      throw new Error(`MCP server ${serverName} has no configured OAuth provider`);
    }
    await new HeadlessMcpOAuthFlow({
      serverUrl: (entry.config as HttpMcpServerConfig).url,
      provider: entry.oauthProvider,
    }).logout();
    await this.closeConnection(entry);
    this.clearDiscovery(entry);
    delete entry.oauth;
    entry.status = entry.enabled ? "needs-auth" : "disabled";
    entry.error = entry.enabled ? "MCP authorization is required" : undefined;
    return cloneEntry(entry);
  }

  async toggle(serverName: string, enabled: boolean): Promise<McpRegistryEntry> {
    const entry = this.requireEntry(serverName);
    entry.enabled = enabled;
    entry.config.enabled = enabled;
    if (!enabled) {
      await this.closeConnection(entry);
      this.clearDiscovery(entry);
      entry.status = "disabled";
      delete entry.error;
      delete entry.oauth;
      return cloneEntry(entry);
    }
    return this.connect(serverName);
  }

  async reconnect(serverName: string): Promise<McpRegistryEntry> {
    const entry = this.requireEntry(serverName);
    if (!entry.enabled) return cloneEntry(entry);
    return this.connect(serverName);
  }

  modelTools(): ModelToolBinding[] {
    const bindings: ModelToolBinding[] = [];
    const names = new Set<string>();
    for (const entry of this.entries.values()) {
      if (entry.status !== "connected") continue;
      for (const tool of entry.tools) {
        const name = mcpModelToolName(entry.name, tool.name);
        if (names.has(name)) throw new Error(`duplicate model MCP tool name: ${name}`);
        names.add(name);
        bindings.push({
          name,
          serverName: entry.name,
          mcpToolName: tool.name,
          description: tool.description ?? `MCP tool ${tool.name} from ${entry.name}`,
          input_schema: { ...tool.inputSchema },
        });
      }
    }
    return bindings;
  }

  async callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown> = {},
  ): Promise<McpToolResult> {
    const entry = this.requireConnected(serverName);
    try {
      const result = await entry.connection!.client.callTool(
        { name: toolName, arguments: args },
        undefined,
        { timeout: this.requestTimeoutMs },
      );
      return result as McpToolResult;
    } catch (error) {
      await this.transitionAuthFailure(entry, error);
      throw error;
    }
  }

  async callModelTool(
    modelToolName: string,
    args: Record<string, unknown> = {},
  ): Promise<McpToolResult> {
    const binding = this.modelTools().find((tool) => tool.name === modelToolName);
    if (!binding) throw new Error(`unknown MCP model tool: ${modelToolName}`);
    return this.callTool(binding.serverName, binding.mcpToolName, args);
  }

  listResources(serverName?: string): Array<McpResourceDescription & { server: string }> {
    const selected = serverName === undefined
      ? [...this.entries.values()].filter((entry) => entry.status === "connected")
      : [this.requireConnected(serverName)];
    return selected.flatMap((entry) =>
      entry.resources.map((resource) => ({ ...resource, server: entry.name })),
    );
  }

  async readResource(serverName: string, uri: string): Promise<McpResourceContents> {
    const entry = this.requireConnected(serverName);
    try {
      const result = await entry.connection!.client.readResource(
        { uri },
        { timeout: this.requestTimeoutMs },
      );
      return result as McpResourceContents;
    } catch (error) {
      await this.transitionAuthFailure(entry, error);
      throw error;
    }
  }

  async close(): Promise<void> {
    await Promise.all([...this.entries.values()].map((entry) => this.closeConnection(entry)));
  }

  private requireEntry(serverName: string): MutableEntry {
    const entry = this.entries.get(serverName);
    if (!entry) throw new Error(`unknown MCP server: ${serverName}`);
    return entry;
  }

  private requireConnected(serverName: string): MutableEntry {
    const entry = this.requireEntry(serverName);
    if (entry.status !== "connected" || !entry.connection) {
      throw new Error(`MCP server ${serverName} is not connected (status: ${entry.status})`);
    }
    return entry;
  }

  private clearDiscovery(entry: MutableEntry): void {
    entry.tools = [];
    entry.resources = [];
    entry.prompts = [];
    delete entry.serverInfo;
  }

  private async closeConnection(entry: MutableEntry): Promise<void> {
    const connection = entry.connection;
    delete entry.connection;
    if (!connection) return;
    try {
      await connection.client.close();
    } catch {
      try {
        await connection.transport.close();
      } catch {
        // Closing is best effort; the next explicit state transition remains authoritative.
      }
    }
  }

  private async transitionAuthFailure(entry: MutableEntry, error: unknown): Promise<void> {
    if (!isNeedsAuth(error)) return;
    entry.status = "needs-auth";
    entry.error = "MCP authorization is required";
    const pending = entry.oauthProvider?.takePendingAuthorization();
    if (pending) entry.oauth = pending;
    this.clearDiscovery(entry);
    await this.closeConnection(entry);
    throw new McpAuthorizationRequiredError(entry.name);
  }

  private async discover(entry: MutableEntry): Promise<void> {
    const client = entry.connection!.client;
    const capabilities = client.getServerCapabilities() ?? {};
    const serverInfo = client.getServerVersion();
    if (serverInfo) entry.serverInfo = { ...serverInfo };

    if (capabilities.tools) {
      let cursor: string | undefined;
      do {
        const page = await client.listTools(
          cursor ? { cursor } : undefined,
          { timeout: this.requestTimeoutMs },
        );
        entry.tools.push(...(page.tools as McpToolDescription[]));
        cursor = page.nextCursor;
      } while (cursor);
    }
    if (capabilities.resources) {
      let cursor: string | undefined;
      do {
        const page = await client.listResources(
          cursor ? { cursor } : undefined,
          { timeout: this.requestTimeoutMs },
        );
        entry.resources.push(...(page.resources as McpResourceDescription[]));
        cursor = page.nextCursor;
      } while (cursor);
    }
    if (capabilities.prompts) {
      let cursor: string | undefined;
      do {
        const page = await client.listPrompts(
          cursor ? { cursor } : undefined,
          { timeout: this.requestTimeoutMs },
        );
        entry.prompts.push(...(page.prompts as McpPromptDescription[]));
        cursor = page.nextCursor;
      } while (cursor);
    }
  }
}

export function isMcpServerStatus(value: string): value is McpServerStatus {
  return ["connected", "failed", "pending", "disabled", "needs-auth"].includes(value);
}
