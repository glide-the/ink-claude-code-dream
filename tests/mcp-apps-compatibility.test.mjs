#!/usr/bin/env node
// [Input] Repository Marketplace catalog plus an official MCP SDK stdio fixture carrying MCP Apps metadata and HTML.
// [Output] Provider-free evidence for the pinned skills-only plugin and the Runtime's ordinary-MCP/MCP-Apps boundary.
// [Pos] MCP Apps compatibility characterization; a passing test does not claim iframe Host support.

import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createMcpRegistryFromArgv } from "../src/cleanroom/mcp/index.ts";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const upstreamRevision = "10195ad91851502134930e9b80ec2c04e277a720";
const resourceUri = "ui://compatibility/get-time.html";
const resourceMimeType = "text/html;profile=mcp-app";
const runtimeVersion = JSON.parse(
  await readFile(path.join(repositoryRoot, "package.json"), "utf8"),
).version;

test("Marketplace pins the official skills-only MCP Apps plugin without a false Host claim", async () => {
  const marketplace = JSON.parse(
    await readFile(path.join(repositoryRoot, ".claude-plugin", "marketplace.json"), "utf8"),
  );
  assert.equal(marketplace.name, "ink-claude-code-dream");
  assert.equal(marketplace.plugins.length, 1);
  const [plugin] = marketplace.plugins;
  assert.equal(plugin.name, "mcp-apps");
  assert.equal(plugin.version, "0.1.0");
  assert.match(plugin.description, /does not install an MCP server/i);
  assert.match(plugin.description, /or add MCP Apps UI hosting/i);
  assert.deepEqual(plugin.source, {
    source: "git-subdir",
    url: "https://github.com/modelcontextprotocol/ext-apps.git",
    path: "plugins/mcp-apps",
    sha: upstreamRevision,
  });
});

test("Runtime reads an MCP App resource but does not negotiate the Apps UI extension", async (t) => {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "ink-mcp-apps-compatibility-"));
  t.after(() => rm(fixtureRoot, { recursive: true, force: true }));
  const serverFile = path.join(fixtureRoot, "server.mjs");
  const sdkRoot = path.join(repositoryRoot, "node_modules", "@modelcontextprotocol", "sdk", "dist", "esm");
  await mkdir(fixtureRoot, { recursive: true });
  await writeFile(
    serverFile,
    `import { McpServer } from ${JSON.stringify(path.join(sdkRoot, "server", "mcp.js"))};
import { StdioServerTransport } from ${JSON.stringify(path.join(sdkRoot, "server", "stdio.js"))};

const resourceUri = ${JSON.stringify(resourceUri)};
const resourceMimeType = ${JSON.stringify(resourceMimeType)};
const server = new McpServer({ name: "mcp-apps-compatibility", version: "1.0.0" });
server.registerTool("get-time", {
  description: "MCP Apps compatibility tool",
  inputSchema: {},
  _meta: { ui: { resourceUri, visibility: ["model", "app"] } },
}, async () => ({
  content: [{ type: "text", text: "fallback-result" }],
  structuredContent: { mode: "fallback" },
  _meta: { resultAudience: "app" },
}));
server.registerTool("app-action", {
  description: "App-only action that must not be exposed to the model by a future Host",
  inputSchema: {},
  _meta: { ui: { visibility: ["app"] } },
}, async () => ({
  content: [{ type: "text", text: "app-only-result" }],
}));
server.registerTool("ordinary-error", {
  description: "Ordinary MCP error result",
  inputSchema: {},
}, async () => ({
  content: [{ type: "text", text: "safe-error" }],
  isError: true,
}));
server.registerTool("client-capabilities", {
  description: "Return initialize capabilities seen by the fixture",
  inputSchema: {},
}, async () => ({
  content: [{ type: "text", text: JSON.stringify(server.server.getClientCapabilities() ?? null) }],
}));
server.registerResource("mcp-app", resourceUri, {
  mimeType: resourceMimeType,
  _meta: { ui: { csp: { connectDomains: [] }, prefersBorder: true } },
}, async () => ({
  contents: [{
    uri: resourceUri,
    mimeType: resourceMimeType,
    text: "<!doctype html><html><body>MCP App</body></html>",
    _meta: { ui: { csp: { connectDomains: [] }, prefersBorder: true } },
  }],
}));
await server.connect(new StdioServerTransport());
`,
  );

  const config = JSON.stringify({
    mcpServers: {
      "mcp-apps:fixture": { command: process.execPath, args: [serverFile] },
    },
  });
  const registry = await createMcpRegistryFromArgv(
    ["--mcp-config", config],
    repositoryRoot,
    { clientName: "ink-mcp-apps-compatibility", clientVersion: runtimeVersion },
  );
  t.after(() => registry.close());

  const [entry] = await registry.connectAll();
  assert.equal(entry.status, "connected");
  const appTool = entry.tools.find(({ name }) => name === "get-time");
  assert.deepEqual(appTool?._meta?.ui, {
    resourceUri,
    visibility: ["model", "app"],
  });
  const projectedTool = registry.modelTools().find(({ mcpToolName }) => mcpToolName === "get-time");
  assert(projectedTool);
  assert.equal("_meta" in projectedTool, false);
  assert(
    registry.modelTools().some(({ mcpToolName }) => mcpToolName === "app-action"),
    "current ordinary-MCP projection exposes app-only tools; a future Host must enforce visibility",
  );

  const capabilitiesResult = await registry.callTool("mcp-apps:fixture", "client-capabilities");
  const capabilityText = capabilitiesResult.content?.find(({ type }) => type === "text")?.text;
  assert.deepEqual(JSON.parse(capabilityText), {});

  const toolResult = await registry.callTool("mcp-apps:fixture", "get-time");
  assert.deepEqual(toolResult.structuredContent, { mode: "fallback" });
  assert.equal(toolResult.content?.[0]?.text, "fallback-result");
  assert.deepEqual(toolResult._meta, { resultAudience: "app" });
  const errorResult = await registry.callTool("mcp-apps:fixture", "ordinary-error");
  assert.equal(errorResult.isError, true);
  assert.equal(errorResult.content?.[0]?.text, "safe-error");

  const listed = registry.listResources("mcp-apps:fixture");
  assert.equal(listed[0]?.uri, resourceUri);
  assert.equal(listed[0]?.mimeType, resourceMimeType);
  assert.deepEqual(listed[0]?._meta?.ui, {
    csp: { connectDomains: [] },
    prefersBorder: true,
  });
  const read = await registry.readResource("mcp-apps:fixture", resourceUri);
  assert.equal(read.contents[0]?.mimeType, resourceMimeType);
  assert.match(read.contents[0]?.text ?? "", /<!doctype html>/i);
  assert.deepEqual(read.contents[0]?._meta?.ui, {
    csp: { connectDomains: [] },
    prefersBorder: true,
  });
});
