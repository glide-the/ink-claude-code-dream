// [Input] Public MCP URL and optional injected fetch with no authorization credentials.
// [Output] Sanitized unauthenticated HTTP challenge and OAuth discovery summary.
// [Pos] Read-only interoperability probe, including cloud.comfy.org/mcp.
// [Sync] 2026-08-25: distinguish unreachable, unadvertised, and invalid discovery safely.

import {
  discoverOAuthServerInfo,
  extractWWWAuthenticateParams,
} from "@modelcontextprotocol/sdk/client/auth.js";
import {
  checkResourceAllowed,
  resourceUrlFromServerUrl,
} from "@modelcontextprotocol/sdk/shared/auth-utils.js";
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
  error?: "unreachable" | "discovery-unavailable" | "invalid-metadata";
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
  let networkFailed = false;
  const trackedFetch: FetchLike = async (input, init) => {
    try {
      return await fetchFn(input, init);
    } catch {
      networkFailed = true;
      throw new TypeError("MCP OAuth probe network request failed");
    }
  };
  try {
    const response = await trackedFetch(url, {
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
    const discovered = await discoverOAuthServerInfo(url, { fetchFn: trackedFetch });
    if (discovered.resourceMetadata && !checkResourceAllowed({
      requestedResource: resourceUrlFromServerUrl(url),
      configuredResource: discovered.resourceMetadata.resource,
    })) {
      result.error = "invalid-metadata";
      return result;
    }
    result.authorizationServerUrl = discovered.authorizationServerUrl;
    result.authorizationEndpoint = discovered.authorizationServerMetadata?.authorization_endpoint;
    result.tokenEndpoint = discovered.authorizationServerMetadata?.token_endpoint;
    result.registrationEndpoint = discovered.authorizationServerMetadata?.registration_endpoint;
  } catch {
    result.error = networkFailed
      ? "unreachable"
      : result.challengeStatus === 401
      ? "invalid-metadata"
      : "discovery-unavailable";
  }
  return result;
}
