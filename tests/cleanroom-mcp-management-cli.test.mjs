#!/usr/bin/env node
// [Input] Provider-free OAuth HTTP fixture and isolated canonical CLAUDE_CONFIG_DIR roots.
// [Output] Evidence for all Dream MCP management argv, persistence, process reuse, safety, and timeout.
// [Pos] Process/API contract test for the clean-room Dream Resources management CLI.
// [Sync] 2026-08-25: cover config-free help, anonymous-first status, safe failure codes, and logout reclassification.

import assert from "node:assert/strict";
import { once } from "node:events";
import { lstat, mkdtemp, mkdir, readdir, readFile, realpath, rm, symlink } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runMcpManagementCli } from "../src/cleanroom/mcp/management-cli/index.ts";
import { createMcpRegistryFromArgv } from "../src/cleanroom/mcp/index.ts";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function canonicalTemp() {
  return realpath(await mkdtemp(path.join(repositoryRoot, "tests", ".cleanroom-mcp-management-")));
}

async function removeFixtureDirectory(directory) {
  await rm(directory, { recursive: true, force: true });
  await new Promise((resolve) => setTimeout(resolve, 10));
  await rm(directory, { recursive: true, force: true });
}

function captureOptions(configDir, overrides = {}) {
  const stdout = [];
  const stderr = [];
  return {
    stdout,
    stderr,
    options: {
      env: { CLAUDE_CONFIG_DIR: configDir },
      stdout: (value) => stdout.push(value),
      stderr: (value) => stderr.push(value),
      ...overrides,
    },
  };
}

async function runChild(configDir, argv) {
  const child = spawn(path.join(repositoryRoot, "node_modules", ".bin", "bun"), [
    path.join(repositoryRoot, "src/cleanroom/cli.ts"),
    ...argv,
  ], {
    cwd: repositoryRoot,
    env: { ...process.env, CLAUDE_CONFIG_DIR: configDir },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout = [];
  const stderr = [];
  child.stdout.on("data", (chunk) => stdout.push(chunk));
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  const [code] = await once(child, "exit");
  return {
    code,
    stdout: Buffer.concat(stdout).toString("utf8"),
    stderr: Buffer.concat(stderr).toString("utf8"),
  };
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

async function startOAuthFixture(options = {}) {
  let origin;
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, origin);
    if (url.pathname === "/mcp" && options.mcpStatus) {
      response.writeHead(options.mcpStatus, { "content-type": "application/json" });
      response.end('{"error":"fixture_rejected"}');
      return;
    }
    if (
      url.pathname === "/mcp" &&
      !options.anonymous &&
      request.headers.authorization !== "Bearer fixture-access-token"
    ) {
      response.writeHead(401, {
        "content-type": "application/json",
        "www-authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`,
      });
      response.end('{"error":"authorization_required"}');
      return;
    }
    if (request.method === "POST" && url.pathname === "/mcp") {
      const message = JSON.parse(await readBody(request));
      if (message.method === "notifications/initialized") {
        response.writeHead(202).end();
        return;
      }
      const results = {
        initialize: {
          protocolVersion: "2025-06-18",
          capabilities: { tools: {}, resources: {}, prompts: {} },
          serverInfo: { name: "management-fixture", version: "1.0.0" },
        },
        "tools/list": { tools: [] },
        "resources/list": { resources: [] },
        "prompts/list": { prompts: [] },
      };
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        jsonrpc: "2.0",
        id: message.id,
        result: results[message.method] ?? {},
      }));
      return;
    }
    if (request.method === "GET" && url.pathname === "/mcp") {
      response.writeHead(405).end();
      return;
    }
    if (url.pathname === "/.well-known/oauth-protected-resource/mcp" || url.pathname === "/.well-known/oauth-protected-resource") {
      if (options.discoveryDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, options.discoveryDelayMs));
      }
      if (options.advertiseOAuth === false) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        resource: options.invalidMetadata ? `${origin}/other` : `${origin}/mcp`,
        authorization_servers: [origin],
      }));
      return;
    }
    if (url.pathname === "/.well-known/oauth-authorization-server") {
      if (options.advertiseOAuth === false) {
        response.writeHead(404).end();
        return;
      }
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
      const metadata = JSON.parse(await readBody(request));
      response.writeHead(201, { "content-type": "application/json" });
      response.end(JSON.stringify({ ...metadata, client_id: "management-fixture" }));
      return;
    }
    if (request.method === "POST" && url.pathname === "/token") {
      const body = new URLSearchParams(await readBody(request));
      assert.equal(body.get("code"), "fixture-code");
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        access_token: "fixture-access-token",
        refresh_token: "fixture-refresh-token",
        token_type: "Bearer",
      }));
      return;
    }
    response.writeHead(404).end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");
  origin = `http://127.0.0.1:${address.port}`;
  return {
    serverUrl: `${origin}/mcp`,
    async close() {
      server.close();
      await once(server, "close");
    },
  };
}

