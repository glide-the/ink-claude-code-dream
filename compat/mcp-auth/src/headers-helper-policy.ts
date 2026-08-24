// [Input] Explicit helper scope, origin/config directories, trust decisions, and a candidate inherited environment.
// [Output] A fail-closed headers-helper launch policy containing only an approved cwd and minimal environment.
// [Pos] Clean-room policy boundary for future headersHelper integration; it does not spawn commands or read process.env.

import { isAbsolute, normalize } from "node:path";

import { isCredentialEnvironmentName } from "./redaction.ts";

export type HeadersHelperScope =
  | "project"
  | "local"
  | "plugin"
  | "user"
  | "managed"
  | "claudeai"
  | "enterprise"
  | "dynamic"
  | "unknown";

export interface HeadersHelperTrust {
  workspaceAccepted?: boolean;
  executionApproved?: boolean;
}

export interface HeadersHelperLaunchInput {
  scope: HeadersHelperScope;
  serverName: string;
  serverUrl?: string;
  inheritedEnv: Readonly<Record<string, string | undefined>>;
  claudeConfigDir: string;
  originDir?: string;
  trust?: HeadersHelperTrust;
  extraSafeEnvKeys?: readonly string[];
}

export interface HeadersHelperLaunchPolicy {
  cwd: string;
  env: Record<string, string>;
}

export type HeadersHelperPolicyErrorCode =
  | "INVALID_DIRECTORY"
  | "INVALID_ENVIRONMENT_KEY"
  | "MISSING_TRUST"
  | "UNSUPPORTED_SCOPE";

export class HeadersHelperPolicyError extends Error {
  readonly code: HeadersHelperPolicyErrorCode;

  constructor(code: HeadersHelperPolicyErrorCode, message: string) {
    super(message);
    this.name = "HeadersHelperPolicyError";
    this.code = code;
  }
}

const BASE_ENV_ALLOWLIST = new Set([
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TMPDIR",
  "TEMP",
  "TMP",
  "LANG",
  "TERM",
  "COLORTERM",
  "SystemRoot",
  "WINDIR",
  "PATHEXT",
  "ComSpec",
]);

const CONFIG_SCOPES = new Set<HeadersHelperScope>([
  "user",
  "managed",
  "claudeai",
]);

const WORKSPACE_SCOPES = new Set<HeadersHelperScope>([
  "project",
  "local",
]);

const FAIL_CLOSED_SCOPES = new Set<HeadersHelperScope>([
  "dynamic",
  "plugin",
  "enterprise",
  "unknown",
]);

export function buildHeadersHelperLaunchPolicy(
  input: HeadersHelperLaunchInput,
): HeadersHelperLaunchPolicy {
  const cwd = selectScopeCwd(input);
  const allowedNames = new Set(BASE_ENV_ALLOWLIST);

  for (const name of input.extraSafeEnvKeys ?? []) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || isCredentialEnvironmentName(name)) {
      throw new HeadersHelperPolicyError(
        "INVALID_ENVIRONMENT_KEY",
        `Environment key is not eligible for helper inheritance: ${name}`,
      );
    }
    allowedNames.add(name);
  }

  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(input.inheritedEnv)) {
    const localeVariable = name.startsWith("LC_");
    if ((allowedNames.has(name) || localeVariable) && typeof value === "string" && value.length > 0) {
      env[name] = value;
    }
  }

  env.CLAUDE_CODE_MCP_SERVER_NAME = input.serverName;
  if (input.serverUrl) {
    env.CLAUDE_CODE_MCP_SERVER_URL = input.serverUrl;
  }

  return { cwd, env };
}

function selectScopeCwd(input: HeadersHelperLaunchInput): string {
  if (CONFIG_SCOPES.has(input.scope)) {
    return requireAbsoluteDirectory(input.claudeConfigDir, "Claude config directory");
  }

  if (WORKSPACE_SCOPES.has(input.scope)) {
    if (input.trust?.workspaceAccepted !== true) {
      throw new HeadersHelperPolicyError(
        "MISSING_TRUST",
        `Workspace trust is required for ${input.scope}-scoped headers helpers`,
      );
    }
    return requireAbsoluteDirectory(input.originDir, "Workspace origin directory");
  }

  if (FAIL_CLOSED_SCOPES.has(input.scope)) {
    throw new HeadersHelperPolicyError(
      "UNSUPPORTED_SCOPE",
      `Headers helper scope does not have a safe launch mapping: ${input.scope}`,
    );
  }

  const exhaustiveScope: never = input.scope;
  throw new HeadersHelperPolicyError(
    "UNSUPPORTED_SCOPE",
    `Unsupported headers helper scope: ${String(exhaustiveScope)}`,
  );
}

function requireAbsoluteDirectory(value: string | undefined, label: string): string {
  if (!value || !isAbsolute(value)) {
    throw new HeadersHelperPolicyError(
      "INVALID_DIRECTORY",
      `${label} must be an absolute path`,
    );
  }
  return normalize(value);
}
