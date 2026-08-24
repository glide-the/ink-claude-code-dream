// [Input] Public MCP URL and optional injected fetch with no authorization credentials.
// [Output] Sanitized unauthenticated HTTP challenge and OAuth discovery summary.
// [Pos] Read-only interoperability probe, including cloud.comfy.org/mcp.
// [Sync] 2026-08-24: add token-free challenge and RFC 9728/8414 discovery evidence.

import {
  discoverOAuthServerInfo,
  extractWWWAuthenticateParams,
} from "@modelcontextprotocol/sdk/client/auth.js";
import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js";

export interface OAuthProbeResult {
  serverUrl: string;
  challengeStatus?: number;
  challengeScheme?: string;
  challengeError?: string;
  resourceMetadataUrl?: string;
  authorizationServerUrl?: string;
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  registrationEndpoint?: string;
  error?: "unreachable" | "discovery-unavailable";
}

function challengeScheme(header: string | null): string | undefined {
  const scheme = header?.trim().split(/\s+/, 1)[0];
  return scheme && /^[A-Za-z][A-Za-z0-9_-]*$/.test(scheme) ? scheme : undefined;
}

export async function probeUnauthenticatedMcpOAuth(
  serverUrl: string,
  fetchFn: FetchLike = fetch,
): Promise<OAuthProbeResult> {
  const url = new URL(serverUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("MCP OAuth probe URL must use http or https");
  }
  const result: OAuthProbeResult = { serverUrl: url.href };
  try {
    const response = await fetchFn(url, {
      method: "GET",
      redirect: "manual",
      headers: { accept: "application/json, text/event-stream" },
    });
    result.challengeStatus = response.status;
    result.challengeScheme = challengeScheme(response.headers.get("www-authenticate"));
    if (response.status === 401 || response.status === 403) {
      const challenge = extractWWWAuthenticateParams(response);
      result.resourceMetadataUrl = challenge.resourceMetadataUrl?.href;
      result.challengeError = challenge.error;
    }
  } catch {
    result.error = "unreachable";
    return result;
  }
  try {
    const discovered = await discoverOAuthServerInfo(url, { fetchFn });
    result.authorizationServerUrl = discovered.authorizationServerUrl;
    result.authorizationEndpoint = discovered.authorizationServerMetadata?.authorization_endpoint;
    result.tokenEndpoint = discovered.authorizationServerMetadata?.token_endpoint;
    result.registrationEndpoint = discovered.authorizationServerMetadata?.registration_endpoint;
  } catch {
    result.error = "discovery-unavailable";
  }
  return result;
}
