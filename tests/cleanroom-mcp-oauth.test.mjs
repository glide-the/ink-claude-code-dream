#!/usr/bin/env node
// [Input] Local provider-free OAuth/DCR fixture and clean-room persistent OAuth modules.
// [Output] Evidence for PKCE, callbacks, refresh, permissions, logout, probes, and safe errors.
// [Pos] Provider-free clean-room MCP OAuth contract test; it never opens a browser or uses a real token.
// [Sync] 2026-08-25: preserve OAuth lifecycle while proving marker-free projected-token reuse.

import assert from "node:assert/strict";
import { once } from "node:events";
import { lstat, mkdtemp, mkdir, readFile, rm, symlink } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  HeadlessMcpOAuthFlow,
  PersistentOAuthClientProvider,
  oauthNeedsAuthFromStatus,
  probeUnauthenticatedMcpOAuth,
} from "../src/cleanroom/mcp/oauth/index.ts";
import { createMcpRegistryFromArgv, McpRegistry } from "../src/cleanroom/mcp/index.ts";
import {
  createUserOAuthContext,
  UserMcpStateStore,
} from "../src/cleanroom/mcp/management-cli/index.ts";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

async function startOAuthFixture(options = {}) {
  const events = [];
  let origin;
  let validAccessToken = "fixture-access-secret";
  let validRefreshToken = "fixture-refresh-secret";
  let refreshCount = 0;
  let rejectRefresh = false;
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, origin);
    const authorization = request.headers.authorization;
    events.push({
      method: request.method,
      path: url.pathname,
      authorization: authorization === "Bearer fixture-refreshed-secret"
        ? "refreshed"
        : authorization
        ? "other"
        : "none",
    });
    if (url.pathname === "/mcp" && request.headers.authorization !== `Bearer ${validAccessToken}`) {
      response.writeHead(401, {
        "content-type": "application/json",
        "www-authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp", error="invalid_token"`,
      });
      response.end('{"error":"authorization_required"}');
      return;
    }
    if (request.method === "POST" && url.pathname === "/mcp") {
      const message = JSON.parse(await readRequestBody(request));
      events.at(-1).rpcMethod = message.method;
      if (message.method === "notifications/initialized") {
        response.writeHead(202);
        response.end();
        return;
      }
      let result;
      if (message.method === "initialize") {
        result = {
          protocolVersion: "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "oauth-fixture", version: "1.0.0" },
        };
      } else if (message.method === "tools/list") {
        result = {
          tools: [{
            name: "echo",
            description: "OAuth echo",
            inputSchema: { type: "object", properties: { message: { type: "string" } } },
          }],
        };
      } else if (message.method === "tools/call") {
        result = { content: [{ type: "text", text: `oauth:${message.params.arguments.message}` }] };
      } else {
        result = {};
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
      return;
    }
    if (request.method === "GET" && url.pathname === "/mcp") {
      response.writeHead(405, { "content-type": "application/json" });
      response.end('{"error":"method_not_allowed"}');
      return;
    }
    if (
      request.method === "GET" &&
      (url.pathname === "/.well-known/oauth-protected-resource/mcp" ||
        url.pathname === "/.well-known/oauth-protected-resource")
    ) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        resource: options.invalidResource ? `${origin}/other` : `${origin}/mcp`,
        authorization_servers: [origin],
        scopes_supported: ["mcp:tools", "offline_access"],
      }));
      return;
    }
    if (request.method === "GET" && url.pathname === "/.well-known/oauth-authorization-server") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        issuer: origin,
        authorization_endpoint: `${origin}/authorize`,
        token_endpoint: `${origin}/token`,
        registration_endpoint: `${origin}/register`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        token_endpoint_auth_methods_supported: ["none"],
        code_challenge_methods_supported: ["S256"],
      }));
      return;
    }
    if (request.method === "POST" && url.pathname === "/register") {
      const metadata = JSON.parse(await readRequestBody(request));
      events.at(-1).body = metadata;
      response.writeHead(201, { "content-type": "application/json" });
      response.end(JSON.stringify({ ...metadata, client_id: "fixture-client" }));
      return;
    }
    if (request.method === "POST" && url.pathname === "/token") {
      const body = new URLSearchParams(await readRequestBody(request));
      events.at(-1).grantType = body.get("grant_type");
      if (body.get("grant_type") === "authorization_code") {
        assert.equal(body.get("code"), "fixture-code");
        assert.match(body.get("code_verifier"), /^[A-Za-z0-9._~-]{43,128}$/);
        validAccessToken = "fixture-access-secret";
        validRefreshToken = "fixture-refresh-secret";
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({
          access_token: "fixture-access-secret",
          refresh_token: "fixture-refresh-secret",
          token_type: "Bearer",
          expires_in: 60,
        }));
        return;
      }
      if (body.get("grant_type") === "refresh_token") {
        if (rejectRefresh) {
          response.writeHead(400, { "content-type": "application/json" });
          response.end('{"error":"invalid_grant"}');
          return;
        }
        assert.equal(body.get("refresh_token"), validRefreshToken);
        refreshCount += 1;
        validAccessToken = refreshCount === 1
          ? "fixture-refreshed-secret"
          : `fixture-refreshed-secret-${refreshCount}`;
        validRefreshToken = `fixture-rotated-refresh-secret-${refreshCount}`;
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({
          access_token: validAccessToken,
          refresh_token: validRefreshToken,
          token_type: "Bearer",
          expires_in: 60,
        }));
        return;
      }
      response.writeHead(400, { "content-type": "application/json" });
      response.end('{"error":"unsupported_grant_type"}');
      return;
    }
    response.writeHead(404, { "content-type": "application/json" });
    response.end('{"error":"not_found"}');
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");
  origin = `http://127.0.0.1:${address.port}`;
  return {
    events,
    serverUrl: `${origin}/mcp`,
    expireAccess() {
      validAccessToken = "fixture-no-longer-valid";
    },
    rejectRefresh() {
      rejectRefresh = true;
    },
    close: async () => {
      server.close();
      await once(server, "close");
    },
  };
}

test("headless OAuth performs DCR, PKCE callback, refresh, persistence, and logout", async () => {
  const directory = await mkdtemp(path.join(repositoryRoot, "tests", ".cleanroom-oauth-"));
  const configDir = path.join(directory, "config");
  const fixture = await startOAuthFixture();
  try {
    const provider = new PersistentOAuthClientProvider({
      configDir,
      serverUrl: fixture.serverUrl,
      redirectUrl: "http://127.0.0.1/oauth/callback",
      scope: "mcp:tools offline_access",
    });
    const flow = new HeadlessMcpOAuthFlow({ serverUrl: fixture.serverUrl, provider });
    const begun = await flow.begin();
    assert.equal(begun.ok, true);
    assert.equal(begun.status, "authorization-required");
    const authorizationUrl = new URL(begun.authorizationUrl);
    assert.equal(authorizationUrl.origin + authorizationUrl.pathname, fixture.serverUrl.replace("/mcp", "/authorize"));
    assert.equal(authorizationUrl.searchParams.get("client_id"), "fixture-client");
    assert.equal(authorizationUrl.searchParams.get("code_challenge_method"), "S256");
    assert.match(authorizationUrl.searchParams.get("code_challenge"), /^[A-Za-z0-9_-]+$/);
    assert.equal(authorizationUrl.searchParams.get("state"), begun.state);
    assert.equal(authorizationUrl.searchParams.get("prompt"), "consent");

    const wrongState = await flow.completeCallback({ code: "fixture-code", state: "wrong" });
    assert.deepEqual(wrongState, {
      ok: false,
      status: "needs-auth",
      code: "oauth_state_mismatch",
      message: "OAuth callback validation failed",
      retryable: false,
    });
    const completed = await flow.completeCallback({ code: "fixture-code", state: begun.state });
    assert.deepEqual(completed, { ok: true, status: "ready" });
    assert.equal((await provider.tokens()).access_token, "fixture-access-secret");

    const statePath = path.join(configDir, provider.store.relativeStatePath);
    const [rootInfo, oauthInfo, fileInfo] = await Promise.all([
      lstat(configDir),
      lstat(path.dirname(statePath)),
      lstat(statePath),
    ]);
    assert.equal(rootInfo.mode & 0o777, 0o700);
    assert.equal(oauthInfo.mode & 0o777, 0o700);
    assert.equal(fileInfo.mode & 0o777, 0o600);

    const restoredProvider = new PersistentOAuthClientProvider({
      configDir,
      serverUrl: fixture.serverUrl,
      redirectUrl: "http://127.0.0.1/oauth/callback",
    });
    assert.equal((await restoredProvider.tokens()).access_token, "fixture-access-secret");
    assert.equal((await restoredProvider.clientInformation()).client_id, "fixture-client");
    const restoredFlow = new HeadlessMcpOAuthFlow({
      serverUrl: fixture.serverUrl,
      provider: restoredProvider,
    });
    assert.deepEqual(await restoredFlow.refresh(), { ok: true, status: "refreshed" });
    assert.equal((await restoredProvider.tokens()).access_token, "fixture-refreshed-secret");
    assert.deepEqual(await restoredFlow.logout(), { ok: true, status: "logged-out" });
    assert.equal(await restoredProvider.tokens(), undefined);
    await assert.rejects(readFile(statePath, "utf8"), { code: "ENOENT" });

    assert.equal(fixture.events.filter(({ path: requestPath }) => requestPath === "/register").length, 1);
    assert.deepEqual(
      fixture.events.filter(({ path: requestPath }) => requestPath === "/token").map(({ grantType }) => grantType),
      ["authorization_code", "refresh_token"],
    );
  } finally {
    await fixture.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("storage rejects symlinked config roots and OAuth errors never expose fixture secrets", async () => {
  const directory = await mkdtemp(path.join(repositoryRoot, "tests", ".cleanroom-oauth-"));
  const realConfig = path.join(directory, "real-config");
  const linkedConfig = path.join(directory, "linked-config");
  await mkdir(realConfig, { mode: 0o700 });
  await symlink(realConfig, linkedConfig);
  try {
    const provider = new PersistentOAuthClientProvider({
      configDir: linkedConfig,
      serverUrl: "https://example.invalid/mcp",
      redirectUrl: "http://127.0.0.1/oauth/callback",
    });
    const result = await new HeadlessMcpOAuthFlow({
      serverUrl: "https://example.invalid/mcp",
      provider,
      fetch: async () => {
        throw new Error("fixture-access-secret fixture-refresh-secret");
      },
    }).begin();
    assert.equal(result.ok, false);
    assert.equal(result.code, "oauth_failed");
    assert.doesNotMatch(JSON.stringify(result), /fixture-(?:access|refresh)-secret/);

    const traversedProvider = new PersistentOAuthClientProvider({
      configDir: path.join(linkedConfig, "must-not-create"),
      serverUrl: "https://example.invalid/mcp",
      redirectUrl: "http://127.0.0.1/oauth/callback",
    });
    await assert.rejects(
      traversedProvider.store.update((state) => state),
      /must not traverse symlinks/,
    );
    await assert.rejects(lstat(path.join(realConfig, "must-not-create")), { code: "ENOENT" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("cancelling a new login clears pending state but preserves a working projected token", async () => {
  const directory = await mkdtemp(path.join(repositoryRoot, "tests", ".cleanroom-oauth-"));
  const configDir = path.join(directory, "config");
  const store = await UserMcpStateStore.open(configDir);
  const context = await createUserOAuthContext({
    store,
    serverName: "cancel:fixture",
    serverUrl: "https://example.invalid/mcp",
    redirectUrl: "http://127.0.0.1/oauth/callback",
  });
  try {
    await context.provider.saveTokens({
      access_token: "fixture-working-secret",
      refresh_token: "fixture-refresh-secret",
      token_type: "Bearer",
    });
    await context.provider.saveCodeVerifier("fixture-pending-verifier");
    await context.cancel();
    const privateState = await context.provider.store.read();
    assert.equal(privateState.tokens.access_token, "fixture-working-secret");
    assert.equal(privateState.codeVerifier, undefined);
    const projected = await store.readOAuth("cancel:fixture");
    assert.equal(projected.state.tokens.access_token, "fixture-working-secret");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("unauthenticated probe reports challenge/discovery and never sends authorization", async () => {
  const fixture = await startOAuthFixture();
  const observedHeaders = [];
  try {
    const result = await probeUnauthenticatedMcpOAuth(fixture.serverUrl, async (input, init) => {
      const headers = new Headers(init?.headers);
      observedHeaders.push(headers);
      assert.equal(headers.has("authorization"), false);
      return fetch(input, init);
    });
    assert.equal(result.challengeStatus, 401);
    assert.equal(result.challengeScheme, "Bearer");
    assert.equal(result.challengeError, "invalid_token");
    assert.equal(result.authorizationEndpoint.endsWith("/authorize"), true);
    assert.equal(result.tokenEndpoint.endsWith("/token"), true);
    assert.equal(result.registrationEndpoint.endsWith("/register"), true);
    assert(observedHeaders.length >= 3);
    assert.equal(oauthNeedsAuthFromStatus(401)?.code, "oauth_required");
    assert.equal(oauthNeedsAuthFromStatus(403), undefined);
    assert.equal(oauthNeedsAuthFromStatus(500), undefined);
  } finally {
    await fixture.close();
  }
});

test("registry exposes authorization URL, finishes callback, reconnects, and logs out", async () => {
  const directory = await mkdtemp(path.join(repositoryRoot, "tests", ".cleanroom-oauth-"));
  const configDir = path.join(directory, "config");
  const fixture = await startOAuthFixture();
  const configs = new Map([
    ["cloud:fixture", {
      type: "http",
      url: fixture.serverUrl,
      headers: {},
      enabled: true,
      requiresOAuth: true,
    }],
  ]);
  const registry = new McpRegistry(configs, {
    oauthProviderFactory: (_serverName, config) => new PersistentOAuthClientProvider({
      configDir,
      serverUrl: config.url,
      redirectUrl: "http://127.0.0.1/oauth/callback",
      scope: "mcp:tools offline_access",
    }),
  });
  try {
    const pending = await registry.connect("cloud:fixture");
    assert.equal(pending.status, "needs-auth");
    assert.equal(pending.error, "MCP authorization is required");
    assert.equal(new URL(pending.oauth.authorizationUrl).pathname, "/authorize");
    assert.equal(new URL(pending.oauth.authorizationUrl).searchParams.get("state"), pending.oauth.state);

    const wrong = await registry.finishAuth("cloud:fixture", {
      code: "fixture-code",
      state: "wrong",
    });
    assert.equal(wrong.status, "needs-auth");
    assert.equal(wrong.error, "OAuth callback validation failed");

    const connected = await registry.finishAuth("cloud:fixture", {
      code: "fixture-code",
      state: pending.oauth.state,
    });
    assert.equal(connected.status, "connected", connected.error);
    assert.equal(connected.serverInfo.name, "oauth-fixture");
    assert.equal(
      (await registry.callTool("cloud:fixture", "echo", { message: "ok" })).content[0].text,
      "oauth:ok",
    );

    const loggedOut = await registry.logoutOAuth("cloud:fixture");
    assert.equal(loggedOut.status, "needs-auth");
    assert.equal(loggedOut.error, "MCP authorization is required");
    const reconnected = await registry.reconnect("cloud:fixture");
    assert.equal(reconnected.status, "needs-auth");
    assert.equal(new URL(reconnected.oauth.authorizationUrl).pathname, "/authorize");
  } finally {
    await registry.close();
    await fixture.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("registry classifies invalid protected-resource metadata without exposing it", async () => {
  const directory = await mkdtemp(path.join(repositoryRoot, "tests", ".cleanroom-oauth-"));
  const configDir = path.join(directory, "config");
  const fixture = await startOAuthFixture({ invalidResource: true });
  const configs = new Map([
    ["invalid:metadata", {
      type: "http",
      url: fixture.serverUrl,
      headers: {},
      enabled: true,
      requiresOAuth: true,
    }],
  ]);
  const registry = new McpRegistry(configs, {
    oauthProviderFactory: (_serverName, config) => new PersistentOAuthClientProvider({
      configDir,
      serverUrl: config.url,
      redirectUrl: "http://127.0.0.1/oauth/callback",
    }),
  });
  try {
    const classified = await registry.connect("invalid:metadata");
    assert.equal(classified.status, "failed");
    assert.equal(classified.authentication, "unknown");
    assert.equal(classified.failureCode, "mcp_auth_metadata_invalid");
    assert.equal(classified.error, "MCP authorization metadata is invalid");
    assert.equal(JSON.stringify(classified).includes(fixture.serverUrl), false);
  } finally {
    await registry.close();
    await fixture.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("registry refreshes an expired projected access token before MCP discovery", async () => {
  const directory = await mkdtemp(path.join(repositoryRoot, "tests", ".cleanroom-oauth-"));
  const configDir = path.join(directory, "config");
  const fixture = await startOAuthFixture();
  const serverName = "cloud:projected";
  try {
    const store = await UserMcpStateStore.open(configDir);
    await store.writeOAuth(serverName, {
      schema: "ink-cleanroom-mcp-oauth/v1",
      serverUrl: fixture.serverUrl,
      state: {
        clientInformation: {
          client_id: "fixture-client",
          redirect_uris: ["http://127.0.0.1/oauth/callback"],
          token_endpoint_auth_method: "none",
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          client_name: "Ink Runtime fixture",
        },
        tokens: {
          access_token: "fixture-expired-secret",
          refresh_token: "fixture-refresh-secret",
          token_type: "Bearer",
          expires_in: 1,
        },
      },
    });

    const argv = [
      "--mcp-config",
      JSON.stringify({
        mcpServers: {
          [serverName]: { type: "http", url: fixture.serverUrl },
        },
      }),
    ];
    const registry = await createMcpRegistryFromArgv(argv, {
      projectedOAuthIdentity: {
        configDir,
        redirectUrl: "http://127.0.0.1/oauth/callback",
      },
    });
    try {
      const [connected] = await registry.connectAll();
      assert.equal(connected.status, "connected", connected.error);
      assert.equal(connected.tools[0].name, "echo");
      const mcpAuthorization = fixture.events
        .filter(({ path: requestPath }) => requestPath === "/mcp")
        .map(({ authorization: kind }) => kind);
      assert.equal(mcpAuthorization[0], "other");
      assert(mcpAuthorization.length >= 4);
      assert(mcpAuthorization.slice(1).every((kind) => kind === "refreshed"));
      assert.deepEqual(
        fixture.events
          .filter(({ path: requestPath }) => requestPath === "/token")
          .map(({ grantType }) => grantType),
        ["refresh_token"],
      );
      const projected = await store.readOAuth(serverName);
      assert.equal(projected.state.tokens.access_token, "fixture-refreshed-secret");
      assert.equal(projected.state.tokens.refresh_token, "fixture-rotated-refresh-secret-1");
      assert.equal(
        (await registry.callTool(serverName, "echo", { message: "projected" })).content[0].text,
        "oauth:projected",
      );
    } finally {
      await registry.close();
    }

    fixture.expireAccess();
    const restarted = await createMcpRegistryFromArgv(argv, {
      projectedOAuthIdentity: {
        configDir,
        redirectUrl: "http://127.0.0.1/oauth/callback",
      },
    });
    try {
      const [connected] = await restarted.connectAll();
      assert.equal(connected.status, "connected", connected.error);
      assert.deepEqual(
        fixture.events
          .filter(({ path: requestPath }) => requestPath === "/token")
          .map(({ grantType }) => grantType),
        ["refresh_token", "refresh_token"],
      );
      const reprojected = await store.readOAuth(serverName);
      assert.equal(reprojected.state.tokens.access_token, "fixture-refreshed-secret-2");
      assert.equal(reprojected.state.tokens.refresh_token, "fixture-rotated-refresh-secret-2");
    } finally {
      await restarted.close();
    }
  } finally {
    await fixture.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("an unrecoverable projected refresh failure deletes stale tokens and enters needs-auth", async () => {
  const directory = await mkdtemp(path.join(repositoryRoot, "tests", ".cleanroom-oauth-"));
  const configDir = path.join(directory, "config");
  const fixture = await startOAuthFixture();
  const serverName = "cloud:invalid-refresh";
  try {
    const store = await UserMcpStateStore.open(configDir);
    await store.writeOAuth(serverName, {
      schema: "ink-cleanroom-mcp-oauth/v1",
      serverUrl: fixture.serverUrl,
      state: {
        clientInformation: { client_id: "fixture-client" },
        tokens: {
          access_token: "fixture-expired-secret",
          refresh_token: "fixture-refresh-secret",
          token_type: "Bearer",
        },
      },
    });
    fixture.rejectRefresh();
    const registry = await createMcpRegistryFromArgv([
      "--mcp-config",
      JSON.stringify({
        mcpServers: {
          [serverName]: { type: "http", url: fixture.serverUrl, oauth: true },
        },
      }),
    ], {
      projectedOAuthIdentity: {
        configDir,
        redirectUrl: "http://127.0.0.1/oauth/callback",
      },
    });
    try {
      const [pending] = await registry.connectAll();
      assert.equal(pending.status, "needs-auth");
      assert.equal(pending.error, "MCP authorization is required");
      assert.equal(new URL(pending.oauth.authorizationUrl).pathname, "/authorize");
      assert.equal(await store.readOAuth(serverName), undefined);
    } finally {
      await registry.close();
    }
  } finally {
    await fixture.close();
    await rm(directory, { recursive: true, force: true });
  }
});
