// [Input] Process argv plus inline or file-backed JSON containing mcpServers.
// [Output] Strict normalized MCP configs keyed by the exact configured server name.
// [Pos] Untrusted configuration boundary for the clean-room MCP client.
// [Sync] 2026-08-24: parse repeated --mcp-config values for stdio and Streamable HTTP.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { McpServerConfig } from "./types.ts";

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function objectOfStrings(value: unknown, field: string): Record<string, string> {
  if (value === undefined) return {};
  if (!isObject(value)) throw new Error(`${field} must be an object of strings`);
  const result: Record<string, string> = {};
  for (const [name, item] of Object.entries(value)) {
    if (typeof item !== "string") throw new Error(`${field}.${name} must be a string`);
    result[name] = item;
  }
  return result;
}

function stringArray(value: unknown, field: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${field} must be an array of strings`);
  }
  return [...value] as string[];
}

function optionalBoolean(value: unknown, field: string, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new Error(`${field} must be a boolean`);
  return value;
}

function normalizeServer(name: string, raw: unknown): McpServerConfig {
  if (!name) throw new Error("MCP server names must not be empty");
  if (!isObject(raw)) throw new Error(`mcpServers.${name} must be an object`);

  const enabled = optionalBoolean(raw.enabled, `mcpServers.${name}.enabled`, true);
  const requiresOAuth =
    raw.oauth === true || raw.authProvider !== undefined || raw.authorization !== undefined;

  if (typeof raw.command === "string" && raw.command.length > 0) {
    if (raw.type !== undefined && raw.type !== "stdio") {
      throw new Error(`mcpServers.${name} cannot combine command with type ${String(raw.type)}`);
    }
    if (raw.cwd !== undefined && (typeof raw.cwd !== "string" || raw.cwd.length === 0)) {
      throw new Error(`mcpServers.${name}.cwd must be a non-empty string`);
    }
    return {
      type: "stdio",
      command: raw.command,
      args: stringArray(raw.args, `mcpServers.${name}.args`),
      env: objectOfStrings(raw.env, `mcpServers.${name}.env`),
      ...(typeof raw.cwd === "string" ? { cwd: raw.cwd } : {}),
      enabled,
      requiresOAuth,
    };
  }

  if (typeof raw.url === "string" && raw.url.length > 0) {
    const transport = raw.type ?? "http";
    if (transport !== "http" && transport !== "streamable-http") {
      return {
        type: "unsupported",
        transport: String(transport),
        enabled,
        requiresOAuth,
      };
    }
    let parsed: URL;
    try {
      parsed = new URL(raw.url);
    } catch {
      throw new Error(`mcpServers.${name}.url must be an absolute URL`);
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(`mcpServers.${name}.url must use http or https`);
    }
    return {
      type: "http",
      url: parsed.href,
      headers: objectOfStrings(raw.headers, `mcpServers.${name}.headers`),
      enabled,
      requiresOAuth,
    };
  }

  const transport = typeof raw.type === "string" ? raw.type : "unknown";
  return { type: "unsupported", transport, enabled, requiresOAuth };
}

function mcpConfigValues(argv: string[]): string[] {
  const values: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token.startsWith("--mcp-config=")) {
      const value = token.slice("--mcp-config=".length);
      if (!value) throw new Error("--mcp-config requires a value");
      values.push(value);
      continue;
    }
    if (token !== "--mcp-config") continue;
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error("--mcp-config requires a value");
    }
    values.push(value);
    index += 1;
  }
  return values;
}

async function parseConfigValue(raw: string, cwd: string): Promise<JsonObject> {
  let text = raw;
  if (!raw.trimStart().startsWith("{")) {
    text = await readFile(resolve(cwd, raw), "utf8");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid JSON";
    throw new Error(`invalid --mcp-config JSON: ${message}`);
  }
  if (!isObject(parsed)) throw new Error("--mcp-config must contain a JSON object");
  return parsed;
}

export async function parseMcpConfigArgv(
  argv: string[],
  cwd = process.cwd(),
): Promise<Map<string, McpServerConfig>> {
  const servers = new Map<string, McpServerConfig>();
  for (const rawValue of mcpConfigValues(argv)) {
    const config = await parseConfigValue(rawValue, cwd);
    if (!isObject(config.mcpServers)) {
      throw new Error("--mcp-config requires an mcpServers object");
    }
    for (const [name, rawServer] of Object.entries(config.mcpServers)) {
      servers.set(name, normalizeServer(name, rawServer));
    }
  }
  return servers;
}

export async function parseMcpConfig(
  value: string,
  cwd = process.cwd(),
): Promise<Map<string, McpServerConfig>> {
  return parseMcpConfigArgv(["--mcp-config", value], cwd);
}
