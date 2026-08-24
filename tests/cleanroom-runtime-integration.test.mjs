#!/usr/bin/env node
// [Input] Compiled clean-room Runtime plus disposable Anthropic SSE, stdio MCP, workspace, and config fixtures.
// [Output] Provider-free process evidence for persistent sessions, MCP controls/resources, tmpdir, and Skills/plugins.
// [Pos] Cross-module JSONL integration gate; it exercises the public executable without restored/vendor source.
// [Sync] 2026-08-24: cover fresh multi-turn, resume, fork, MCP lifecycle, and safe initialization failures.

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bun = path.join(repositoryRoot, "node_modules", ".bin", "bun");
const outputRoot = path.join(repositoryRoot, "dist", "cleanroom-integration-test");
const executable = path.join(outputRoot, "claude");
const SESSION_A = "018f0f5e-7b8d-7c1a-8a2b-1234567890ab";

function sse(event, payload) {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

function responseStream(sequence) {
  return [
    sse("message_start", {
      type: "message_start",
      message: {
        id: `msg_integration_${sequence}`,
        type: "message",
        role: "assistant",
        content: [],
        model: "claude-cleanroom-integration",
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 3, output_tokens: 0 },
      },
    }),
    sse("content_block_start", {
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" },
    }),
    sse("content_block_delta", {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: `answer-${sequence}` },
    }),
    sse("content_block_stop", { type: "content_block_stop", index: 0 }),
    sse("message_delta", {
      type: "message_delta",
      delta: { stop_reason: "end_turn", stop_sequence: null },
      usage: { output_tokens: 1 },
    }),
    sse("message_stop", { type: "message_stop" }),
  ].join("");
}

async function startAnthropicFixture() {
  const requests = [];
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      requests.push(payload);
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(responseStream(requests.length));
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");
  return {
    baseURL: `http://127.0.0.1:${address.port}`,
    requests,
    close: async () => {
      server.closeAllConnections();
      server.close();
      await once(server, "close");
    },
  };
}

async function makeFixture(t) {
  const created = await mkdtemp(path.join(os.tmpdir(), "ink-cleanroom-integration-"));
  const root = await realpath(created);
  t.after(() => rm(root, { recursive: true, force: true }));
  const cwd = path.join(root, "workspace");
  const configDir = path.join(root, "actor-config");
  const tmpdir = path.join(cwd, ".claude-tmp");
  const pluginRoot = path.join(root, "plugin");
  await mkdir(tmpdir, { recursive: true, mode: 0o700 });
  await chmod(tmpdir, 0o700);

  const projectSkill = path.join(cwd, ".claude", "skills", "project-one", "SKILL.md");
  const pluginSkill = path.join(pluginRoot, "skills", "plugin-one", "SKILL.md");
  await mkdir(path.dirname(projectSkill), { recursive: true });
  await mkdir(path.dirname(pluginSkill), { recursive: true });
  await writeFile(
    projectSkill,
    "---\nname: project-one\ndescription: Project integration skill\n---\n# Project\n\nProject body\n",
  );
  await writeFile(
    pluginSkill,
    "---\nname: plugin-one\ndescription: Plugin integration skill\n---\n# Plugin\n\nPlugin body\n",
  );

  const mcpFixture = path.join(root, "stdio-mcp-fixture.mjs");
  await writeFile(
    mcpFixture,
    `import { McpServer } from ${JSON.stringify(path.join(repositoryRoot, "node_modules", "@modelcontextprotocol", "sdk", "dist", "esm", "server", "mcp.js"))};
import { StdioServerTransport } from ${JSON.stringify(path.join(repositoryRoot, "node_modules", "@modelcontextprotocol", "sdk", "dist", "esm", "server", "stdio.js"))};
import { z } from ${JSON.stringify(path.join(repositoryRoot, "node_modules", "zod", "index.js"))};
const server = new McpServer({ name: "runtime-integration-mcp", version: "1.0.0" });
server.registerTool("echo", { description: "provider-free echo", inputSchema: { message: z.string() } }, async ({ message }) => ({ content: [{ type: "text", text: message }] }));
server.registerResource("note", "memo://runtime/note", { description: "provider-free note", mimeType: "text/plain" }, async () => ({ contents: [{ uri: "memo://runtime/note", text: "resource body" }] }));
await server.connect(new StdioServerTransport());
`,
  );
  const mcpConfig = JSON.stringify({
    mcpServers: {
      "stdio:fixture": { command: process.execPath, args: [mcpFixture] },
    },
  });
  return { configDir, cwd, mcpConfig, pluginRoot, root, tmpdir };
}

