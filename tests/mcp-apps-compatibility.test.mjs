#!/usr/bin/env node
// [Input] Repository Marketplace catalog and the actual original services/mcp/client.ts module.
// [Output] Source characterization of pinned Skills and the ordinary-MCP/non-UI-Host boundary.
// [Pos] Static characterization only; actual protocol evidence uses the original-source MCP contract.
// [Sync] 2026-09-13: preserve Marketplace work while removing its dependency on a second Runtime.

import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

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

test("the actual original MCP module retains resources but declares no Apps UI Host", async () => {
 const client = await readFile(path.join(repositoryRoot, "src/services/mcp/client.ts"), "utf8");
 const resource = await readFile(path.join(repositoryRoot, "src/tools/ReadMcpResourceTool/ReadMcpResourceTool.ts"), "utf8");
 assert.match(client, /ListResourcesResultSchema/);
 assert.match(client, /StreamableHTTPClientTransport/);
 assert.match(client, /StdioClientTransport/);
 assert.match(client, /capabilities: \{/);
 assert.doesNotMatch(client, /io\.modelcontextprotocol\/ui/);
 assert.match(resource, /method: 'resources\/read'/);
});
