#!/usr/bin/env node
// [Input] Official MCP SDK v1 local stdio/SSE/HTTP fixtures and clean-room MCP source.
// [Output] Provider-free evidence for config, discovery, calls, resources, status, and management APIs.
// [Pos] Clean-room MCP contract test; it performs no provider, OAuth, credential, or remote call.
// [Sync] 2026-08-24: cover stdio and local Streamable HTTP plus fail-closed boundaries.
// [Sync] 2026-08-25: cover strict SSE execution alongside verified auth and HTTP pagination.

import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
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

async function startSseFixture() {
  const requests = [];
  const headers = [];
  const sessions = new Map();
  let streamCloses = 0;
  const server = http.createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      headers.push(request.headers["x-managed-snapshot"]);
      if (request.method === "GET" && requestUrl.pathname === "/sse") {
        const transport = new SSEServerTransport("/messages", response);
        const mcp = fixtureServer("sse");
        sessions.set(transport.sessionId, { mcp, transport });
        response.once("close", () => {
          streamCloses += 1;
          sessions.delete(transport.sessionId);
          void mcp.close().catch(() => undefined);
        });
        await mcp.connect(transport);
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/messages") {
        const session = sessions.get(requestUrl.searchParams.get("sessionId"));
        if (!session) {
          response.writeHead(404).end("unknown SSE session");
          return;
        }
        let body = "";
        for await (const chunk of request) body += chunk;
        const parsedBody = body ? JSON.parse(body) : undefined;
        if (parsedBody?.method) requests.push(parsedBody.method);
        await session.transport.handlePostMessage(request, response, parsedBody);
        return;
      }
      response.writeHead(404).end("not found");
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
    headers,
    requests,
    url: `http://127.0.0.1:${address.port}/sse`,
    get streamCloses() {
      return streamCloses;
    },
    close: async () => {
      await Promise.all(
        [...sessions.values()].map(({ mcp }) => mcp.close().catch(() => undefined)),
      );
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

async function startPaginatedHttpFixture() {
  const methods = [];
  const server = http.createServer(async (request, response) => {
    if (request.method === "GET") {
      response.writeHead(405).end();
      return;
    }
    let body = "";
    for await (const chunk of request) body += chunk;
    const message = JSON.parse(body);
    methods.push(message.method);
    if (message.method === "notifications/initialized") {
      response.writeHead(202).end();
      return;
    }
    const cursor = message.params?.cursor;
    const pages = {
      initialize: {
        protocolVersion: "2025-06-18",
        capabilities: { tools: {}, resources: {}, prompts: {} },
        serverInfo: { name: "paginated-fixture", version: "1.0.0" },
      },
      "tools/list": cursor
        ? { tools: [{ name: "tool-b", inputSchema: { type: "object" } }] }
        : {
            tools: [{ name: "tool-a", inputSchema: { type: "object" } }],
            nextCursor: "tools-next",
          },
      "resources/list": cursor
        ? { resources: [{ uri: "memo://page/b", name: "resource-b" }] }
        : {
            resources: [{ uri: "memo://page/a", name: "resource-a" }],
            nextCursor: "resources-next",
          },
      "prompts/list": cursor
        ? { prompts: [{ name: "prompt-b" }] }
        : { prompts: [{ name: "prompt-a" }], nextCursor: "prompts-next" },
    };
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      jsonrpc: "2.0",
      id: message.id,
      result: pages[message.method] ?? {},
    }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");
  return {
    methods,
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

test("legacy SSE config is strict and remains distinct from Streamable HTTP", async () => {
  const configs = await parseMcpConfigArgv([
    "--mcp-config",
    JSON.stringify({
      mcpServers: {
        legacy: {
          type: "sse",
          url: "https://example.test/events",
          headers: { "x-managed-snapshot": "db-v1" },
        },
        modern: { type: "streamable-http", url: "https://example.test/mcp" },
        unsupported: { type: "websocket", url: "https://example.test/socket" },
      },
    }),
  ]);
  assert.deepEqual(configs.get("legacy"), {
    type: "sse",
    url: "https://example.test/events",
    headers: { "x-managed-snapshot": "db-v1" },
    enabled: true,
    requiresOAuth: false,
  });
  assert.equal(configs.get("modern")?.type, "http");
  assert.deepEqual(configs.get("unsupported"), {
    type: "unsupported",
    transport: "websocket",
    enabled: true,
    requiresOAuth: false,
  });

  await assert.rejects(
    parseMcpConfigArgv([
      "--mcp-config",
      JSON.stringify({ mcpServers: { unsafe: { type: "sse", url: "file:///tmp/mcp" } } }),
    ]),
    /must use http or https/,
  );
  await assert.rejects(
    parseMcpConfigArgv([
      "--mcp-config",
      JSON.stringify({
        mcpServers: {
          unsafe: { type: "sse", url: "https://example.test/events", headers: { bad: 1 } },
        },
      }),
    ]),
    /headers\.bad must be a string/,
  );
  await assert.rejects(
    parseMcpConfigArgv([
      "--mcp-config",
      JSON.stringify({ mcpServers: { missing: { type: "sse" } } }),
    ]),
    /url must be a non-empty absolute URL/,
  );
});

test("legacy SSE uses SDK initialize, discovery, calls, reads, reconnect, and close", async () => {
  const fixture = await startSseFixture();
  const configs = await parseMcpConfigArgv([
    "--mcp-config",
    JSON.stringify({
      mcpServers: {
        "sse:fixture": {
          type: "sse",
          url: fixture.url,
          headers: { "x-managed-snapshot": "db-v1" },
        },
      },
    }),
  ]);
  let providerConfig;
  const registry = new McpRegistry(configs, {
    oauthProviderFactory: (_serverName, config) => {
      providerConfig = config;
      return undefined;
    },
  });
  try {
    const connected = await registry.connect("sse:fixture");
    assert.equal(providerConfig?.type, "sse");
    assert.equal(connected.type, "sse");
    assert.equal(connected.status, "connected", connected.error);
    assert.equal(connected.authentication, "anonymous");
    assert.equal(connected.serverInfo?.name, "sse-fixture");
    assert.deepEqual(connected.tools.map(({ name }) => name), ["echo"]);
    assert.deepEqual(connected.resources.map(({ uri }) => uri), ["memo://sse/note"]);
    assert.deepEqual(connected.prompts.map(({ name }) => name), ["hello"]);
    assert.equal(
      (await registry.callTool("sse:fixture", "echo", { message: "ok" })).content?.[0]?.text,
      "sse:ok",
    );
    assert.equal(
      (await registry.readResource("sse:fixture", "memo://sse/note")).contents[0].text,
      "sse resource",
    );
    assert.equal((await registry.reconnect("sse:fixture")).status, "connected");
    assert.equal((await registry.toggle("sse:fixture", false)).status, "disabled");
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert(fixture.streamCloses >= 2, "reconnect and disable must close both SSE streams");
    assert(fixture.headers.length > 0);
    assert(fixture.headers.every((value) => value === "db-v1"));
    for (const method of [
      "initialize",
      "tools/list",
      "resources/list",
      "prompts/list",
      "tools/call",
      "resources/read",
    ]) {
      assert(fixture.requests.includes(method), `missing SSE MCP method ${method}`);
    }
  } finally {
    await registry.close();
    await fixture.close();
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

test("Streamable HTTP exhausts tools, resources, and prompts pagination", async () => {
  const fixture = await startPaginatedHttpFixture();
  const registry = new McpRegistry(new Map([["page:fixture", {
    type: "http",
    url: fixture.url,
    headers: {},
    enabled: true,
    requiresOAuth: false,
  }]]));
  try {
    const connected = await registry.connect("page:fixture");
    assert.equal(connected.status, "connected", connected.error);
    assert.deepEqual(connected.tools.map(({ name }) => name), ["tool-a", "tool-b"]);
    assert.deepEqual(connected.resources.map(({ uri }) => uri), ["memo://page/a", "memo://page/b"]);
    assert.deepEqual(connected.prompts.map(({ name }) => name), ["prompt-a", "prompt-b"]);
    for (const method of ["tools/list", "resources/list", "prompts/list"]) {
      assert.equal(fixture.methods.filter((value) => value === method).length, 2);
    }
  } finally {
    await registry.close();
    await fixture.close();
  }
});

test("OAuth hint does not block anonymous HTTP and unsupported transports stay safe", async () => {
  const fixture = await startHttpFixture();
  const configs = await parseMcpConfigArgv([
    "--mcp-config",
    JSON.stringify({
      mcpServers: {
        unsupported: { type: "websocket", url: "https://example.invalid/mcp" },
        hinted: { type: "http", url: fixture.url, oauth: true },
      },
    }),
  ]);
  const registry = new McpRegistry(configs);
  try {
    assert.equal((await registry.connect("unsupported")).status, "failed");
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
    unadvertised: await startRejectingHttpFixture({ status: 401 }),
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
    const unadvertised = await registry.connect("unadvertised");
    assert.equal(unadvertised.status, "failed");
    assert.equal(unadvertised.authentication, "unknown");
    assert.equal(unadvertised.failureCode, "mcp_auth_not_advertised");

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
