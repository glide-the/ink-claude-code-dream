#!/usr/bin/env node
// [Input] Official MCP SDK v1 local stdio/HTTP fixtures and clean-room MCP source.
// [Output] Provider-free evidence for config, discovery, calls, resources, status, and management APIs.
// [Pos] Clean-room MCP contract test; it performs no provider, OAuth, credential, or remote call.
// [Sync] 2026-08-24: cover stdio and local Streamable HTTP plus fail-closed boundaries.
// [Sync] 2026-08-25: classify anonymous HTTP, 401, bare 403, 404, timeout, and network outcomes.

import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import {
  ListMcpResourcesTool,
  McpRegistry,
  ReadMcpResourceTool,
  createMcpRegistryFromArgv,
  mcp_reconnect,
  mcp_status,
  mcp_toggle,
  parseMcpConfigArgv,
  runMcpManagementCli,
} from "../src/cleanroom/mcp/index.ts";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function registerFixtureSurface(server, label) {
  server.registerTool(
    "echo",
    {
      description: `Echo through ${label}`,
      inputSchema: { message: z.string() },
    },
    async ({ message }) => ({
      content: [{ type: "text", text: `${label}:${message}` }],
    }),
  );
  server.registerResource(
    "fixture-note",
    `memo://${label}/note`,
    { description: `${label} note`, mimeType: "text/plain" },
    async () => ({
      contents: [{ uri: `memo://${label}/note`, text: `${label} resource` }],
    }),
  );
  server.registerPrompt(
    "hello",
    { description: `${label} greeting`, argsSchema: { name: z.string() } },
    async ({ name }) => ({
      messages: [{ role: "user", content: { type: "text", text: `Hello ${name}` } }],
    }),
  );
}

function fixtureServer(label) {
  const server = new McpServer({ name: `${label}-fixture`, version: "1.0.0" });
  registerFixtureSurface(server, label);
  return server;
}