function startRuntime(fixture, baseURL, sessionArgs) {
  const child = spawn(
    executable,
    [
      "--output-format", "stream-json",
      "--verbose",
      "--input-format", "stream-json",
      "--include-partial-messages",
      "--model", "claude-cleanroom-integration",
      "--mcp-config", fixture.mcpConfig,
      "--plugin-dir", fixture.pluginRoot,
      "--allowedTools", "Skill(project-one),Skill(plugin-one)",
      ...sessionArgs,
    ],
    {
      cwd: fixture.cwd,
      env: {
        ...process.env,
        ANTHROPIC_API_KEY: "",
        ANTHROPIC_AUTH_TOKEN: "provider-free-token",
        ANTHROPIC_BASE_URL: baseURL,
        CLAUDE_CODE_TMPDIR: fixture.tmpdir,
        CLAUDE_CONFIG_DIR: fixture.configDir,
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  const frames = [];
  const waiters = new Set();
  let stderr = "";
  createInterface({ input: child.stdout, crlfDelay: Number.POSITIVE_INFINITY }).on("line", (line) => {
    frames.push(JSON.parse(line));
    for (const wake of waiters) wake();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });
  return {
    child,
    frames,
    stderr: () => stderr,
    send(frame) {
      child.stdin.write(`${JSON.stringify(frame)}\n`);
    },
    waitFor(predicate, timeoutMs = 7_500) {
      const existing = frames.find(predicate);
      if (existing) return Promise.resolve(existing);
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          waiters.delete(check);
          reject(new Error(`timed out; frames=${JSON.stringify(frames)} stderr=${stderr}`));
        }, timeoutMs);
        const check = () => {
          const match = frames.find(predicate);
          if (!match) return;
          clearTimeout(timeout);
          waiters.delete(check);
          resolve(match);
        };
        waiters.add(check);
      });
    },
  };
}

async function initialize(runtime, suffix) {
  runtime.send({
    type: "control_request",
    request_id: `init-${suffix}`,
    request: {
      subtype: "initialize",
      skills: ["project-one", "plugin-one"],
      hooks: { Stop: [{ hookCallbackIds: ["finish"] }] },
    },
  });
  const response = await runtime.waitFor(
    (frame) => frame.type === "control_response" && frame.response?.request_id === `init-${suffix}`,
  );
  assert.equal(response.response.subtype, "success");
  return runtime.waitFor((frame) => frame.type === "system" && frame.subtype === "init");
}

async function requestControl(runtime, requestId, request) {
  runtime.send({ type: "control_request", request_id: requestId, request });
  return runtime.waitFor(
    (frame) => frame.type === "control_response" && frame.response?.request_id === requestId,
  );
}

async function sendTurn(runtime, text, answer) {
  runtime.send({ type: "user", message: { role: "user", content: text } });
  return runtime.waitFor((frame) => frame.type === "result" && frame.result === answer);
}

async function stopRuntime(runtime) {
  runtime.child.stdin.end();
  const [exitCode, signal] = await once(runtime.child, "exit");
  assert.equal(exitCode, 0, `Runtime failed with ${signal}: ${runtime.stderr()}`);
}

async function transcript(configDir, sessionId) {
  const projects = path.join(configDir, "projects");
  const [projectHash] = await readdir(projects);
  return readFile(path.join(projects, projectHash, `${sessionId}.jsonl`), "utf8");
}

test.before(async () => {
  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(outputRoot, { recursive: true });
  const built = spawnSync(bun, [
    "build",
    "--compile",
    "--no-compile-autoload-dotenv",
    "--no-compile-autoload-bunfig",
    "--sourcemap=none",
    `--outfile=${executable}`,
    path.join(repositoryRoot, "src", "cleanroom", "cli.ts"),
  ], {
    cwd: repositoryRoot,
    encoding: "utf8",
    timeout: 120_000,
  });
  assert.equal(built.status, 0, `build failed\nstdout=${built.stdout}\nstderr=${built.stderr}`);
});

test.after(() => rm(outputRoot, { recursive: true, force: true }));

