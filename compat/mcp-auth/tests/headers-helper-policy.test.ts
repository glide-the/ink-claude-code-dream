// [Input] Representative helper scopes, trust receipts, credential-bearing environments, headers, and log text.
// [Output] Contract assertions for cwd selection, credential removal, trust failure, and secret redaction.
// [Pos] Bun unit tests for the headers-helper compatibility policy and shared redaction boundary.

import { describe, expect, test } from "bun:test";

import {
  buildHeadersHelperLaunchPolicy,
  HeadersHelperPolicyError,
} from "../src/headers-helper-policy.ts";
import {
  REDACTED,
  redactEnvironment,
  redactHeaders,
  redactSensitiveText,
} from "../src/redaction.ts";

describe("headers helper launch policy", () => {
  const inheritedEnv = {
    PATH: "/usr/bin:/bin",
    HOME: "/Users/reviewer",
    LANG: "en_US.UTF-8",
    LC_CTYPE: "UTF-8",
    ANTHROPIC_API_KEY: "anthropic-secret",
    CLAUDE_CODE_OAUTH_TOKEN: "oauth-secret",
    MCP_CLIENT_SECRET: "mcp-secret",
    AWS_SECRET_ACCESS_KEY: "aws-secret",
    RANDOM_BUSINESS_FLAG: "should-not-inherit",
  };

  test("removes credential and non-allowlisted environment variables", () => {
    const policy = buildHeadersHelperLaunchPolicy({
      scope: "project",
      serverName: "calendar",
      serverUrl: "https://mcp.example.test",
      inheritedEnv,
      claudeConfigDir: "/Users/reviewer/.claude",
      originDir: "/work/accepted-project",
      trust: { workspaceAccepted: true },
    });

    expect(policy.cwd).toBe("/work/accepted-project");
    expect(policy.env).toEqual({
      PATH: "/usr/bin:/bin",
      HOME: "/Users/reviewer",
      LANG: "en_US.UTF-8",
      LC_CTYPE: "UTF-8",
      CLAUDE_CODE_MCP_SERVER_NAME: "calendar",
      CLAUDE_CODE_MCP_SERVER_URL: "https://mcp.example.test",
    });
  });

  test.each(["user", "managed", "claudeai"] as const)(
    "%s scope uses the Claude config directory",
    (scope) => {
      const policy = buildHeadersHelperLaunchPolicy({
        scope,
        serverName: "docs",
        inheritedEnv: { PATH: "/usr/bin" },
        claudeConfigDir: "/Users/reviewer/.claude",
        originDir: "/untrusted/project",
      });
      expect(policy.cwd).toBe("/Users/reviewer/.claude");
    },
  );

  test.each(["project", "local"] as const)(
    "%s scope uses the trusted origin directory",
    (scope) => {
      const policy = buildHeadersHelperLaunchPolicy({
        scope,
        serverName: "workspace-server",
        inheritedEnv: { PATH: "/usr/bin" },
        claudeConfigDir: "/Users/reviewer/.claude",
        originDir: "/work/trusted-origin",
        trust: { workspaceAccepted: true },
      });
      expect(policy.cwd).toBe("/work/trusted-origin");
    },
  );

  test.each(["project", "local"] as const)(
    "%s workspace scope fails closed without trust",
    (scope) => {
    expect(() => buildHeadersHelperLaunchPolicy({
      scope,
      serverName: "workspace-server",
      inheritedEnv: {},
      claudeConfigDir: "/Users/reviewer/.claude",
      originDir: "/work/project",
    })).toThrow(HeadersHelperPolicyError);
    },
  );

  test.each(["dynamic", "plugin", "enterprise", "unknown"] as const)(
    "%s scope fails closed even when a cwd and trust receipt are supplied",
    (scope) => {
      expect(() => buildHeadersHelperLaunchPolicy({
        scope,
        serverName: `${scope}-server`,
        inheritedEnv: {},
        claudeConfigDir: "/Users/reviewer/.claude",
        originDir: "/work/origin",
        trust: { workspaceAccepted: true, executionApproved: true },
      })).toThrow("does not have a safe launch mapping");
    },
  );

  test("credential-like extra allowlist keys are rejected", () => {
    expect(() => buildHeadersHelperLaunchPolicy({
      scope: "user",
      serverName: "docs",
      inheritedEnv: { CUSTOM_API_KEY: "secret" },
      claudeConfigDir: "/Users/reviewer/.claude",
      extraSafeEnvKeys: ["CUSTOM_API_KEY"],
    })).toThrow("not eligible");
  });
});

describe("secret redaction", () => {
  test("redacts sensitive headers, URLs, assignments, bearer tokens, and env values", () => {
    const secret = "secret-value-123";
    const headers = redactHeaders({
      Authorization: `Bearer ${secret}`,
      "X-Api-Key": secret,
      Accept: "application/json",
      "X-Debug-Url": `https://example.test/callback?access_token=${secret}&mode=test`,
    });
    const environment = redactEnvironment({
      MCP_CLIENT_SECRET: secret,
      SAFE_URL: `https://example.test?token=${secret}`,
    });
    const text = redactSensitiveText(
      `authorization=Bearer-${secret} password=${secret} Bearer ${secret}`,
    );
    const output = JSON.stringify({ headers, environment, text });

    expect(output).not.toContain(secret);
    expect(headers.Authorization).toBe(REDACTED);
    expect(headers.Accept).toBe("application/json");
    expect(output).toContain(REDACTED);
  });
});