async function startHttpFixture() {
  const requests = [];
  const server = http.createServer(async (request, response) => {
    try {
      let body = "";
      for await (const chunk of request) body += chunk;
      const parsedBody = body ? JSON.parse(body) : undefined;
      if (parsedBody?.method) requests.push(parsedBody.method);
      const mcp = fixtureServer("http");
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      response.once("close", () => {
        void transport.close();
        void mcp.close();
      });
      await mcp.connect(transport);
      await transport.handleRequest(request, response, parsedBody);
    } catch (error) {
      if (!response.headersSent) response.writeHead(500, { "content-type": "text/plain" });
      response.end(error instanceof Error ? error.message : "fixture failed");
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");
  return {
    requests,
    url: `http://127.0.0.1:${address.port}/mcp`,
    close: async () => {
      server.close();
      await once(server, "close");
    },
  };
}

async function startRejectingHttpFixture({ status, delayMs = 0 }) {
  const server = http.createServer(async (_request, response) => {
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    response.writeHead(status, { "content-type": "application/json" });
    response.end('{"error":"fixture_rejected"}');
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");
  return {
    url: `http://127.0.0.1:${address.port}/mcp`,
    close: async () => {
      server.close();
      await once(server, "close");
    },
  };
}

test("stdio config preserves colon identity and exposes discovery/call/resource APIs", async () => {
  const directory = await mkdtemp(path.join(repositoryRoot, "tests", ".cleanroom-mcp-"));
  const fixture = path.join(directory, "stdio-fixture.mjs");
  const fixtureSource = `
// [Input] JSON-RPC messages from one provider-free MCP test client.
// [Output] Local MCP tools, resources, and prompts over stdio.
// [Pos] Ephemeral provider-free test fixture.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
const server = new McpServer({ name: "stdio-fixture", version: "1.0.0" });
server.registerTool("echo", { description: "stdio echo", inputSchema: { message: z.string() } }, async ({ message }) => ({ content: [{ type: "text", text: \`stdio:\${message}\` }] }));
server.registerResource("fixture-note", "memo://stdio/note", { description: "stdio note", mimeType: "text/plain" }, async () => ({ contents: [{ uri: "memo://stdio/note", text: "stdio resource" }] }));
server.registerPrompt("hello", { description: "stdio greeting", argsSchema: { name: z.string() } }, async ({ name }) => ({ messages: [{ role: "user", content: { type: "text", text: \`Hello \${name}\` } }] }));
await server.connect(new StdioServerTransport());
`;
  await writeFile(fixture, fixtureSource);

  const config = JSON.stringify({
    mcpServers: {
      "stdio:fixture": { command: process.execPath, args: [fixture] },
      sleeping: { command: process.execPath, args: [fixture], enabled: false },
    },
  });
  const registry = await createMcpRegistryFromArgv(["--mcp-config", config]);
  try {
    assert.deepEqual(
      mcp_status(registry).map(({ name, status }) => [name, status]),
      [["stdio:fixture", "pending"], ["sleeping", "disabled"]],
    );
    const connected = await registry.connect("stdio:fixture");
    assert.equal(connected.status, "connected");
    assert.equal(connected.serverInfo?.name, "stdio-fixture");
    assert.deepEqual(connected.tools.map(({ name }) => name), ["echo"]);
    assert.deepEqual(connected.resources.map(({ uri }) => uri), ["memo://stdio/note"]);
    assert.deepEqual(connected.prompts.map(({ name }) => name), ["hello"]);

    const [modelTool] = registry.modelTools();
    assert.equal(modelTool.name, "mcp__stdio_fixture__echo");
    assert.equal(modelTool.serverName, "stdio:fixture");
    const called = await registry.callModelTool(modelTool.name, { message: "ok" });
    assert.equal(called.content?.[0]?.text, "stdio:ok");

    const listTool = new ListMcpResourcesTool(registry);
    const listed = JSON.parse((await listTool.execute()).content[0].text);
    assert.equal(listed.resources[0].server, "stdio:fixture");
    const readTool = new ReadMcpResourceTool(registry);
    const read = JSON.parse(
      (await readTool.execute({ server: "stdio:fixture", uri: "memo://stdio/note" }))
        .content[0].text,
    );
    assert.equal(read.contents[0].text, "stdio resource");

    assert.equal((await mcp_toggle(registry, "stdio:fixture", false)).status, "disabled");
    assert.equal((await mcp_reconnect(registry, "stdio:fixture")).status, "disabled");
    assert.equal((await mcp_toggle(registry, "stdio:fixture", true)).status, "connected");
  } finally {
    await registry.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("Streamable HTTP uses SDK initialize, discovery, calls, and reads", async () => {
  const fixture = await startHttpFixture();
  const config = JSON.stringify({
    mcpServers: { "http:fixture": { type: "http", url: fixture.url } },
  });
  const configs = await parseMcpConfigArgv([`--mcp-config=${config}`]);
  const registry = new McpRegistry(configs);
  try {
    const connected = await registry.connect("http:fixture");
    assert.equal(connected.status, "connected", connected.error);
    assert.equal(connected.authentication, "anonymous");
    assert.equal(connected.failureCode, undefined);
    assert.equal(connected.serverInfo?.name, "http-fixture");
    assert.equal(
      (await registry.callTool("http:fixture", "echo", { message: "ok" })).content?.[0]?.text,
      "http:ok",
    );
    assert.equal(
      (await registry.readResource("http:fixture", "memo://http/note")).contents[0].text,
      "http resource",
    );
    for (const method of [
      "initialize",
      "tools/list",
      "resources/list",
      "prompts/list",
      "tools/call",
      "resources/read",
    ]) {
      assert(fixture.requests.includes(method), `missing HTTP MCP method ${method}`);
    }
  } finally {
    await registry.close();
    await fixture.close();
  }
});

test("legacy OAuth hint does not block anonymous HTTP and non-MCP argv remains unconsumed", async () => {
  const fixture = await startHttpFixture();
  const configs = await parseMcpConfigArgv([
    "--mcp-config",
    JSON.stringify({
      mcpServers: {
        legacy: { type: "sse", url: "https://example.invalid/mcp" },
        hinted: { type: "http", url: fixture.url, oauth: true },
      },
    }),
  ]);
  const registry = new McpRegistry(configs);
  try {
    assert.equal((await registry.connect("legacy")).status, "failed");
    const hinted = await registry.connect("hinted");
    assert.equal(hinted.status, "connected", hinted.error);
    assert.equal(hinted.authentication, "anonymous");
    assert.equal(await runMcpManagementCli(["--version"]), undefined);
  } finally {
    await registry.close();
    await fixture.close();
  }
});

test("registry exposes mutually exclusive safe HTTP failure classifications", async () => {
  const fixtures = {
    required: await startRejectingHttpFixture({ status: 401 }),
    forbidden: await startRejectingHttpFixture({ status: 403 }),
    missing: await startRejectingHttpFixture({ status: 404 }),
    timeout: await startRejectingHttpFixture({ status: 200, delayMs: 80 }),
  };
  const configs = await parseMcpConfigArgv([
    "--mcp-config",
    JSON.stringify({
      mcpServers: Object.fromEntries(
        Object.entries(fixtures).map(([name, fixture]) => [name, { type: "http", url: fixture.url }]),
      ),
    }),
  ]);
  const registry = new McpRegistry(configs, { requestTimeoutMs: 25 });
  try {
    const required = await registry.connect("required");
    assert.equal(required.status, "needs-auth");
    assert.equal(required.authentication, "required");
    assert.equal(required.failureCode, "mcp_auth_required");

    const forbidden = await registry.connect("forbidden");
    assert.equal(forbidden.status, "failed");
    assert.equal(forbidden.authentication, "unknown");
    assert.equal(forbidden.failureCode, "mcp_forbidden");

    const missing = await registry.connect("missing");
    assert.equal(missing.status, "failed");
    assert.equal(missing.failureCode, "mcp_endpoint_not_found");

    const timedOut = await registry.connect("timeout");
    assert.equal(timedOut.status, "failed");
    assert.equal(timedOut.failureCode, "mcp_timeout");
  } finally {
    await registry.close();
    await Promise.all(Object.values(fixtures).map((fixture) => fixture.close()));
  }
});
