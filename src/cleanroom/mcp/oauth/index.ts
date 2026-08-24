// [Input] Clean-room MCP OAuth persistence, provider, flow, and probe modules.
// [Output] Stable public exports for registry integration and provider-free tests.
// [Pos] Public surface of the independently implemented clean-room MCP OAuth slice.
// [Sync] 2026-08-24: expose headless OAuth and unauthenticated probe contracts.

export {
  HeadlessMcpOAuthFlow,
  oauthNeedsAuthFromStatus,
  type HeadlessOAuthFlowOptions,
  type OAuthAuthorizationRequired,
  type OAuthFlowResult,
  type OAuthReady,
  type OAuthSafeError,
  type OAuthSafeErrorCode,
} from "./flow.ts";
export {
  OAuthStateMismatchError,
  PersistentOAuthClientProvider,
  type PendingAuthorization,
  type PersistentOAuthProviderOptions,
} from "./provider.ts";
export { probeUnauthenticatedMcpOAuth, type OAuthProbeResult } from "./probe.ts";
export { PrivateOAuthStore, type PersistedOAuthState } from "./store.ts";
