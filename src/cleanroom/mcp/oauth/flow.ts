// [Input] MCP server URL, persistent provider, callback code/state, and optional injected fetch.
// [Output] Headless authorization/refresh/logout results with stable non-secret error DTOs.
// [Pos] User-interaction-neutral OAuth orchestration over the public MCP SDK API.
// [Sync] 2026-08-24: add DCR/PKCE begin, callback completion, refresh, logout, and safe failures.

import {
  auth,
  discoverOAuthServerInfo,
  refreshAuthorization,
  selectResourceURL,
} from "@modelcontextprotocol/sdk/client/auth.js";
import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js";
import { OAuthStateMismatchError, PersistentOAuthClientProvider } from "./provider.ts";

export type OAuthSafeErrorCode =
  | "oauth_required"
  | "oauth_state_mismatch"
  | "oauth_callback_invalid"
  | "oauth_refresh_unavailable"
  | "oauth_failed";

export interface OAuthSafeError {
  ok: false;
  status: "needs-auth";
  code: OAuthSafeErrorCode;
  message: string;
  retryable: boolean;
}

export interface OAuthAuthorizationRequired {
  ok: true;
  status: "authorization-required";
  authorizationUrl: string;
  state: string;
}

export interface OAuthReady {
  ok: true;
  status: "ready" | "refreshed" | "logged-out";
}

export type OAuthFlowResult = OAuthAuthorizationRequired | OAuthReady | OAuthSafeError;

export interface HeadlessOAuthFlowOptions {
  serverUrl: string;
  provider: PersistentOAuthClientProvider;
  fetch?: FetchLike;
}

function safeFailure(code: OAuthSafeErrorCode): OAuthSafeError {
  const messages: Record<OAuthSafeErrorCode, string> = {
    oauth_required: "MCP authorization is required",
    oauth_state_mismatch: "OAuth callback validation failed",
    oauth_callback_invalid: "OAuth callback code is invalid",
    oauth_refresh_unavailable: "OAuth refresh credentials are unavailable",
    oauth_failed: "MCP OAuth operation failed",
  };
  return {
    ok: false,
    status: "needs-auth",
    code,
    message: messages[code],
    retryable: code !== "oauth_state_mismatch",
  };
}

export function oauthNeedsAuthFromStatus(status: number): OAuthSafeError | undefined {
  return status === 401 || status === 403 ? safeFailure("oauth_required") : undefined;
}

export class HeadlessMcpOAuthFlow {
  readonly serverUrl: string;
  readonly provider: PersistentOAuthClientProvider;
  private readonly fetch?: FetchLike;

  constructor(options: HeadlessOAuthFlowOptions) {
    this.serverUrl = new URL(options.serverUrl).href;
    this.provider = options.provider;
    this.fetch = options.fetch;
  }

  async begin(scope?: string): Promise<OAuthFlowResult> {
    try {
      const result = await auth(this.provider, {
        serverUrl: this.serverUrl,
        ...(scope ? { scope } : {}),
        ...(this.fetch ? { fetchFn: this.fetch } : {}),
      });
      if (result === "AUTHORIZED") return { ok: true, status: "ready" };
      const pending = this.provider.takePendingAuthorization();
      if (!pending) return safeFailure("oauth_failed");
      return { ok: true, status: "authorization-required", ...pending };
    } catch {
      return safeFailure("oauth_failed");
    }
  }

  async completeCallback(input: { code?: string; state?: string }): Promise<OAuthFlowResult> {
    if (!input.code || typeof input.code !== "string") return safeFailure("oauth_callback_invalid");
    try {
      await this.provider.assertCallbackState(input.state);
      const result = await auth(this.provider, {
        serverUrl: this.serverUrl,
        authorizationCode: input.code,
        ...(this.fetch ? { fetchFn: this.fetch } : {}),
      });
      if (result !== "AUTHORIZED") return safeFailure("oauth_failed");
      await this.provider.completeCallback();
      return { ok: true, status: "ready" };
    } catch (error) {
      if (error instanceof OAuthStateMismatchError) return safeFailure("oauth_state_mismatch");
      return safeFailure("oauth_callback_invalid");
    }
  }

  async refresh(): Promise<OAuthFlowResult> {
    try {
      const tokens = await this.provider.tokens();
      const clientInformation = await this.provider.clientInformation();
      if (!tokens?.refresh_token || !clientInformation) {
        return safeFailure("oauth_refresh_unavailable");
      }
      const server = await discoverOAuthServerInfo(this.serverUrl, {
        ...(this.fetch ? { fetchFn: this.fetch } : {}),
      });
      const resource = await selectResourceURL(
        this.serverUrl,
        this.provider,
        server.resourceMetadata,
      );
      const refreshed = await refreshAuthorization(server.authorizationServerUrl, {
        metadata: server.authorizationServerMetadata,
        clientInformation,
        refreshToken: tokens.refresh_token,
        resource,
        ...(this.fetch ? { fetchFn: this.fetch } : {}),
      });
      await this.provider.saveTokens(refreshed);
      return { ok: true, status: "refreshed" };
    } catch {
      await this.provider.invalidateCredentials("tokens").catch(() => undefined);
      return safeFailure("oauth_required");
    }
  }

  async logout(): Promise<OAuthReady | OAuthSafeError> {
    try {
      await this.provider.invalidateCredentials("all");
      return { ok: true, status: "logged-out" };
    } catch {
      return safeFailure("oauth_failed");
    }
  }
}
