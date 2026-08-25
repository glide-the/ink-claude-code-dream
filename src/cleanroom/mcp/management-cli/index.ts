// [Input] Public `mcp` argv, explicit process identity, private user state, and shared registry outcomes.
// [Output] Dream-compatible human status plus stable authentication/failure lines and an exit code.
// [Pos] Single outer-CLI wire point for clean-room MCP Resources management.
// [Sync] 2026-08-25: expose verified, unadvertised, and invalid HTTP authorization separately.

import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js";
import { parseMcpConfig } from "../config.ts";
import { probeUnauthenticatedMcpOAuth } from "../oauth/probe.ts";
import { McpRegistry } from "../registry.ts";
import type {
  McpAuthenticationState,
  McpFailureCode,
  McpRegistryEntry,
} from "../types.ts";
import { parseMcpManagementArgv, type McpManagementCommand } from "./argv.ts";
import { createUserOAuthContext, hasProjectedOAuthCredential } from "./oauth.ts";
import { UserMcpStateStore, type JsonObject } from "./storage.ts";

type WriteText = (text: string) => void | Promise<void>;

export interface McpManagementCliOptions {
  env?: NodeJS.ProcessEnv;
  stdout?: WriteText;
  stderr?: WriteText;
  readRedirectUrl?: () => Promise<string>;
  fetch?: FetchLike;
  authTimeoutMs?: number;
}

const GENERAL_HELP = `Usage: claude mcp <command>\n\nCommands:\n  list\n  get <name>\n  add --transport http --scope user <name> <url>\n  remove --scope user <name>\n  login <name> --no-browser\n  logout <name>\n`;
const HELP: Record<NonNullable<Extract<McpManagementCommand, { kind: "help" }>["subject"]>, string> = {
  add: "Usage: claude mcp add --transport http --scope user <name> <url>\n",
  remove: "Usage: claude mcp remove --scope user <name>\n",
  login: "Usage: claude mcp login <name> --no-browser\n",
  logout: "Usage: claude mcp logout <name>\n",
};

type ManagementFailureCode =
  | "auth_not_required"
  | "auth_not_advertised"
  | "metadata_invalid"
  | "network_unreachable"
  | "server_rejected"
  | "timeout"
  | "process_exited"
  | "cancelled";

class McpManagementFailure extends Error {
  readonly failureCode: ManagementFailureCode;
  readonly authentication: McpAuthenticationState;

  constructor(
    failureCode: ManagementFailureCode,
    authentication: McpAuthenticationState = "unknown",
  ) {
    super("MCP management operation failed");
    this.name = "McpManagementFailure";
    this.failureCode = failureCode;
    this.authentication = authentication;
  }
}

interface ExecutionOptions {
  env: NodeJS.ProcessEnv;
  stdout: WriteText;
  stderr: WriteText;
  readRedirectUrl: () => Promise<string>;
  fetch?: FetchLike;
  authTimeoutMs: number;
}

interface RenderedStatus {
  label: string;
  authentication: McpAuthenticationState;
  failureCode?: ManagementFailureCode;
}

function transportOf(server: JsonObject): "http" | "stdio" | "configured" {
  if (server.type === "http" || typeof server.url === "string") return "http";
  if (server.type === "stdio" || typeof server.command === "string") return "stdio";
  return "configured";
}

function serverUrl(server: JsonObject): string {
  if (typeof server.url !== "string") throw new Error("MCP server is not an HTTP server");
  const parsed = new URL(server.url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("MCP server is not an HTTP server");
  }
  return parsed.href;
}

function redirectUrlFromEnv(env: NodeJS.ProcessEnv): string {
  const raw = env.INK_CLAUDE_MCP_OAUTH_REDIRECT_URL?.trim() || "http://127.0.0.1:54545/callback";
  const value = new URL(raw);
  if ((value.protocol !== "http:" && value.protocol !== "https:") || value.username || value.password) {
    throw new Error("OAuth redirect URL is invalid");
  }
  return value.href;
}

function timeoutFromEnv(env: NodeJS.ProcessEnv, explicit?: number): number {
  if (Number.isSafeInteger(explicit) && explicit! > 0) return explicit!;
  const seconds = Number(env.INK_CLAUDE_MCP_AUTH_TIMEOUT_SECONDS ?? "600");
  return Number.isSafeInteger(seconds) && seconds > 0 && seconds <= 3_600
    ? seconds * 1_000
    : 600_000;
}

async function defaultReadRedirectUrl(): Promise<string> {
  process.stdin.setEncoding("utf8");
  let buffered = "";
  for await (const chunk of process.stdin) {
    buffered += chunk;
    const newline = buffered.indexOf("\n");
    if (newline >= 0) return buffered.slice(0, newline).replace(/\r$/u, "");
    if (buffered.length > 32_768) throw new Error("OAuth redirect URL is too long");
  }
  return buffered.replace(/\r$/u, "");
}

