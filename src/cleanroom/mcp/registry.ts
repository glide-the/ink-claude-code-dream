// [Input] Normalized MCP configs and official SDK v1 client/transports.
// [Output] Lifecycle registry, discovery inventory, calls, reads, and model tool bindings.
// [Pos] Stateful connection owner for the clean-room MCP client slice.
// [Sync] 2026-08-25: make one anonymous-first classifier authoritative for every caller.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { FetchLike, Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { mcpModelToolName } from "./naming.ts";
import {
  HeadlessMcpOAuthFlow,
  PersistentOAuthClientProvider,
} from "./oauth/index.ts";
import type {
  HttpMcpServerConfig,
  McpAuthenticationState,
  McpFailureCode,
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

interface HttpObservation {
  serverUrl: string;
  sawUnauthorized: boolean;
  discoveryAttempted: boolean;
  networkFailed: boolean;
}

interface MutableEntry extends McpRegistryEntry {
  config: McpServerConfig;
  connection?: LiveConnection;
  oauthProvider?: PersistentOAuthClientProvider;
  httpObservation?: HttpObservation;
}

export interface McpRegistryOptions {
  clientName?: string;
  clientVersion?: string;
  requestTimeoutMs?: number;
  httpFetch?: FetchLike;
  oauthProviderFactory?: (
    serverName: string,
    config: HttpMcpServerConfig,
  ) => PersistentOAuthClientProvider | undefined;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

function errorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const candidate = error as { code?: unknown; status?: unknown };
  if (typeof candidate.status === "number") return candidate.status;
  if (typeof candidate.code === "number") return candidate.code;
  return undefined;
}

interface FailureClassification {
  status: Extract<McpServerStatus, "needs-auth" | "failed">;
  authentication: McpAuthenticationState;
  failureCode: McpFailureCode;
  message: string;
}

function isTimeout(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { name?: unknown; message?: unknown; code?: unknown };
  return candidate.name === "AbortError" || candidate.name === "TimeoutError" ||
    candidate.code === "ETIMEDOUT" ||
    (typeof candidate.message === "string" && /timed?\s*out|timeout/iu.test(candidate.message));
}

function classifyFailure(
  error: unknown,
  observation?: HttpObservation,
): FailureClassification {
  const status = errorStatus(error);
  if (error instanceof UnauthorizedError || status === 401) {
    return {
      status: "needs-auth",
      authentication: "required",
      failureCode: "mcp_auth_required",
      message: "MCP authorization is required",
    };
  }
  if (status === 403) {
    return {
      status: "failed",
      authentication: "unknown",
      failureCode: "mcp_forbidden",
      message: "MCP server rejected the request",
    };
  }
  if (status === 404) {
    return {
      status: "failed",
      authentication: "unknown",
      failureCode: "mcp_endpoint_not_found",
      message: "MCP endpoint was not found",
    };
  }
  if (isTimeout(error)) {
    return {
      status: "failed",
      authentication: "unknown",
      failureCode: "mcp_timeout",
      message: "MCP request timed out",
    };
  }
  if (observation?.networkFailed) {
    return {
      status: "failed",
      authentication: "unknown",
      failureCode: "mcp_network_error",
      message: "MCP network request failed",
    };
  }
  if (observation?.sawUnauthorized && observation.discoveryAttempted) {
    return {
      status: "failed",
      authentication: "unknown",
      failureCode: "mcp_auth_metadata_invalid",
      message: "MCP authorization metadata is invalid",
    };
  }
  if (error instanceof TypeError || (error && typeof error === "object" &&
    typeof (error as { code?: unknown }).code === "string")) {
    return {
      status: "failed",
      authentication: "unknown",
      failureCode: "mcp_network_error",
      message: "MCP network request failed",
    };
  }
  return {
    status: "failed",
    authentication: "unknown",
    failureCode: "mcp_server_rejected",
    message: "MCP server request failed",
  };
}

function cloneEntry(entry: MutableEntry): McpRegistryEntry {
  return {
    name: entry.name,
    type: entry.type,
    status: entry.status,
    authentication: entry.authentication,
    enabled: entry.enabled,
    ...(entry.error ? { error: entry.error } : {}),
    ...(entry.failureCode ? { failureCode: entry.failureCode } : {}),
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
  httpFetch?: FetchLike,
  observation?: HttpObservation,
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
  const fetchWithObservation: FetchLike = async (input, init) => {
    const requestUrl = input instanceof Request ? input.url : String(input);
    try {
      const response = await (httpFetch ?? fetch)(input, init);
      if (observation) {
        const isServerEndpoint = new URL(requestUrl).href === observation.serverUrl;
        if (isServerEndpoint && response.status === 401) observation.sawUnauthorized = true;
        if (!isServerEndpoint && observation.sawUnauthorized) {
          observation.discoveryAttempted = true;
        }
      }
      return response;
    } catch (error) {
      if (observation) observation.networkFailed = true;
      throw error;
    }
  };
  return new StreamableHTTPClientTransport(new URL(config.url), {
    requestInit: { headers: config.headers },
    ...(oauthProvider ? { authProvider: oauthProvider } : {}),
    fetch: fetchWithObservation,
  });
}

export class McpAuthorizationRequiredError extends Error {
  readonly status = "needs-auth" as const;
  readonly code = "mcp_auth_required" as const;

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
  private readonly httpFetch?: FetchLike;
  private readonly oauthProviderFactory?: McpRegistryOptions["oauthProviderFactory"];

  constructor(configs: ReadonlyMap<string, McpServerConfig>, options: McpRegistryOptions = {}) {
    this.clientName = options.clientName ?? "ink-claude-code-dream";
    this.clientVersion = options.clientVersion ?? "0.1.0";
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.httpFetch = options.httpFetch;
    this.oauthProviderFactory = options.oauthProviderFactory;
    if (!Number.isSafeInteger(this.requestTimeoutMs) || this.requestTimeoutMs <= 0) {
      throw new Error("requestTimeoutMs must be a positive integer");
    }
    for (const [name, config] of configs) {
      this.entries.set(name, {
        name,
        type: config.type,
        status: config.enabled ? "pending" : "disabled",
        authentication: "unknown",
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
    entry.authentication = "unknown";
    delete entry.error;
    delete entry.failureCode;
    delete entry.oauth;
    delete entry.httpObservation;

    if (entry.config.type === "http") {
      entry.oauthProvider ??= this.oauthProviderFactory?.(entry.name, entry.config);
      entry.httpObservation = {
        serverUrl: entry.config.url,
        sawUnauthorized: false,
        discoveryAttempted: false,
        networkFailed: false,
      };
    }
    if (entry.config.type === "unsupported") {
      entry.status = "failed";
      entry.authentication = "unknown";
      entry.failureCode = "mcp_transport_unsupported";
      entry.error = `unsupported MCP transport: ${entry.config.transport}`;
      return cloneEntry(entry);
    }

    const client = new Client(
      { name: this.clientName, version: this.clientVersion },
      { capabilities: {} },
    );
    const transport = makeTransport(
      entry.config,
      entry.oauthProvider,
      this.httpFetch,
      entry.httpObservation,
    );
    entry.connection = { client, transport };
    try {
      await client.connect(transport, { timeout: this.requestTimeoutMs });
      await this.discover(entry);
      entry.status = "connected";
      entry.authentication = (await entry.oauthProvider?.tokens())?.access_token
        ? "authenticated"
        : "anonymous";
      return cloneEntry(entry);
    } catch (error) {
      const failure = classifyFailure(error, entry.httpObservation);
      entry.status = failure.status;
      entry.authentication = failure.authentication;
      entry.failureCode = failure.failureCode;
      entry.error = failure.message;
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
      entry.authentication = "required";
      entry.failureCode = "mcp_oauth_failed";
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
    if (!entry.enabled) {
      await this.closeConnection(entry);
      this.clearDiscovery(entry);
      delete entry.oauth;
      delete entry.error;
      delete entry.failureCode;
      entry.status = "disabled";
      entry.authentication = "unknown";
      return cloneEntry(entry);
    }
    return this.connect(serverName);
  }

  async toggle(serverName: string, enabled: boolean): Promise<McpRegistryEntry> {
    const entry = this.requireEntry(serverName);
    entry.enabled = enabled;
    entry.config.enabled = enabled;
    if (!enabled) {
      await this.closeConnection(entry);
      this.clearDiscovery(entry);
      entry.status = "disabled";
      entry.authentication = "unknown";
      delete entry.error;
      delete entry.failureCode;
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
    const failure = classifyFailure(error, entry.httpObservation);
    if (failure.failureCode !== "mcp_auth_required" && failure.failureCode !== "mcp_forbidden") {
      return;
    }
    entry.status = failure.status;
    entry.authentication = failure.authentication;
    entry.failureCode = failure.failureCode;
    entry.error = failure.message;
    const pending = entry.oauthProvider?.takePendingAuthorization();
    if (pending) entry.oauth = pending;
    this.clearDiscovery(entry);
    await this.closeConnection(entry);
    if (failure.status === "needs-auth") throw new McpAuthorizationRequiredError(entry.name);
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
