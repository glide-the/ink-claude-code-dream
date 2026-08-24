// [Input] One configured HTTP server, Dream's projected mcpOAuth value, and the public MCP OAuth provider.
// [Output] Hydrated headless OAuth flow with rotation-safe Dream credential projection synchronization.
// [Pos] Compatibility bridge between clean-room OAuth persistence and Dream thread projection.
// [Sync] 2026-08-25: cancel pending login state without deleting previously working tokens.

import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  HeadlessMcpOAuthFlow,
  PersistentOAuthClientProvider,
  type PersistedOAuthState,
} from "../oauth/index.ts";
import { UserMcpStateStore, type JsonObject } from "./storage.ts";

const PROJECTED_SCHEMA = "ink-cleanroom-mcp-oauth/v1";

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function projectedState(value: JsonObject | undefined, serverUrl: string): PersistedOAuthState | undefined {
  if (
    !value || value.schema !== PROJECTED_SCHEMA || value.serverUrl !== serverUrl ||
    !isObject(value.state)
  ) return undefined;
  return structuredClone(value.state) as PersistedOAuthState;
}

export function hasProjectedOAuthCredential(
  value: JsonObject | undefined,
  serverUrl: string,
): boolean {
  const state = projectedState(value, serverUrl);
  return Boolean(
    state?.tokens &&
    typeof state.tokens.access_token === "string" &&
    state.tokens.access_token.length > 0,
  );
}

export interface UserOAuthContextOptions {
  store: UserMcpStateStore;
  serverName: string;
  serverUrl: string;
  redirectUrl: string;
  fetch?: FetchLike;
}

export interface UserOAuthContext {
  provider: PersistentOAuthClientProvider;
  flow: HeadlessMcpOAuthFlow;
  persist(): Promise<void>;
  logout(): Promise<void>;
  cancel(): Promise<void>;
  authenticated(): Promise<boolean>;
}

export async function createUserOAuthContext(
  options: UserOAuthContextOptions,
): Promise<UserOAuthContext> {
  const provider = new PersistentOAuthClientProvider({
    configDir: options.store.configDir,
    serverUrl: options.serverUrl,
    redirectUrl: options.redirectUrl,
    scope: "mcp:tools offline_access",
    onTokensChanged: async (state) => {
      if (!state.tokens?.access_token) {
        await options.store.deleteOAuth(options.serverName);
        return;
      }
      await options.store.writeOAuth(options.serverName, {
        schema: PROJECTED_SCHEMA,
        serverUrl: options.serverUrl,
        state: structuredClone(state) as JsonObject,
      });
    },
  });
  const projection = projectedState(await options.store.readOAuth(options.serverName), options.serverUrl);
  const privateState = await provider.store.read();
  if (projection && !privateState.tokens?.access_token) {
    await provider.store.update(() => projection);
  }
  const flow = new HeadlessMcpOAuthFlow({
    serverUrl: options.serverUrl,
    provider,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  return {
    provider,
    flow,
    async persist() {
      const state = await provider.store.read();
      if (!state.tokens) throw new Error("MCP OAuth did not return credentials");
      await options.store.writeOAuth(options.serverName, {
        schema: PROJECTED_SCHEMA,
        serverUrl: options.serverUrl,
        state: structuredClone(state) as JsonObject,
      });
    },
    async logout() {
      provider.stopAcceptingMutations();
      await flow.logout();
      await options.store.deleteOAuth(options.serverName);
    },
    async cancel() {
      const preserveTokens = Boolean((await provider.tokens())?.access_token);
      provider.stopAcceptingMutations();
      const scope = preserveTokens ? "verifier" : "all";
      await provider.invalidateCredentials(scope).catch(() => undefined);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      await provider.invalidateCredentials(scope).catch(() => undefined);
    },
    async authenticated() {
      return Boolean((await provider.tokens())?.access_token);
    },
  };
}