test("help and user HTTP config commands match Dream parser output and survive a new process", async () => {
  const directory = await canonicalTemp();
  const configDir = path.join(directory, "config");
  const fixture = await startOAuthFixture({ anonymous: true, advertiseOAuth: false });
  try {
    const standaloneHelp = { stdout: [], stderr: [] };
    assert.equal(await runMcpManagementCli(["mcp", "--help"], {
      env: {},
      stdout: async (text) => { standaloneHelp.stdout.push(text); },
      stderr: async (text) => { standaloneHelp.stderr.push(text); },
    }), 0);
    assert.match(standaloneHelp.stdout.join(""), /Usage: claude mcp/);
    assert.equal(standaloneHelp.stderr.join(""), "");

    for (const subject of ["add", "remove", "login", "logout"]) {
      const capture = captureOptions(configDir);
      assert.equal(await runMcpManagementCli(["mcp", subject, "--help"], capture.options), 0);
      assert.match(capture.stdout.join(""), new RegExp(subject));
    }

    const name = "user:comfy:cloud";
    const added = captureOptions(configDir);
    assert.equal(await runMcpManagementCli([
      "mcp", "add", "--transport", "http", "--scope", "user", name,
      fixture.serverUrl,
    ], added.options), 0);
    assert.match(added.stdout.join(""), /Added HTTP MCP server user:comfy:cloud/);

    const [rootInfo, configInfo] = await Promise.all([
      lstat(configDir),
      lstat(path.join(configDir, ".claude.json")),
    ]);
    assert.equal(rootInfo.mode & 0o777, 0o700);
    assert.equal(configInfo.mode & 0o777, 0o600);
    const stored = JSON.parse(await readFile(path.join(configDir, ".claude.json"), "utf8"));
    assert.equal(stored.mcpServers[name].url, fixture.serverUrl);
    assert.equal("oauth" in stored.mcpServers[name], false);

    const listed = await runChild(configDir, ["mcp", "list"]);
    assert.equal(listed.code, 0, listed.stderr);
    assert.match(listed.stdout, /user:comfy:cloud: http - ✓ Connected/);
    assert.doesNotMatch(listed.stdout, /Authentication:|Failure-Code:/);
    assert.deepEqual(listed.stdout.trim().split("\n").length, 2);
    assert.equal(listed.stdout.includes(configDir), false);

    const got = await runChild(configDir, ["mcp", "get", name]);
    assert.equal(got.code, 0, got.stderr);
    assert.match(got.stdout, /Scope: User config \(available in all your projects\)/);
    assert.match(got.stdout, /Status: ✓ Connected/);
    assert.match(got.stdout, /Authentication: anonymous/);
    assert.doesNotMatch(got.stdout, /Failure-Code:/);

    const removed = captureOptions(configDir);
    assert.equal(await runMcpManagementCli(
      ["mcp", "remove", "--scope", "user", name],
      removed.options,
    ), 0);
    const missing = await runChild(configDir, ["mcp", "get", name]);
    assert.equal(missing.code, 1);
    assert.match(missing.stderr, /No MCP server named/);
  } finally {
    await fixture.close();
    await removeFixtureDirectory(directory);
  }
});