test("public executable integrates fresh/resume/fork, MCP management/resources, tmpdir, and Skills", async (t) => {
  const fixture = await makeFixture(t);
  const anthropic = await startAnthropicFixture();
  t.after(() => anthropic.close());

  const fresh = startRuntime(fixture, anthropic.baseURL, [`--session-id=${SESSION_A}`]);
  const freshSystem = await initialize(fresh, "fresh");
  assert.equal(freshSystem.session_id, SESSION_A);
  assert.equal(freshSystem.claude_code_tmpdir_validated, true);
  assert.deepEqual(freshSystem.hooks, ["Stop"]);
  assert.deepEqual(freshSystem.skills.map(({ name, source }) => [name, source]), [
    ["plugin-one", "plugin"],
    ["project-one", "project"],
  ]);
  assert(freshSystem.tools.includes("mcp__stdio_fixture__echo"));
  assert(freshSystem.tools.includes("ListMcpResourcesTool"));
  assert.equal(freshSystem.mcp_servers[0].resources[0].uri, "memo://runtime/note");

  const status = await requestControl(fresh, "mcp-status", { subtype: "mcp_status" });
  assert.equal(status.response.response.mcpServers[0].name, "stdio:fixture");
  assert.equal(status.response.response.mcpServers[0].status, "connected");
  assert.equal(status.response.response.mcpServers[0].resources[0].uri, "memo://runtime/note");
  await requestControl(fresh, "mcp-off", {
    subtype: "mcp_toggle",
    serverName: "stdio:fixture",
    enabled: false,
  });
  const disabled = await requestControl(fresh, "mcp-disabled", { subtype: "mcp_status" });
  assert.equal(disabled.response.response.mcpServers[0].status, "disabled");
  await requestControl(fresh, "mcp-reconnect-disabled", {
    subtype: "mcp_reconnect",
    serverName: "stdio:fixture",
  });
  await requestControl(fresh, "mcp-on", {
    subtype: "mcp_toggle",
    serverName: "stdio:fixture",
    enabled: true,
  });
  const reconnected = await requestControl(fresh, "mcp-reconnected", { subtype: "mcp_status" });
  assert.equal(reconnected.response.response.mcpServers[0].status, "connected");

  await sendTurn(fresh, "fresh-one", "answer-1");
  await sendTurn(fresh, "fresh-two", "answer-2");
  assert.equal(anthropic.requests[0].messages.length, 1);
  assert.equal(anthropic.requests[1].messages.length, 3);
  await stopRuntime(fresh);
  assert.equal((await transcript(fixture.configDir, SESSION_A)).trimEnd().split("\n").length, 4);

  const resumed = startRuntime(fixture, anthropic.baseURL, [`--resume=${SESSION_A}`]);
  const resumedSystem = await initialize(resumed, "resume");
  assert.equal(resumedSystem.session_id, SESSION_A);
  await sendTurn(resumed, "resumed", "answer-3");
  assert.equal(anthropic.requests[2].messages.length, 5);
  await stopRuntime(resumed);
  assert.equal((await transcript(fixture.configDir, SESSION_A)).trimEnd().split("\n").length, 6);

  const forked = startRuntime(fixture, anthropic.baseURL, [
    `--resume=${SESSION_A}`,
    "--fork-session",
  ]);
  const forkedSystem = await initialize(forked, "fork");
  assert.notEqual(forkedSystem.session_id, SESSION_A);
  await sendTurn(forked, "forked", "answer-4");
  assert.equal(anthropic.requests[3].messages.length, 7);
  await stopRuntime(forked);
  assert.equal((await transcript(fixture.configDir, SESSION_A)).trimEnd().split("\n").length, 6);
  assert.equal(
    (await transcript(fixture.configDir, forkedSystem.session_id)).trimEnd().split("\n").length,
    8,
  );
});

test("invalid tmpdir fails before provider/MCP use without leaking token or local path", async (t) => {
  const fixture = await makeFixture(t);
  const wrongTmpdir = path.join(fixture.cwd, "nested", ".claude-tmp");
  await mkdir(wrongTmpdir, { recursive: true, mode: 0o700 });
  const result = spawnSync(
    executable,
    ["--output-format", "stream-json", "--input-format", "stream-json"],
    {
      cwd: fixture.cwd,
      encoding: "utf8",
      env: {
        ...process.env,
        ANTHROPIC_AUTH_TOKEN: "must-not-leak-token",
        CLAUDE_CODE_TMPDIR: wrongTmpdir,
        CLAUDE_CONFIG_DIR: fixture.configDir,
      },
      input: "",
      timeout: 5_000,
    },
  );
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Runtime initialization or execution failed/);
  assert.equal(result.stderr.includes("must-not-leak-token"), false);
  assert.equal(result.stderr.includes(fixture.root), false);
});
