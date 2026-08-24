#!/usr/bin/env node
// [Input] Provider-free OAuth HTTP fixture and isolated canonical CLAUDE_CONFIG_DIR roots.
// [Output] Evidence for all Dream MCP management argv, persistence, process reuse, safety, and timeout.
// [Pos] Process/API contract test for the clean-room Dream Resources management CLI.
// [Sync] 2026-08-24: prove timed-out OAuth discovery cannot recreate private state after cleanup.

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
    if (
      url.pathname === "/mcp" &&
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
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ resource: `${origin}/mcp`, authorization_servers: [origin] }));
      return;
    }
    if (url.pathname === "/.well-known/oauth-authorization-server") {
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
  try {
    for (const subject of ["add", "remove", "login", "logout"]) {
      const capture = captureOptions(configDir);
      assert.equal(await runMcpManagementCli(["mcp", subject, "--help"], capture.options), 0);
      assert.match(capture.stdout.join(""), new RegExp(subject));
    }

    const name = "user:comfy:cloud";
    const added = captureOptions(configDir);
    assert.equal(await runMcpManagementCli([
      "mcp", "add", "--transport", "http", "--scope", "user", name,
      "https://cloud.comfy.org/mcp",
    ], added.options), 0);
    assert.match(added.stdout.join(""), /Added HTTP MCP server user:comfy:cloud/);

    const [rootInfo, configInfo] = await Promise.all([
      lstat(configDir),
      lstat(path.join(configDir, ".claude.json")),
    ]);
    assert.equal(rootInfo.mode & 0o777, 0o700);
    assert.equal(configInfo.mode & 0o777, 0o600);
    const stored = JSON.parse(await readFile(path.join(configDir, ".claude.json"), "utf8"));
    assert.equal(stored.mcpServers[name].url, "https://cloud.comfy.org/mcp");

    const listed = await runChild(configDir, ["mcp", "list"]);
    assert.equal(listed.code, 0, listed.stderr);
    assert.match(listed.stdout, /user:comfy:cloud: http - Needs authentication/);
    assert.equal(listed.stdout.includes(configDir), false);

    const got = await runChild(configDir, ["mcp", "get", name]);
    assert.equal(got.code, 0, got.stderr);
    assert.match(got.stdout, /Scope: User config \(available in all your projects\)/);
    assert.match(got.stdout, /Status: Needs authentication/);

    const removed = captureOptions(configDir);
    assert.equal(await runMcpManagementCli(
      ["mcp", "remove", "--scope", "user", name],
      removed.options,
    ), 0);
    const missing = await runChild(configDir, ["mcp", "get", name]);
    assert.equal(missing.code, 1);
    assert.match(missing.stderr, /No MCP server named/);
  } finally {
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
    assert.doesNotMatch(got.stdout, /fixture-(?:access|refresh)-token/);

    const loggedOut = captureOptions(configDir);
    assert.equal(await runMcpManagementCli(["mcp", "logout", name], loggedOut.options), 0);
    const after = await runChild(configDir, ["mcp", "get", name]);
    assert.match(after.stdout, /Status: Needs authentication/);
    await assert.rejects(readFile(credentialsFile, "utf8"), { code: "ENOENT" });
  } finally {
    await fixture.close();
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
    assert.equal(errors.join(""), "Claude MCP command failed.\n");
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
    assert.equal(unsafe.stderr.join(""), "Claude MCP command failed.\n");
  } finally {
    await fixture.close();
    await removeFixtureDirectory(directory);
  }
});
