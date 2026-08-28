// [Input] Normalized MCP configs and official SDK v1 client/transports.
// [Output] Lifecycle registry, discovery inventory, calls, reads, and model tool bindings.
// [Pos] Stateful connection owner for the clean-room MCP client slice.
// [Sync] 2026-08-25: add SDK SSE while preserving verified auth and scope-upgrade semantics.
// [Sync] 2026-08-26: publish anonymous/OAuth/SSE discovery under Runtime 0.1.2.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  discoverOAuthServerInfo,
  extractWWWAuthenticateParams,
  UnauthorizedError,
} from "@modelcontextprotocol/sdk/client/auth.js";
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  checkResourceAllowed,
  resourceUrlFromServerUrl,
} from "@modelcontextprotocol/sdk/shared/auth-utils.js";
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
  RemoteMcpServerConfig,
  SseMcpServerConfig,
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
  authorization: "none" | "validated" | "not-advertised" | "invalid-metadata";
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
    config: RemoteMcpServerConfig,
  ) => PersistentOAuthClientProvider | undefined;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

type HttpAuthorizationFailure = "not-advertised" | "invalid-metadata" | "network" | "timeout";

class McpHttpAuthorizationError extends Error {
  readonly failure: HttpAuthorizationFailure;

  constructor(failure: HttpAuthorizationFailure) {
    super("MCP HTTP authorization validation failed");
    this.name = "McpHttpAuthorizationError";
    this.failure = failure;
  }
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function isSafeOAuthUrl(value: string | URL): boolean {
  try {
    const url = value instanceof URL ? value : new URL(value);
    if (url.username || url.password || url.hash) return false;
    return url.protocol === "https:" || (url.protocol === "http:" && isLoopbackHost(url.hostname));
  } catch {
    return false;
  }
}

function isSafeIssuerIdentifier(value: string): boolean {
  if (!isSafeOAuthUrl(value)) return false;
  const url = new URL(value);
  return !url.search;
}

function bearerChallenge(header: string | null): boolean {
  return Boolean(header && /^Bearer(?:\s|$)/iu.test(header.trim()));
}

function hasResourceMetadataParameter(header: string): boolean {
  return /(?:^|[\s,])resource_metadata\s*=/iu.test(header);
}

function scopeTokens(scope: string | undefined): string[] | undefined {
  if (!scope) return undefined;
  const tokens = scope.split(/\s+/u).filter(Boolean);
  return tokens.length > 0 && tokens.every((token) => /^[\x21\x23-\x5B\x5D-\x7E]+$/u.test(token))
    ? tokens
    : undefined;
}

function replaceChallengeScope(header: string, scope: string): string {
  if (/(?:^|[\s,])scope\s*=/iu.test(header)) {
    return header.replace(
      /((?:^|[\s,])scope\s*=)(?:"[^"]*"|[^\s,]+)/iu,
      (_match, prefix: string) => `${prefix}"${scope}"`,
    );
  }
  return `${header}, scope="${scope}"`;
}

function responseWithHeader(response: Response, name: string, value: string): Response {
  const headers = new Headers(response.headers);
  headers.set(name, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function responseWithStatus(response: Response, status: number): Response {
  return new Response(response.body, {
    status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

function errorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const candidate = error as { code?: unknown; status?: unknown };
  if (typeof candidate.status === "number") return candidate.status;
  if (typeof candidate.code === "number") return candidate.code;
  const message = (candidate as { message?: unknown }).message;
  if (typeof message === "string") {
    const match = /^Error POSTing to endpoint \(HTTP (\d{3})\):/u.exec(message);
    if (match) return Number(match[1]);
  }
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

function classificationForAuthorizationError(
  error: McpHttpAuthorizationError,
): FailureClassification {
  if (error.failure === "not-advertised") {
    return {
      status: "failed",
      authentication: "unknown",
      failureCode: "mcp_auth_not_advertised",
      message: "MCP server did not advertise valid authorization",
    };
  }
  if (error.failure === "invalid-metadata") {
    return {
      status: "failed",
      authentication: "unknown",
      failureCode: "mcp_auth_metadata_invalid",
      message: "MCP authorization metadata is invalid",
    };
  }
  if (error.failure === "timeout") {
    return {
      status: "failed",
      authentication: "unknown",
      failureCode: "mcp_timeout",
      message: "MCP request timed out",
    };
  }
  return {
    status: "failed",
    authentication: "unknown",
    failureCode: "mcp_network_error",
    message: "MCP network request failed",
  };
}

async function validateBearerAuthorization(
  response: Response,
  observation: HttpObservation,
  baseFetch: FetchLike,
  requestTimeoutMs: number,
  oauthProvider?: PersistentOAuthClientProvider,
): Promise<void> {
  const header = response.headers.get("www-authenticate")?.trim() ?? "";
  if (!bearerChallenge(header)) {
    observation.authorization = "not-advertised";
    throw new McpHttpAuthorizationError("not-advertised");
  }

  const challenge = extractWWWAuthenticateParams(response);
  const explicitlyAdvertised = hasResourceMetadataParameter(header);
  if (explicitlyAdvertised && !challenge.resourceMetadataUrl) {
    observation.authorization = "invalid-metadata";
    throw new McpHttpAuthorizationError("invalid-metadata");
  }
  if (challenge.resourceMetadataUrl && !isSafeOAuthUrl(challenge.resourceMetadataUrl)) {
    observation.authorization = "invalid-metadata";
    throw new McpHttpAuthorizationError("invalid-metadata");
  }

  let protectedResourceAdvertised = false;
  let protectedResourceMissing = false;
  let discoveryTimedOut = false;
  let discoveryNetworkFailed = false;
  const discoveryFetch: FetchLike = async (input, init) => {
    observation.discoveryAttempted = true;
    const requestUrl = input instanceof Request ? input.url : String(input);
    const timeoutSignal = AbortSignal.timeout(requestTimeoutMs);
    const suppliedSignal = init?.signal;
    const signal = suppliedSignal && typeof AbortSignal.any === "function"
      ? AbortSignal.any([suppliedSignal, timeoutSignal])
      : timeoutSignal;
    try {
      const discoveredResponse = await baseFetch(input, { ...init, signal });
      if (new URL(requestUrl).pathname.includes("/.well-known/oauth-protected-resource")) {
        if (discoveredResponse.status === 404) protectedResourceMissing = true;
        else if (discoveredResponse.ok) protectedResourceAdvertised = true;
      }
      return discoveredResponse;
    } catch (error) {
      if (isTimeout(error)) discoveryTimedOut = true;
      else discoveryNetworkFailed = true;
      throw error;
    }
  };

  let discovered: Awaited<ReturnType<typeof discoverOAuthServerInfo>>;
  try {
    discovered = await discoverOAuthServerInfo(observation.serverUrl, {
      ...(challenge.resourceMetadataUrl
        ? { resourceMetadataUrl: challenge.resourceMetadataUrl }
        : {}),
      fetchFn: discoveryFetch,
    });
  } catch {
    if (discoveryTimedOut) throw new McpHttpAuthorizationError("timeout");
    if (discoveryNetworkFailed) throw new McpHttpAuthorizationError("network");
    observation.authorization = "invalid-metadata";
    throw new McpHttpAuthorizationError("invalid-metadata");
  }

  if (discoveryTimedOut) throw new McpHttpAuthorizationError("timeout");
  if (discoveryNetworkFailed) throw new McpHttpAuthorizationError("network");
  if (!discovered.resourceMetadata) {
    observation.authorization = explicitlyAdvertised || protectedResourceAdvertised
      ? "invalid-metadata"
      : "not-advertised";
    throw new McpHttpAuthorizationError(
      explicitlyAdvertised || protectedResourceAdvertised || !protectedResourceMissing
        ? "invalid-metadata"
        : "not-advertised",
    );
  }
  if (
    !checkResourceAllowed({
      requestedResource: resourceUrlFromServerUrl(observation.serverUrl),
      configuredResource: discovered.resourceMetadata.resource,
    }) ||
    !discovered.resourceMetadata.authorization_servers?.length ||
    !discovered.authorizationServerMetadata
  ) {
    observation.authorization = "invalid-metadata";
    throw new McpHttpAuthorizationError("invalid-metadata");
  }

  const authorizationServerUrl = String(discovered.authorizationServerUrl);
  const metadata = discovered.authorizationServerMetadata;
  const endpointUrls = [
    authorizationServerUrl,
    metadata.issuer,
    metadata.authorization_endpoint,
    metadata.token_endpoint,
    ...(metadata.registration_endpoint ? [metadata.registration_endpoint] : []),
  ];
  if (
    metadata.issuer !== authorizationServerUrl ||
    !isSafeIssuerIdentifier(authorizationServerUrl) ||
    !isSafeIssuerIdentifier(metadata.issuer) ||
    endpointUrls.some((value) => !isSafeOAuthUrl(value))
  ) {
    observation.authorization = "invalid-metadata";
    throw new McpHttpAuthorizationError("invalid-metadata");
  }

  await oauthProvider?.saveDiscoveryState({
    authorizationServerUrl,
    ...(challenge.resourceMetadataUrl
      ? { resourceMetadataUrl: challenge.resourceMetadataUrl.href }
      : {}),
    resourceMetadata: discovered.resourceMetadata,
    authorizationServerMetadata: metadata,
  });
  observation.authorization = "validated";
}

async function normalizeInsufficientScopeChallenge(
  response: Response,
  oauthProvider: PersistentOAuthClientProvider | undefined,
): Promise<Response> {
  if (!oauthProvider || response.status !== 403) return response;
  const header = response.headers.get("www-authenticate")?.trim() ?? "";
  if (!bearerChallenge(header)) return response;
  const challenge = extractWWWAuthenticateParams(response);
  if (challenge.error !== "insufficient_scope" || !challenge.scope) return response;
  const challengedScopes = scopeTokens(challenge.scope);
  if (!challengedScopes) return response;
  const requested = new Set(scopeTokens((await oauthProvider.tokens())?.scope) ?? []);
  for (const scope of challengedScopes) requested.add(scope);
  const union = [...requested].join(" ");
  oauthProvider.requireInteractiveScopeUpgrade();
  return union === challenge.scope
    ? response
    : responseWithHeader(response, "www-authenticate", replaceChallengeScope(header, union));
}

function classifyFailure(
  error: unknown,
  observation?: HttpObservation,
): FailureClassification {
  if (error instanceof McpHttpAuthorizationError) {
    return classificationForAuthorizationError(error);
  }
  const status = errorStatus(error);
  if (error instanceof UnauthorizedError || status === 401) {
    if (observation?.authorization !== "validated") {
      return classificationForAuthorizationError(new McpHttpAuthorizationError("not-advertised"));
    }
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
  if (observation?.authorization === "not-advertised") {
    return classificationForAuthorizationError(new McpHttpAuthorizationError("not-advertised"));
  }
  if (observation?.authorization === "invalid-metadata" ||
    (observation?.sawUnauthorized && observation.discoveryAttempted &&
      observation.authorization !== "validated")) {
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
  config: StdioMcpServerConfig | HttpMcpServerConfig | SseMcpServerConfig,
  oauthProvider?: PersistentOAuthClientProvider,
  httpFetch?: FetchLike,
  observation?: HttpObservation,
  requestTimeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS,
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
  const baseFetch = httpFetch ?? fetch;
  const fetchWithObservation: FetchLike = async (input, init) => {
    const requestUrl = input instanceof Request ? input.url : String(input);
    let response: Response;
    try {
      response = await baseFetch(input, init);
    } catch (error) {
      if (observation) observation.networkFailed = true;
      throw error;
    }
    if (!observation) return normalizeInsufficientScopeChallenge(response, oauthProvider);

    const requestUrlValue = new URL(requestUrl);
    const configuredUrl = new URL(observation.serverUrl);
    const method = init?.method?.toUpperCase() ?? "GET";
    const isServerEndpoint = requestUrlValue.href === configuredUrl.href ||
      (config.type === "sse" && method === "POST" && requestUrlValue.origin === configuredUrl.origin);
    if (!isServerEndpoint && observation.sawUnauthorized) {
      observation.discoveryAttempted = true;
    }
    if (isServerEndpoint && response.status === 401) {
      observation.sawUnauthorized = true;
      try {
        await validateBearerAuthorization(
          response,
          observation,
          baseFetch,
          requestTimeoutMs,
          oauthProvider,
        );
      } catch (error) {
        await response.body?.cancel().catch(() => undefined);
        throw error;
      }
    }
    if (isServerEndpoint && response.status === 403 && oauthProvider) {
      const challenge = extractWWWAuthenticateParams(response);
      if (bearerChallenge(response.headers.get("www-authenticate")) &&
        challenge.error === "insufficient_scope") {
        try {
          await validateBearerAuthorization(
            response,
            observation,
            baseFetch,
            requestTimeoutMs,
            oauthProvider,
          );
        } catch (error) {
          await response.body?.cancel().catch(() => undefined);
          throw error;
        }
      }
    }
    const normalized = await normalizeInsufficientScopeChallenge(response, oauthProvider);
    const challenge = response.status === 403
      ? extractWWWAuthenticateParams(response)
      : undefined;
    const sseScopeUpgrade = config.type === "sse" && oauthProvider &&
      bearerChallenge(response.headers.get("www-authenticate")) &&
      challenge?.error === "insufficient_scope" && Boolean(scopeTokens(challenge.scope));
    return sseScopeUpgrade
      ? responseWithStatus(normalized, 401)
      : normalized;
  };
  const options = {
    requestInit: { headers: config.headers },
    ...(oauthProvider ? { authProvider: oauthProvider } : {}),
    fetch: fetchWithObservation,
  };
  return config.type === "sse"
    ? new SSEClientTransport(new URL(config.url), options)
    : new StreamableHTTPClientTransport(new URL(config.url), options);
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
    this.clientVersion = options.clientVersion ?? "0.1.2";
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

    if (entry.config.type === "http" || entry.config.type === "sse") {
      entry.oauthProvider ??= this.oauthProviderFactory?.(entry.name, entry.config);
      entry.httpObservation = {
        serverUrl: entry.config.url,
        sawUnauthorized: false,
        discoveryAttempted: false,
        networkFailed: false,
        authorization: "none",
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
      this.requestTimeoutMs,
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
    if ((entry.config.type !== "http" && entry.config.type !== "sse") || !entry.oauthProvider) {
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
      serverUrl: (entry.config as RemoteMcpServerConfig).url,
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
    if (!["mcp_auth_required", "mcp_auth_not_advertised", "mcp_auth_metadata_invalid", "mcp_forbidden"]
      .includes(failure.failureCode)) {
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