function parseRedirect(value: string, expectedState: string): { code: string; state: string } {
  if (!value) throw new McpManagementFailure("process_exited");
  if (value.length > 32_768) throw new McpManagementFailure("server_rejected");
  const url = new URL(value.trim());
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username || url.password || !url.host
  ) throw new McpManagementFailure("server_rejected");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state || state !== expectedState) {
    throw new McpManagementFailure("server_rejected");
  }
  return { code, state };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new McpManagementFailure("timeout")),
      timeoutMs,
    );
    timer.unref?.();
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

function renderedStatus(entry: McpRegistryEntry): RenderedStatus {
  const label = entry.status === "connected"
    ? "✓ Connected"
    : entry.status === "needs-auth"
    ? "Needs authentication"
    : entry.failureCode === "mcp_forbidden"
    ? "Forbidden"
    : entry.status === "disabled"
    ? "Disabled"
    : "Unavailable";
  return {
    label,
    authentication: entry.authentication,
    ...(entry.failureCode && entry.failureCode !== "mcp_auth_required"
      ? { failureCode: managementFailureCode(entry.failureCode) }
      : {}),
  };
}

function managementFailureCode(code: McpFailureCode): ManagementFailureCode {
  if (code === "mcp_auth_not_advertised") return "auth_not_advertised";
  if (code === "mcp_timeout") return "timeout";
  if (code === "mcp_network_error") return "network_unreachable";
  if (code === "mcp_auth_metadata_invalid") return "metadata_invalid";
  return "server_rejected";
}

async function classifyHttpServer(
  store: UserMcpStateStore,
  name: string,
  server: JsonObject,
  options: ExecutionOptions,
): Promise<McpRegistryEntry> {
  const url = serverUrl(server);
  const configs = await parseMcpConfig(JSON.stringify({ mcpServers: { [name]: server } }));
  const projection = await store.readOAuth(name);
  const oauth = hasProjectedOAuthCredential(projection, url)
    ? await createUserOAuthContext({
        store,
        serverName: name,
        serverUrl: url,
        redirectUrl: redirectUrlFromEnv(options.env),
        ...(options.fetch ? { fetch: options.fetch } : {}),
      })
    : undefined;
  return connectConfiguredServer(configs, name, options, oauth?.provider);
}

async function connectConfiguredServer(
  configs: Awaited<ReturnType<typeof parseMcpConfig>>,
  name: string,
  options: ExecutionOptions,
  provider?: Awaited<ReturnType<typeof createUserOAuthContext>>["provider"],
): Promise<McpRegistryEntry> {
  const registry = new McpRegistry(configs, {
    requestTimeoutMs: Math.min(options.authTimeoutMs, 10_000),
    ...(options.fetch ? { httpFetch: options.fetch } : {}),
    ...(provider ? { oauthProviderFactory: () => provider } : {}),
  });
  try {
    return await registry.connect(name);
  } finally {
    await registry.close();
  }
}