test("headless OAuth persists a Dream projection, is reused by get, and logout revokes it", async () => {
  const directory = await canonicalTemp();
  const configDir = path.join(directory, "config");
  const fixture = await startOAuthFixture();
  const name = "cloud:fixture";
  try {
    const added = captureOptions(configDir);
    assert.equal(await runMcpManagementCli([
      "mcp", "add", "--transport", "http", "--scope", "user", name, fixture.serverUrl,
    ], added.options), 0);

    const output = [];
    const errors = [];
    const code = await runMcpManagementCli(["mcp", "login", name, "--no-browser"], {
      env: { CLAUDE_CONFIG_DIR: configDir },
      stdout: (value) => output.push(value),
      stderr: (value) => errors.push(value),
      readRedirectUrl: async () => {
        const authorization = output.join("").match(/Open (https?:\/\/\S+)/)?.[1];
        assert(authorization);
        const state = new URL(authorization).searchParams.get("state");
        return `http://127.0.0.1:54545/callback?code=fixture-code&state=${encodeURIComponent(state)}`;
      },
      authTimeoutMs: 2_000,
    });
    assert.equal(code, 0, errors.join(""));
    const safeOutput = output.join("");
    assert.match(safeOutput, /Status: ✓ Connected/);
    assert.doesNotMatch(safeOutput, /fixture-(?:access|refresh)-token/);
    assert.doesNotMatch(safeOutput, /callback\?code=/);

    const credentialsFile = path.join(configDir, ".credentials.json");
    const credentialInfo = await lstat(credentialsFile);
    assert.equal(credentialInfo.mode & 0o777, 0o600);
    const credentials = JSON.parse(await readFile(credentialsFile, "utf8"));
    assert.equal(credentials.mcpOAuth[name].state.tokens.access_token, "fixture-access-token");

    const registry = await createMcpRegistryFromArgv([
      "--mcp-config",
      JSON.stringify({
        mcpServers: {
          [name]: { type: "http", url: fixture.serverUrl, oauth: true },
        },
      }),
    ], {
      projectedOAuthIdentity: {
        configDir,
        redirectUrl: "http://127.0.0.1:54545/callback",
      },
    });
    try {
      const [connected] = await registry.connectAll();
      assert.equal(connected.status, "connected", connected.error);
      assert.equal(connected.serverInfo.name, "management-fixture");
    } finally {
      await registry.close();
    }

    const got = await runChild(configDir, ["mcp", "get", name]);
    assert.equal(got.code, 0, got.stderr);
    assert.match(got.stdout, /Status: ✓ Connected/);
    assert.match(got.stdout, /Authentication: authenticated/);
    assert.doesNotMatch(got.stdout, /Failure-Code:/);
    assert.doesNotMatch(got.stdout, /fixture-(?:access|refresh)-token/);

    const loggedOut = captureOptions(configDir);
    assert.equal(await runMcpManagementCli(["mcp", "logout", name], loggedOut.options), 0);
    const after = await runChild(configDir, ["mcp", "get", name]);
    assert.match(after.stdout, /Status: Needs authentication/);
    assert.match(after.stdout, /Authentication: required/);
    assert.doesNotMatch(after.stdout, /Failure-Code:/);
    await assert.rejects(readFile(credentialsFile, "utf8"), { code: "ENOENT" });
  } finally {
    await fixture.close();
    await removeFixtureDirectory(directory);
  }
});

test("proactive login on an anonymous server without OAuth advertisement is safe and non-mutating", async () => {
  const directory = await canonicalTemp();
  const configDir = path.join(directory, "config");
  const fixture = await startOAuthFixture({ anonymous: true, advertiseOAuth: false });
  const name = "anonymous:fixture";
  try {
    const added = captureOptions(configDir);
    assert.equal(await runMcpManagementCli([
      "mcp", "add", "--transport", "http", "--scope", "user", name, fixture.serverUrl,
    ], added.options), 0);
    const attempted = captureOptions(configDir, {
      readRedirectUrl: async () => {
        assert.fail("an anonymous server without OAuth advertisement must not request a callback");
      },
      authTimeoutMs: 1_000,
    });
    assert.equal(
      await runMcpManagementCli(["mcp", "login", name, "--no-browser"], attempted.options),
      1,
    );
    assert.equal(attempted.stdout.join("").includes("Open "), false);
    assert.match(attempted.stderr.join(""), /Failure-Code: auth_not_required/);
    assert.match(attempted.stderr.join(""), /Authentication: anonymous/);
    assert.equal(attempted.stderr.join("").includes(fixture.serverUrl), false);
    await assert.rejects(readFile(path.join(configDir, ".credentials.json"), "utf8"), {
      code: "ENOENT",
    });

    const loggedOut = captureOptions(configDir);
    assert.equal(await runMcpManagementCli(["mcp", "logout", name], loggedOut.options), 0);
    assert.match(loggedOut.stdout.join(""), /Status: ✓ Connected/);
    assert.match(loggedOut.stdout.join(""), /Authentication: anonymous/);
  } finally {
    await fixture.close();
    await removeFixtureDirectory(directory);
  }
});

