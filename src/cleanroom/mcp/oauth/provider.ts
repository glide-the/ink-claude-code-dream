// [Input] PrivateOAuthStore, public OAuth client metadata, and SDK OAuth lifecycle callbacks.
// [Output] Persistent public OAuthClientProvider with token synchronization and terminal mutation fencing.
// [Pos] Adapter between the official MCP SDK OAuth flow and private clean-room persistence.
// [Sync] 2026-08-24: synchronize token rotation and fence late writes after a cancelled login.

import { randomBytes } from "node:crypto";
import type {
  OAuthClientProvider,
  OAuthDiscoveryState,
} from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { PrivateOAuthStore, type PersistedOAuthState } from "./store.ts";

export interface PersistentOAuthProviderOptions {
  configDir: string;
  serverUrl: string;
  redirectUrl: string;
  clientName?: string;
  clientUri?: string;
  scope?: string;
  softwareVersion?: string;
  onTokensChanged?: (state: PersistedOAuthState) => Promise<void>;
}

export interface PendingAuthorization {
  authorizationUrl: string;
  state: string;
}

export class PersistentOAuthClientProvider implements OAuthClientProvider {
  readonly redirectUrl: string;
  readonly clientMetadata: OAuthClientMetadata;
  readonly store: PrivateOAuthStore;
  private readonly onTokensChanged?: PersistentOAuthProviderOptions["onTokensChanged"];
  private pendingAuthorization?: PendingAuthorization;
  private acceptingMutations = true;

  constructor(options: PersistentOAuthProviderOptions) {
    const redirectUrl = new URL(options.redirectUrl);
    if (redirectUrl.protocol !== "http:" && redirectUrl.protocol !== "https:") {
      throw new Error("OAuth redirect URL must use http or https");
    }
    this.redirectUrl = redirectUrl.href;
    this.store = new PrivateOAuthStore(options.configDir, options.serverUrl);
    this.onTokensChanged = options.onTokensChanged;
    this.clientMetadata = {
      redirect_uris: [this.redirectUrl],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      client_name: options.clientName ?? "Ink Claude Code Dream",
      ...(options.clientUri ? { client_uri: new URL(options.clientUri).href } : {}),
      ...(options.scope ? { scope: options.scope } : {}),
      software_id: "ink-claude-code-dream",
      software_version: options.softwareVersion ?? "0.1.0",
    };
  }

  async state(): Promise<string> {
    this.requireAcceptingMutations();
    const existing = (await this.store.read()).callbackState;
    if (existing) return existing;
    this.requireAcceptingMutations();
    const value = randomBytes(32).toString("base64url");
    await this.store.update((current) => ({ ...current, callbackState: value }));
    return value;
  }

  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    return (await this.store.read()).clientInformation;
  }

  async saveClientInformation(clientInformation: OAuthClientInformationMixed): Promise<void> {
    this.requireAcceptingMutations();
    await this.store.update((current) => ({ ...current, clientInformation }));
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    return (await this.store.read()).tokens;
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    this.requireAcceptingMutations();
    await this.store.update((current) => ({ ...current, tokens }));
    await this.notifyTokensChanged();
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    this.requireAcceptingMutations();
    const state = await this.state();
    this.requireAcceptingMutations();
    this.pendingAuthorization = { authorizationUrl: authorizationUrl.href, state };
  }

  takePendingAuthorization(): PendingAuthorization | undefined {
    const pending = this.pendingAuthorization;
    this.pendingAuthorization = undefined;
    return pending ? { ...pending } : undefined;
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    this.requireAcceptingMutations();
    await this.store.update((current) => ({ ...current, codeVerifier }));
  }

  async codeVerifier(): Promise<string> {
    const verifier = (await this.store.read()).codeVerifier;
    if (!verifier) throw new Error("OAuth PKCE verifier is unavailable");
    return verifier;
  }

  async saveDiscoveryState(discoveryState: OAuthDiscoveryState): Promise<void> {
    this.requireAcceptingMutations();
    await this.store.update((current) => ({ ...current, discoveryState }));
  }

  async discoveryState(): Promise<OAuthDiscoveryState | undefined> {
    return (await this.store.read()).discoveryState;
  }

  async invalidateCredentials(
    scope: "all" | "client" | "tokens" | "verifier" | "discovery",
  ): Promise<void> {
    if (scope === "all") {
      this.pendingAuthorization = undefined;
      await this.store.clear();
      await this.notifyTokensChanged();
      return;
    }
    await this.store.update((current) => {
      const next = { ...current };
      if (scope === "client") delete next.clientInformation;
      if (scope === "tokens") delete next.tokens;
      if (scope === "verifier") {
        delete next.codeVerifier;
        delete next.callbackState;
        this.pendingAuthorization = undefined;
      }
      if (scope === "discovery") delete next.discoveryState;
      return next;
    });
    if (scope === "tokens") await this.notifyTokensChanged();
  }

  async assertCallbackState(received: string | undefined): Promise<void> {
    const expected = (await this.store.read()).callbackState;
    if (!expected || !received || received !== expected) {
      throw new OAuthStateMismatchError();
    }
  }

  async completeCallback(): Promise<void> {
    this.requireAcceptingMutations();
    await this.store.update((current) => {
      const next = { ...current };
      delete next.codeVerifier;
      delete next.callbackState;
      return next;
    });
    this.pendingAuthorization = undefined;
  }

  stopAcceptingMutations(): void {
    this.acceptingMutations = false;
    this.pendingAuthorization = undefined;
  }

  private async notifyTokensChanged(): Promise<void> {
    if (!this.onTokensChanged) return;
    await this.onTokensChanged(await this.store.read());
  }

  private requireAcceptingMutations(): void {
    if (!this.acceptingMutations) throw new Error("OAuth provider is closed");
  }
}

export class OAuthStateMismatchError extends Error {
  constructor() {
    super("OAuth callback state mismatch");
    this.name = "OAuthStateMismatchError";
  }
}