async function classifyHttpServerWithProvider(
  store: UserMcpStateStore,
  name: string,
  server: JsonObject,
  options: ExecutionOptions,
): Promise<{
  entry: McpRegistryEntry;
  oauth: Awaited<ReturnType<typeof createUserOAuthContext>>;
}> {
  const url = serverUrl(server);
  const oauth = await createUserOAuthContext({
    store,
    serverName: name,
    serverUrl: url,
    redirectUrl: redirectUrlFromEnv(options.env),
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  const configs = await parseMcpConfig(JSON.stringify({ mcpServers: { [name]: server } }));
  return {
    entry: await connectConfiguredServer(configs, name, options, oauth.provider),
    oauth,
  };
}

async function statusFor(
  store: UserMcpStateStore,
  name: string,
  server: JsonObject,
  options: ExecutionOptions,
): Promise<RenderedStatus> {
  if (transportOf(server) !== "http") {
    return { label: "Configured", authentication: "unknown" };
  }
  return renderedStatus(await classifyHttpServer(store, name, server, options));
}

async function writeFailure(
  stderr: WriteText,
  code: ManagementFailureCode,
  authentication: McpAuthenticationState,
): Promise<void> {
  await stderr(
    `Authentication: ${authentication}\nFailure-Code: ${code}\nClaude MCP command failed.\n`,
  );
}

function normalizedFailure(error: unknown): McpManagementFailure {
  if (error instanceof McpManagementFailure) return error;
  if (error && typeof error === "object" && (error as { name?: unknown }).name === "AbortError") {
    return new McpManagementFailure("cancelled");
  }
  return new McpManagementFailure("server_rejected");
}

async function assertOAuthAdvertised(
  url: string,
  classified: McpRegistryEntry,
  options: ExecutionOptions,
): Promise<void> {
  const probe = await withTimeout(
    probeUnauthenticatedMcpOAuth(url, options.fetch ?? fetch),
    options.authTimeoutMs,
  );
  if (probe.error === "unreachable") {
    throw new McpManagementFailure("network_unreachable");
  }
  if (probe.error === "invalid-metadata" ||
    (classified.status === "needs-auth" && probe.error === "discovery-unavailable")) {
    throw new McpManagementFailure("metadata_invalid", classified.authentication);
  }
  if (
    probe.error === "discovery-unavailable" ||
    !probe.authorizationServerUrl || !probe.authorizationEndpoint || !probe.tokenEndpoint
  ) {
    throw new McpManagementFailure(
      classified.status === "connected" ? "auth_not_required" : "auth_not_advertised",
      classified.authentication,
    );
  }
}

async function execute(
  command: McpManagementCommand,
  store: UserMcpStateStore,
  options: ExecutionOptions,
): Promise<number> {
  if (command.kind === "help") {
    await options.stdout(command.subject ? HELP[command.subject] : GENERAL_HELP);
    return 0;
  }
  if (command.kind === "list") {
    const servers = await store.listServers();
    if (Object.keys(servers).length === 0) {
      await options.stdout("No MCP servers configured\n");
      return 0;
    }
    await options.stdout("MCP servers\n");
    for (const [name, server] of Object.entries(servers)) {
      const status = await statusFor(store, name, server, options);
      await options.stdout(`${name}: ${transportOf(server)} - ${status.label}\n`);
    }
    return 0;
  }
  if (command.kind === "get") {
    const server = await store.getServer(command.serverName);
    if (!server) {
      await options.stderr(`No MCP server named "${command.serverName}".\n`);
      await writeFailure(options.stderr, "server_rejected", "unknown");
      return 1;
    }
    const status = await statusFor(store, command.serverName, server, options);
    await options.stdout(
      `${command.serverName}\nStatus: ${status.label}\n` +
      `Authentication: ${status.authentication}\n` +
      (status.failureCode ? `Failure-Code: ${status.failureCode}\n` : "") +
      `Scope: User config (available in all your projects)\nTransport: ${transportOf(server)}\n`,
    );
    return 0;
  }
  if (command.kind === "add") {
    await store.addHttpServer(command.serverName, command.serverUrl);
    await options.stdout(`Added HTTP MCP server ${command.serverName} to user config\n`);
    return 0;
  }
  if (command.kind === "remove") {
    if (!await store.removeServer(command.serverName)) {
      await options.stderr(`No MCP server named "${command.serverName}".\n`);
      await writeFailure(options.stderr, "server_rejected", "unknown");
      return 1;
    }
    await options.stdout(`Removed MCP server ${command.serverName}\n`);
    return 0;
  }

  const server = await store.getServer(command.serverName);
  if (!server) {
    await options.stderr(`No MCP server named "${command.serverName}".\n`);
    await writeFailure(options.stderr, "server_rejected", "unknown");
    return 1;
  }
  const url = serverUrl(server);
  if (command.kind === "logout") {
    const oauth = await createUserOAuthContext({
      store,
      serverName: command.serverName,
      serverUrl: url,
      redirectUrl: redirectUrlFromEnv(options.env),
      ...(options.fetch ? { fetch: options.fetch } : {}),
    });
    await withTimeout(oauth.logout(), options.authTimeoutMs);
    const status = renderedStatus(await classifyHttpServer(store, command.serverName, server, options));
    await options.stdout(
      `Logged out of ${command.serverName}\nStatus: ${status.label}\n` +
      `Authentication: ${status.authentication}\n` +
      (status.failureCode ? `Failure-Code: ${status.failureCode}\n` : ""),
    );
    return 0;
  }

  const classified = await classifyHttpServer(store, command.serverName, server, options);
  if (classified.status === "connected" && classified.authentication === "authenticated") {
    await options.stdout("Status: ✓ Connected\nAuthentication: authenticated\n");
    return 0;
  }
  if (classified.status !== "connected" && classified.status !== "needs-auth") {
    await writeFailure(
      options.stderr,
      classified.failureCode ? managementFailureCode(classified.failureCode) : "server_rejected",
      classified.authentication,
    );
    return 1;
  }
  let oauth: Awaited<ReturnType<typeof createUserOAuthContext>>;
  let started:
    | { ok: true; status: "ready" }
    | { ok: true; status: "authorization-required"; authorizationUrl: string; state: string };
  if (classified.status === "needs-auth") {
    const challenged = await classifyHttpServerWithProvider(
      store,
      command.serverName,
      server,
      options,
    );
    oauth = challenged.oauth;
    if (challenged.entry.status === "connected") {
      await oauth.persist();
      await options.stdout(
        `Status: ✓ Connected\nAuthentication: ${challenged.entry.authentication}\n`,
      );
      return 0;
    }
    if (challenged.entry.status !== "needs-auth" || !challenged.entry.oauth) {
      await oauth.cancel();
      await writeFailure(
        options.stderr,
        challenged.entry.failureCode
          ? managementFailureCode(challenged.entry.failureCode)
          : "auth_not_advertised",
        challenged.entry.failureCode === "mcp_auth_metadata_invalid"
          ? classified.authentication
          : challenged.entry.authentication,
      );
      return 1;
    }
    started = { ok: true, status: "authorization-required", ...challenged.entry.oauth };
  } else {
    await assertOAuthAdvertised(url, classified, options);
    oauth = await createUserOAuthContext({
      store,
      serverName: command.serverName,
      serverUrl: url,
      redirectUrl: redirectUrlFromEnv(options.env),
      ...(options.fetch ? { fetch: options.fetch } : {}),
    });
    const begun = await withTimeout(oauth.flow.begin(), options.authTimeoutMs);
    if (!begun.ok) {
      await oauth.cancel();
      throw new McpManagementFailure("server_rejected", classified.authentication);
    }
    if (begun.status !== "ready" && begun.status !== "authorization-required") {
      await oauth.cancel();
      throw new McpManagementFailure("server_rejected", classified.authentication);
    }
    started = begun;
  }
  try {
    if (started.status === "ready") {
      await oauth.persist();
    } else {
      await options.stdout(`Open ${started.authorizationUrl}\nPaste the full redirect URL:\n`);
      const redirect = await withTimeout(options.readRedirectUrl(), options.authTimeoutMs);
      const completed = await withTimeout(
        oauth.flow.completeCallback(parseRedirect(redirect, started.state)),
        options.authTimeoutMs,
      );
      if (!completed.ok || completed.status !== "ready") {
        throw new McpManagementFailure("server_rejected", classified.authentication);
      }
      await oauth.persist();
    }
    const connected = await classifyHttpServer(store, command.serverName, server, options);
    if (connected.status !== "connected") {
      throw new McpManagementFailure(
        connected.failureCode ? managementFailureCode(connected.failureCode) : "server_rejected",
        connected.authentication,
      );
    }
    await options.stdout(
      `Status: ✓ Connected\nAuthentication: ${connected.authentication}\n`,
    );
    return 0;
  } catch (error) {
    // A cancelled, timed-out, or malformed callback must not leave a PKCE
    // verifier or callback state available to a later process. The public SDK
    // may finish one queued provider write just after `auth()` returns, so
    // clear again after yielding the task queue.
    await oauth.cancel();
    if (error && typeof error === "object" && (error as { name?: unknown }).name === "AbortError") {
      throw new McpManagementFailure("cancelled", classified.authentication);
    }
    if (error instanceof McpManagementFailure) throw error;
    throw new McpManagementFailure("server_rejected", classified.authentication);
  }
}

/**
 * Wire this once before the stream-json Runtime parser. `undefined` means argv
 * was not an MCP management command; an integer is the complete process code.
 */
export async function runMcpManagementCli(
  argv: string[],
  input: McpManagementCliOptions = {},
): Promise<number | undefined> {
  let command: McpManagementCommand | undefined;
  const stdout = input.stdout ?? ((text: string) => { process.stdout.write(text); });
  const stderr = input.stderr ?? ((text: string) => { process.stderr.write(text); });
  try {
    command = parseMcpManagementArgv(argv);
    if (!command) return undefined;
    const env = input.env ?? process.env;
    if (command.kind === "help") {
      await stdout(command.subject ? HELP[command.subject] : GENERAL_HELP);
      return 0;
    }
    const store = await UserMcpStateStore.open(env.CLAUDE_CONFIG_DIR);
    return await execute(command, store, {
      env,
      stdout,
      stderr,
      readRedirectUrl: input.readRedirectUrl ?? defaultReadRedirectUrl,
      ...(input.fetch ? { fetch: input.fetch } : {}),
      authTimeoutMs: timeoutFromEnv(env, input.authTimeoutMs),
    });
  } catch (error) {
    if (!command) return undefined;
    const failure = normalizedFailure(error);
    await writeFailure(stderr, failure.failureCode, failure.authentication);
    return 1;
  }
}

export { parseMcpManagementArgv } from "./argv.ts";
export { createUserOAuthContext, hasProjectedOAuthCredential } from "./oauth.ts";
export { UserMcpStateStore } from "./storage.ts";
