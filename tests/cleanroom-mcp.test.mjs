#!/usr/bin/env node
// [Input] Official MCP SDK v1 local stdio/HTTP fixtures and clean-room MCP source.
// [Output] Provider-free evidence for config, discovery, calls, resources, status, and management APIs.
// [Pos] Clean-room MCP contract test; it performs no provider, OAuth, credential, or remote call.
// [Sync] 2026-08-24: cover stdio and local Streamable HTTP plus fail-closed boundaries.
// [Sync] 2026-08-24: recognize the separately tested MCP CLI wire while preserving argv ownership.

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

test("unsupported and unauthenticated OAuth boundaries fail closed without consuming non-MCP argv", async () => {
  const configs = await parseMcpConfigArgv([
    "--mcp-config",
    JSON.stringify({
      mcpServers: {
        legacy: { type: "sse", url: "https://example.invalid/mcp" },
        protected: { type: "http", url: "https://example.invalid/mcp", oauth: true },
      },
    }),
  ]);
  const registry = new McpRegistry(configs);
  try {
    assert.equal((await registry.connect("legacy")).status, "failed");
    assert.equal((await registry.connect("protected")).status, "needs-auth");
    assert.equal(await runMcpManagementCli(["--version"]), undefined);
  } finally {
    await registry.close();
  }
});
