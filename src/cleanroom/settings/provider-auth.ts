// [Input] Validated Runtime settings and Anthropic provider environment variables.
// [Output] Anthropic SDK clients with direct or ephemeral helper authentication.
// [Pos] Provider-auth composition boundary; helper tokens exist only in process memory and request headers.
// [Sync] 2026-08-24: implement Dream apiKeyHelper subject-token contract with bounded in-memory TTL.

import Anthropic from "@anthropic-ai/sdk";
import { parseCustomHeaders } from "../headers.ts";
import { runApiKeyHelper } from "./helper.ts";
import type { RuntimeSettings } from "./settings.ts";

const DEFAULT_HELPER_TTL_MS = 300_000;
const MAX_HELPER_TTL_MS = 60 * 60 * 1000;

interface CachedToken {
  expiresAt: number;
  value: string;
}

function fail(): never {
  throw new Error("Provider authentication is invalid or unavailable");
}

function helperTtlMs(environment: NodeJS.ProcessEnv): number {
  const raw = environment.CLAUDE_CODE_API_KEY_HELPER_TTL_MS;
  if (raw === undefined || raw === "") return DEFAULT_HELPER_TTL_MS;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > MAX_HELPER_TTL_MS) fail();
  return parsed;
}

export class ProviderAuthentication {
  private cached: CachedToken | undefined;
  private readonly customHeaders: Record<string, string>;
  private readonly environment: NodeJS.ProcessEnv;
  private readonly settings: RuntimeSettings;

  constructor(
    settings: RuntimeSettings,
    environment: NodeJS.ProcessEnv = process.env,
  ) {
    this.settings = settings;
    this.environment = environment;
    this.customHeaders = parseCustomHeaders(environment.ANTHROPIC_CUSTOM_HEADERS);
  }

  source(): "ANTHROPIC_AUTH_TOKEN" | "ANTHROPIC_API_KEY" | "apiKeyHelper" | "none" {
    if (this.environment.ANTHROPIC_AUTH_TOKEN) return "ANTHROPIC_AUTH_TOKEN";
    if (this.environment.ANTHROPIC_API_KEY) return "ANTHROPIC_API_KEY";
    if (this.settings.apiKeyHelper) return "apiKeyHelper";
    return "none";
  }

  async prepare(): Promise<void> {
    if (this.source() === "apiKeyHelper") {
      await this.helperToken();
    }
  }

  async client(): Promise<Anthropic> {
    const authToken = this.environment.ANTHROPIC_AUTH_TOKEN || await this.helperToken();
    const apiKey = this.environment.ANTHROPIC_API_KEY || null;
    if (!authToken && !apiKey) fail();
    return new Anthropic({
      apiKey,
      authToken: authToken || null,
      baseURL: this.environment.ANTHROPIC_BASE_URL || undefined,
      defaultHeaders: this.customHeaders,
      maxRetries: 0,
    });
  }

  private async helperToken(): Promise<string | null> {
    if (!this.settings.apiKeyHelper) return null;
    const now = Date.now();
    if (this.cached && this.cached.expiresAt > now) return this.cached.value;
    const value = await runApiKeyHelper(this.settings.apiKeyHelper, this.environment);
    this.cached = { value, expiresAt: now + helperTtlMs(this.environment) };
    return value;
  }
}
