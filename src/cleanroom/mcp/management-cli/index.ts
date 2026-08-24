// [Input] Public `mcp` argv, explicit process identity, private user state, and headless OAuth input.
// [Output] Dream-parser-compatible bounded terminal output and an exit code.
// [Pos] Single outer-CLI wire point for clean-room MCP Resources management.
// [Sync] 2026-08-24: implement all Dream Resources management commands without browser side effects.

import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js";
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
  if (!value || value.length > 32_768) throw new Error("OAuth redirect URL is invalid");
  const url = new URL(value.trim());
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username || url.password || !url.host
  ) throw new Error("OAuth redirect URL is invalid");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state || state !== expectedState) throw new Error("OAuth redirect URL is invalid");
  return { code, state };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("MCP command timed out")), timeoutMs);
    timer.unref?.();
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

async function statusLabel(store: UserMcpStateStore, name: string, server: JsonObject): Promise<string> {
  if (transportOf(server) !== "http") return "Configured";
  const credential = await store.readOAuth(name);
  return hasProjectedOAuthCredential(credential, serverUrl(server))
    ? "✓ Connected"
    : "Needs authentication";
}

async function execute(
  command: McpManagementCommand,
  store: UserMcpStateStore,
  options: Required<Pick<McpManagementCliOptions, "stdout" | "stderr" | "readRedirectUrl">> &
    Pick<McpManagementCliOptions, "fetch"> & { env: NodeJS.ProcessEnv; authTimeoutMs: number },
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
      await options.stdout(`${name}: ${transportOf(server)} - ${await statusLabel(store, name, server)}\n`);
    }
    return 0;
  }
  if (command.kind === "get") {
    const server = await store.getServer(command.serverName);
    if (!server) {
      await options.stderr(`No MCP server named "${command.serverName}".\n`);
      return 1;
    }
    await options.stdout(`${command.serverName}\nStatus: ${await statusLabel(store, command.serverName, server)}\nScope: User config (available in all your projects)\nTransport: ${transportOf(server)}\n`);
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
      return 1;
    }
    await options.stdout(`Removed MCP server ${command.serverName}\n`);
    return 0;
  }

  const server = await store.getServer(command.serverName);
  if (!server) {
    await options.stderr(`No MCP server named "${command.serverName}".\n`);
    return 1;
  }
  const oauth = await createUserOAuthContext({
    store,
    serverName: command.serverName,
    serverUrl: serverUrl(server),
    redirectUrl: redirectUrlFromEnv(options.env),
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  if (command.kind === "logout") {
    await withTimeout(oauth.logout(), options.authTimeoutMs);
    await options.stdout(`Logged out of ${command.serverName}\n`);
    return 0;
  }

  try {
    const started = await withTimeout(oauth.flow.begin(), options.authTimeoutMs);
    if (!started.ok) throw new Error("MCP OAuth could not be started");
    if (started.status === "ready") {
      await oauth.persist();
      await options.stdout(`Status: ✓ Connected\n`);
      return 0;
    }
    await options.stdout(`Open ${started.authorizationUrl}\nPaste the full redirect URL:\n`);
    const redirect = await withTimeout(options.readRedirectUrl(), options.authTimeoutMs);
    const completed = await withTimeout(
      oauth.flow.completeCallback(parseRedirect(redirect, started.state)),
      options.authTimeoutMs,
    );
    if (!completed.ok || completed.status !== "ready") throw new Error("MCP OAuth callback failed");
    await oauth.persist();
    await options.stdout(`Status: ✓ Connected\n`);
    return 0;
  } catch (error) {
    // A cancelled, timed-out, or malformed callback must not leave a PKCE
    // verifier or callback state available to a later process. The public SDK
    // may finish one queued provider write just after `auth()` returns, so
    // clear again after yielding the task queue.
    await oauth.logout().catch(() => undefined);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await oauth.logout().catch(() => undefined);
    throw error;
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
    const store = await UserMcpStateStore.open(env.CLAUDE_CONFIG_DIR);
    return await execute(command, store, {
      env,
      stdout,
      stderr,
      readRedirectUrl: input.readRedirectUrl ?? defaultReadRedirectUrl,
      ...(input.fetch ? { fetch: input.fetch } : {}),
      authTimeoutMs: timeoutFromEnv(env, input.authTimeoutMs),
    });
  } catch {
    if (!command) return undefined;
    await stderr("Claude MCP command failed.\n");
    return 1;
  }
}

export { parseMcpManagementArgv } from "./argv.ts";
export { createUserOAuthContext } from "./oauth.ts";
export { UserMcpStateStore } from "./storage.ts";