test("management output maps metadata, server, and network failures to the Dream whitelist", async () => {
  const directory = await canonicalTemp();
  const configDir = path.join(directory, "config");
  const invalid = await startOAuthFixture({ invalidMetadata: true });
  const forbidden = await startOAuthFixture({ mcpStatus: 403 });
  const missing = await startOAuthFixture({ mcpStatus: 404 });
  const offline = await startOAuthFixture({ anonymous: true });
  let offlineClosed = false;
  try {
    for (const [name, fixture] of Object.entries({ invalid, forbidden, missing, offline })) {
      const added = captureOptions(configDir);
      assert.equal(await runMcpManagementCli([
        "mcp", "add", "--transport", "http", "--scope", "user", name, fixture.serverUrl,
      ], added.options), 0);
    }

    const invalidLogin = captureOptions(configDir, {
      readRedirectUrl: async () => assert.fail("invalid metadata must not request a callback"),
      authTimeoutMs: 1_000,
    });
    assert.equal(
      await runMcpManagementCli(["mcp", "login", "invalid", "--no-browser"], invalidLogin.options),
      1,
    );
    assert.match(invalidLogin.stderr.join(""), /Authentication: required/);
    assert.match(invalidLogin.stderr.join(""), /Failure-Code: metadata_invalid/);
    assert.equal(invalidLogin.stdout.join("").includes("Open "), false);

    for (const name of ["forbidden", "missing"]) {
      const got = captureOptions(configDir, { authTimeoutMs: 1_000 });
      assert.equal(await runMcpManagementCli(["mcp", "get", name], got.options), 0);
      assert.match(got.stdout.join(""), /Failure-Code: server_rejected/);
      assert.match(got.stdout.join(""), /Authentication: unknown/);
    }

    await offline.close();
    offlineClosed = true;
    const network = captureOptions(configDir, { authTimeoutMs: 1_000 });
    assert.equal(await runMcpManagementCli(["mcp", "get", "offline"], network.options), 0);
    assert.match(network.stdout.join(""), /Failure-Code: network_unreachable/);
    assert.equal(network.stdout.join("").includes(offline.serverUrl), false);

    const combined = [
      invalidLogin.stderr.join(""),
      network.stdout.join(""),
    ].join("\n");
    assert.doesNotMatch(combined, /authorization|refresh_token|callback\?code|resource_metadata/iu);
  } finally {
    await Promise.all([invalid, forbidden, missing].map((fixture) => fixture.close()));
    if (!offlineClosed) await offline.close();
    await removeFixtureDirectory(directory);
  }
});

test("login timeout and symlinked config roots fail closed without sensitive diagnostics", async () => {
  const directory = await canonicalTemp();
  const configDir = path.join(directory, "config");
  const linked = path.join(directory, "linked");
  const fixture = await startOAuthFixture({ discoveryDelayMs: 60 });
  try {
    const added = captureOptions(configDir);
    await runMcpManagementCli([
      "mcp", "add", "--transport", "http", "--scope", "user", "timeout:server", fixture.serverUrl,
    ], added.options);
    const output = [];
    const errors = [];
    const code = await runMcpManagementCli(["mcp", "login", "timeout:server", "--no-browser"], {
      env: { CLAUDE_CONFIG_DIR: configDir },
      stdout: (value) => output.push(value),
      stderr: (value) => errors.push(value),
      readRedirectUrl: () => new Promise(() => undefined),
      authTimeoutMs: 25,
    });
    assert.equal(code, 1);
    assert.match(errors.join(""), /Failure-Code: timeout/);
    assert.match(errors.join(""), /Authentication: unknown/);
    assert.doesNotMatch(errors.join(""), /token|CLAUDE_CONFIG_DIR|fixture-code/i);
    await new Promise((resolve) => setTimeout(resolve, 80));
    const oauthDirectory = path.join(configDir, "mcp-oauth");
    const oauthFiles = await readdir(oauthDirectory).catch((error) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    assert.deepEqual(oauthFiles, []);

    await mkdir(path.join(directory, "real"), { mode: 0o700 });
    await symlink(path.join(directory, "real"), linked);
    const unsafe = captureOptions(linked);
    assert.equal(await runMcpManagementCli(["mcp", "list"], unsafe.options), 1);
    assert.match(unsafe.stderr.join(""), /Failure-Code: server_rejected/);
  } finally {
    await fixture.close();
    await removeFixtureDirectory(directory);
  }
});
