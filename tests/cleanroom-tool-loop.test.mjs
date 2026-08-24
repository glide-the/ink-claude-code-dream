#!/usr/bin/env node
// [Input] Compiled clean-room Runtime with provider-free Messages SSE, stdio MCP, SDK callbacks, and OAuth fixtures.
// [Output] Process evidence for tool loops, permissions/hooks, cancellation, max turns, result privacy, and OAuth controls.
// [Pos] Cross-module provider/tool control-plane gate; it uses no restored source, browser, or real credential.
// [Sync] 2026-08-24: cover built-in/MCP/Resource/Skill turns plus headless OAuth management DTOs.
// [Sync] 2026-08-24: prove PreToolUse allow/none/deny has one model tool_use_id and no duplicate permission invocation.

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bun = path.join(repositoryRoot, "node_modules", ".bin", "bun");
const outputRoot = path.join(repositoryRoot, "dist", "cleanroom-tool-loop-test");
const executable = path.join(outputRoot, "claude");
const SESSION_ID = "018f0f5e-7b8d-7c1a-8a2b-1234567890ad";
const FILE_SECRET = "permission-updated-SECRET";
const MCP_SECRET = "mcp-secret-tool-result";
const SKILL_SECRET = "skill-body-SECRET";

function sse(event, payload) {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

function messageStart(id) {
  return sse("message_start", {
    type: "message_start",
    message: {
      id,
      type: "message",
      role: "assistant",
      content: [],
      model: "claude-cleanroom-tool-loop",
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 2, output_tokens: 0 },
    },
  });
}

function textStream(id, text) {
  return [
    messageStart(id),
    sse("content_block_start", {
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" },
    }),
    sse("content_block_delta", {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text },
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

function toolStream(id, toolUseId, name, input) {
  const encoded = JSON.stringify(input);
  const split = Math.max(1, Math.floor(encoded.length / 2));
  return [
    messageStart(id),
    sse("content_block_start", {
      type: "content_block_start",
      index: 0,
      content_block: { type: "tool_use", id: toolUseId, name, input: {} },
    }),
    sse("content_block_delta", {
      type: "content_block_delta",
      index: 0,
      delta: { type: "input_json_delta", partial_json: encoded.slice(0, split) },
    }),
    sse("content_block_delta", {
      type: "content_block_delta",
      index: 0,
      delta: { type: "input_json_delta", partial_json: encoded.slice(split) },
    }),
    sse("content_block_stop", { type: "content_block_stop", index: 0 }),
    sse("message_delta", {
      type: "message_delta",
      delta: { stop_reason: "tool_use", stop_sequence: null },
      usage: { output_tokens: 1 },
    }),
    sse("message_stop", { type: "message_stop" }),
  ].join("");
}

function lastToolResult(payload) {
  const content = payload.messages.at(-1)?.content;
  return Array.isArray(content) && content[0]?.type === "tool_result" ? content[0] : undefined;
}

async function startMessagesFixture() {
  const requests = [];
  let maxSequence = 0;
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      requests.push(payload);
      const latest = payload.messages.at(-1);
      const toolResult = lastToolResult(payload);
      let body;
      if (typeof latest?.content === "string") {
        switch (latest.content) {
          case "FILE_TOOL":
            body = toolStream("msg-file-write", "write-file", "Write", {
              file_path: "original.txt",
              content: "original",
            });
            break;
          case "MCP_TOOL":
            body = toolStream("msg-mcp", "mcp-hook-allow", "mcp__stdio_fixture__echo", {
              message: "request",
            });
            break;
          case "MCP_NEUTRAL_TOOL":
            body = toolStream("msg-mcp-neutral", "mcp-hook-neutral", "mcp__stdio_fixture__echo", {
              message: "neutral",
            });
            break;
          case "MCP_DENY_HOOK_TOOL":
            body = toolStream("msg-mcp-deny", "mcp-hook-deny", "mcp__stdio_fixture__echo", {
              message: "must-not-execute",
            });
            break;
          case "RESOURCE_TOOL":
            body = toolStream("msg-resource", "resource-read", "ReadMcpResourceTool", {
              server: "stdio:fixture",
              uri: "memo://tool-loop/note",
            });
            break;
          case "SKILL_TOOL":
            body = toolStream("msg-skill", "skill-load", "Skill", { skill: "project-one" });
            break;
          case "DENY_TOOL":
            body = toolStream("msg-deny", "write-denied", "Write", {
              file_path: "denied.txt",
              content: "deny-me",
            });
            break;
          case "BASH_TOOL":
            body = toolStream("msg-bash", "bash-fail", "Bash", {
              command: 'test "$SANDBOX_RUNTIME" = "1" && printf sandboxed',
            });
            break;
          case "CANCEL_TOOL":
            body = toolStream("msg-cancel", "write-cancel", "Write", {
              file_path: "cancelled.txt",
              content: "cancel-me",
            });
            break;
          case "MAX_TOOL":
            maxSequence = 1;
            body = toolStream("msg-max-1", "max-1", "Glob", { pattern: "**/*" });
            break;
          default:
            body = textStream(`msg-text-${requests.length}`, "unexpected");
        }
      } else if (toolResult) {
        if (toolResult.tool_use_id === "write-file") {
          body = toolStream("msg-file-read", "read-file", "Read", { file_path: "updated.txt" });
        } else if (toolResult.tool_use_id === "read-file") {
          assert.equal(toolResult.content, FILE_SECRET);
          body = textStream("msg-file-done", "file-complete");
        } else if (toolResult.tool_use_id === "mcp-hook-allow") {
          assert.match(toolResult.content, new RegExp(MCP_SECRET));
          body = textStream("msg-mcp-done", "mcp-complete");
        } else if (toolResult.tool_use_id === "mcp-hook-neutral") {
          assert.match(toolResult.content, new RegExp(MCP_SECRET));
          body = textStream("msg-mcp-neutral-done", "mcp-neutral-complete");
        } else if (toolResult.tool_use_id === "mcp-hook-deny") {
          assert.equal(toolResult.is_error, true);
          assert.equal(toolResult.content, "Tool use was denied by an SDK hook");
          body = textStream("msg-mcp-deny-done", "mcp-deny-complete");
        } else if (toolResult.tool_use_id === "resource-read") {
          assert.match(toolResult.content, /resource-body-private/);
          body = textStream("msg-resource-done", "resource-complete");
        } else if (toolResult.tool_use_id === "skill-load") {
          assert.match(toolResult.content, new RegExp(SKILL_SECRET));
          body = textStream("msg-skill-done", "skill-complete");
        } else if (toolResult.tool_use_id === "write-denied") {
          assert.equal(toolResult.is_error, true);
          body = textStream("msg-deny-done", "deny-complete");
        } else if (toolResult.tool_use_id === "bash-fail") {
          assert.equal(toolResult.is_error, undefined);
          assert.match(toolResult.content, /sandboxed/);
          assert.match(toolResult.content, /exit code 0/);
          body = textStream("msg-bash-done", "bash-sandbox-complete");
        } else if (String(toolResult.tool_use_id).startsWith("max-")) {
          maxSequence += 1;
          body = toolStream(
            `msg-max-${maxSequence}`,
            `max-${maxSequence}`,
            "Glob",
            { pattern: "**/*" },
          );
        } else {
          body = textStream(`msg-result-${requests.length}`, "tool-result-complete");
        }
      } else {
        body = textStream(`msg-fallback-${requests.length}`, "fallback");
      }
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(body);
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

async function readRequestBody(request) {
  let body = "";
  for await (const chunk of request) body += chunk;
  return body;
}

async function startOAuthFixture() {
  const requests = [];
  let origin;
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, origin);
    requests.push({ method: request.method, path: url.pathname });
    if (
      url.pathname === "/mcp" &&
      request.headers.authorization !== "Bearer oauth-access-private"
    ) {
      response.writeHead(401, {
        "content-type": "application/json",
        "www-authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`,
      });
      response.end('{"error":"authorization_required"}');
      return;
    }
    if (request.method === "POST" && url.pathname === "/mcp") {
      const message = JSON.parse(await readRequestBody(request));
      if (message.method === "notifications/initialized") {
        response.writeHead(202);
        response.end();
        return;
      }
      const result = message.method === "initialize"
        ? {
            protocolVersion: "2025-06-18",
            capabilities: { tools: {} },
            serverInfo: { name: "oauth-control-fixture", version: "1.0.0" },
          }
        : message.method === "tools/list"
          ? { tools: [] }
          : {};
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
      return;
    }
    if (request.method === "GET" && url.pathname === "/mcp") {
      response.writeHead(405);
      response.end();
      return;
    }
    if (
      request.method === "GET" &&
      (url.pathname === "/.well-known/oauth-protected-resource/mcp" ||
        url.pathname === "/.well-known/oauth-protected-resource")
    ) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        resource: `${origin}/mcp`,
        authorization_servers: [origin],
        scopes_supported: ["mcp:tools"],
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
      response.writeHead(201, { "content-type": "application/json" });
      response.end(JSON.stringify({ ...metadata, client_id: "oauth-control-client" }));
      return;
    }
    if (request.method === "POST" && url.pathname === "/token") {
      const form = new URLSearchParams(await readRequestBody(request));
      assert.equal(form.get("grant_type"), "authorization_code");
      assert.equal(form.get("code"), "oauth-control-code");
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        access_token: "oauth-access-private",
        refresh_token: "oauth-refresh-private",
        token_type: "Bearer",
      }));
      return;
    }
    response.writeHead(404);
    response.end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");
  origin = `http://127.0.0.1:${address.port}`;
  return {
    requests,
    serverUrl: `${origin}/mcp`,
    close: async () => {
      server.closeAllConnections();
      server.close();
      await once(server, "close");
    },
  };
}

async function makeFixture(t) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "ink-tool-loop-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cwd = path.join(root, "workspace");
  const configDir = path.join(root, "config");
  const tmpdir = path.join(cwd, ".claude-tmp");
  await mkdir(tmpdir, { recursive: true, mode: 0o700 });
  await chmod(tmpdir, 0o700);
  const skillFile = path.join(cwd, ".claude", "skills", "project-one", "SKILL.md");
  await mkdir(path.dirname(skillFile), { recursive: true });
  await writeFile(
    skillFile,
    `---\nname: project-one\ndescription: Lazy Skill fixture\n---\n# Lazy\n\n${SKILL_SECRET}\n`,
  );

  const mcpFile = path.join(root, "stdio-mcp.mjs");
  const mcpCalls = path.join(root, "mcp-calls.jsonl");
  await writeFile(
    mcpFile,
    `import { appendFileSync } from "node:fs";
import { McpServer } from ${JSON.stringify(path.join(repositoryRoot, "node_modules", "@modelcontextprotocol", "sdk", "dist", "esm", "server", "mcp.js"))};
import { StdioServerTransport } from ${JSON.stringify(path.join(repositoryRoot, "node_modules", "@modelcontextprotocol", "sdk", "dist", "esm", "server", "stdio.js"))};
import { z } from ${JSON.stringify(path.join(repositoryRoot, "node_modules", "zod", "index.js"))};
const server = new McpServer({ name: "tool-loop-mcp", version: "1.0.0" });
server.registerTool("echo", { description: "private echo", inputSchema: { message: z.string() } }, async ({ message }) => {
  appendFileSync(${JSON.stringify(mcpCalls)}, JSON.stringify({ message }) + "\\n");
  return { content: [{ type: "text", text: ${JSON.stringify(MCP_SECRET)} }] };
});
server.registerResource("note", "memo://tool-loop/note", { description: "private note" }, async () => ({ contents: [{ uri: "memo://tool-loop/note", text: "resource-body-private" }] }));
await server.connect(new StdioServerTransport());
`,
  );
  return {
    configDir,
    cwd,
    root,
    tmpdir,
    mcpCalls,
    mcpConfig: JSON.stringify({
      mcpServers: { "stdio:fixture": { command: process.execPath, args: [mcpFile] } },
    }),
  };
}

function startRuntime(fixture, baseURL, extraEnv = {}) {
  const child = spawn(
    executable,
    [
      "--output-format", "stream-json",
      "--verbose",
      "--input-format", "stream-json",
      "--include-partial-messages",
      "--model", "claude-cleanroom-tool-loop",
      "--max-turns", "4",
      "--mcp-config", fixture.mcpConfig,
      "--allowedTools", "Skill(project-one)",
      `--session-id=${SESSION_ID}`,
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
        ...extraEnv,
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  const frames = [];
  const waiters = new Set();
  let stderr = "";
  const runtime = {
    child,
    frames,
    stderr: () => stderr,
    send(frame) {
      child.stdin.write(`${JSON.stringify(frame)}\n`);
    },
    waitFor(predicate, from = 0, timeoutMs = 7_500) {
      const existing = frames.slice(from).find(predicate);
      if (existing) return Promise.resolve(existing);
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          waiters.delete(check);
          reject(new Error(`timed out; frames=${JSON.stringify(frames.slice(from))}; stderr=${stderr}`));
        }, timeoutMs);
        const check = () => {
          const match = frames.slice(from).find(predicate);
          if (!match) return;
          clearTimeout(timeout);
          waiters.delete(check);
          resolve(match);
        };
        waiters.add(check);
      });
    },
  };
  createInterface({ input: child.stdout, crlfDelay: Number.POSITIVE_INFINITY }).on("line", (line) => {
    const frame = JSON.parse(line);
    frames.push(frame);
    if (frame.type === "control_request" && frame.request?.subtype === "can_use_tool") {
      if (frame.request.tool_use_id === "write-cancel") {
        runtime.send({
          type: "control_request",
          request_id: "interrupt-cancel",
          request: { subtype: "interrupt" },
        });
      } else {
        const deny = frame.request.tool_use_id === "write-denied";
        const updated = frame.request.tool_use_id === "write-file";
        runtime.send({
          type: "control_response",
          response: {
            subtype: "success",
            request_id: frame.request_id,
            response: deny
              ? { behavior: "deny", message: "denied by SDK fixture" }
              : {
                  behavior: "allow",
                  ...(updated
                    ? {
                        updatedInput: {
                          file_path: "updated.txt",
                          content: FILE_SECRET,
                        },
                        updatedPermissions: [{ type: "addRules", rules: ["Write"] }],
                      }
                    : {}),
                },
          },
        });
      }
    } else if (frame.type === "control_request" && frame.request?.subtype === "hook_callback") {
      const toolUseId = frame.request.tool_use_id;
      const permissionDecision = toolUseId === "mcp-hook-allow" || toolUseId === "read-file"
        ? "allow"
        : toolUseId === "mcp-hook-deny"
          ? "deny"
          : undefined;
      runtime.send({
        type: "control_response",
        response: {
          subtype: "success",
          request_id: frame.request_id,
          response: {
            hookSpecificOutput: {
              hookEventName: "PreToolUse",
              ...(permissionDecision ? { permissionDecision } : {}),
            },
          },
        },
      });
    }
    for (const wake of waiters) wake();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });
  return runtime;
}

async function initialize(runtime) {
  runtime.send({
    type: "control_request",
    request_id: "initialize-tool-loop",
    request: {
      subtype: "initialize",
      skills: ["project-one"],
      hooks: {
        PreToolUse: [
          { matcher: "^Read$", hookCallbackIds: ["pre-read"] },
          { matcher: "^mcp__stdio_fixture__echo$", hookCallbackIds: ["pre-mcp"] },
        ],
      },
    },
  });
  const initialized = await runtime.waitFor(
    (frame) => frame.type === "control_response" && frame.response?.request_id === "initialize-tool-loop",
  );
  assert.equal(initialized.response.subtype, "success");
  return runtime.waitFor((frame) => frame.type === "system" && frame.subtype === "init");
}

async function runTurn(runtime, input, predicate) {
  const from = runtime.frames.length;
  runtime.send({ type: "user", message: { role: "user", content: input } });
  return runtime.waitFor((frame) => frame.type === "result" && predicate(frame), from, 10_000);
}

async function control(runtime, requestId, request) {
  const from = runtime.frames.length;
  runtime.send({ type: "control_request", request_id: requestId, request });
  return runtime.waitFor(
    (frame) => frame.type === "control_response" && frame.response?.request_id === requestId,
    from,
    10_000,
  );
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
  ], { cwd: repositoryRoot, encoding: "utf8", timeout: 120_000 });
  assert.equal(built.status, 0, `build failed\n${built.stdout}\n${built.stderr}`);
});

test.after(() => rm(outputRoot, { recursive: true, force: true }));

test("provider tool loop emits SDK tool_result frames without leaking their body to logs", async (t) => {
  const fixture = await makeFixture(t);
  const messages = await startMessagesFixture();
  t.after(() => messages.close());
  const runtime = startRuntime(fixture, messages.baseURL);
  t.after(async () => {
    if (runtime.child.exitCode === null && runtime.child.signalCode === null) {
      runtime.child.kill("SIGKILL");
      await once(runtime.child, "exit");
    }
  });
  const system = await initialize(runtime);
  for (const tool of ["Read", "Write", "Edit", "Glob", "Grep", "Bash", "mcp__stdio_fixture__echo", "ReadMcpResourceTool", "Skill"]) {
    assert(system.tools.includes(tool), `missing tool ${tool}`);
  }

  assert.equal((await runTurn(runtime, "FILE_TOOL", (frame) => frame.result === "file-complete")).num_turns, 3);
  assert.equal(await readFile(path.join(fixture.cwd, "updated.txt"), "utf8"), FILE_SECRET);
  const fileRequests = messages.requests.slice(0, 3);
  assert.deepEqual(fileRequests[2].messages.slice(-5).map(({ role }) => role), [
    "user", "assistant", "user", "assistant", "user",
  ]);
  assert.equal(fileRequests[1].messages.at(-1).content[0].tool_use_id, "write-file");
  assert.equal(fileRequests[2].messages.at(-1).content[0].tool_use_id, "read-file");
  assert.deepEqual(
    runtime.frames
      .filter((frame) => frame.type === "control_request" && frame.request?.subtype === "can_use_tool")
      .map((frame) => frame.request.tool_use_id),
    ["write-file"],
  );
  const hookRequests = runtime.frames.filter(
    (frame) => frame.type === "control_request" && frame.request?.subtype === "hook_callback",
  );
  assert.deepEqual(hookRequests.map((frame) => frame.request.tool_use_id), ["read-file"]);

  const mcpFrameStart = runtime.frames.length;
  await runTurn(runtime, "MCP_TOOL", (frame) => frame.result === "mcp-complete");
  await runTurn(runtime, "MCP_NEUTRAL_TOOL", (frame) => frame.result === "mcp-neutral-complete");
  await runTurn(runtime, "MCP_DENY_HOOK_TOOL", (frame) => frame.result === "mcp-deny-complete");
  const mcpControlFrames = runtime.frames.slice(mcpFrameStart);
  const mcpHooks = mcpControlFrames.filter(
    (frame) => frame.type === "control_request" && frame.request?.subtype === "hook_callback",
  );
  assert.deepEqual(
    mcpHooks.map((frame) => frame.request.tool_use_id),
    ["mcp-hook-allow", "mcp-hook-neutral", "mcp-hook-deny"],
  );
  const mcpPermissions = mcpControlFrames.filter(
    (frame) => frame.type === "control_request" && frame.request?.subtype === "can_use_tool",
  );
  assert.deepEqual(mcpPermissions.map((frame) => frame.request.tool_use_id), ["mcp-hook-neutral"]);
  assert.notEqual(mcpPermissions[0].request_id, mcpPermissions[0].request.tool_use_id);
  assert.deepEqual(
    (await readFile(fixture.mcpCalls, "utf8")).trimEnd().split("\n").map((line) => JSON.parse(line)),
    [{ message: "request" }, { message: "neutral" }],
  );
  await runTurn(runtime, "RESOURCE_TOOL", (frame) => frame.result === "resource-complete");
  await runTurn(runtime, "SKILL_TOOL", (frame) => frame.result === "skill-complete");
  assert.equal(JSON.stringify(messages.requests[0].system ?? "").includes(SKILL_SECRET), false);
  await runTurn(runtime, "DENY_TOOL", (frame) => frame.result === "deny-complete");
  await runTurn(runtime, "BASH_TOOL", (frame) => frame.result === "bash-sandbox-complete");

  const cancelFrom = runtime.frames.length;
  const cancelled = await runTurn(
    runtime,
    "CANCEL_TOOL",
    (frame) => frame.terminal_reason === "aborted_streaming",
  );
  assert.equal(cancelled.is_error, false);
  const permissionRequest = runtime.frames.slice(cancelFrom).find(
    (frame) => frame.type === "control_request" && frame.request?.tool_use_id === "write-cancel",
  );
  assert(permissionRequest);
  assert(runtime.frames.slice(cancelFrom).some(
    (frame) => frame.type === "control_cancel_request" && frame.request_id === permissionRequest.request_id,
  ));
  assert(runtime.frames.slice(cancelFrom).some(
    (frame) => frame.type === "control_response" && frame.response?.request_id === "interrupt-cancel",
  ));

  const maxed = await runTurn(runtime, "MAX_TOOL", (frame) => frame.terminal_reason === "max_turns");
  assert.equal(maxed.is_error, true);
  assert.equal(maxed.num_turns, 4);

  const toolResultFrames = runtime.frames.filter((frame) => frame.type === "user");
  assert(toolResultFrames.some((frame) => frame.message?.content?.some(
    (block) => block.type === "tool_result" && block.tool_use_id === "write-file",
  )));
  assert(toolResultFrames.some((frame) => frame.message?.content?.some(
    (block) => block.type === "tool_result" && block.tool_use_id === "mcp-hook-allow",
  )));
  const terminalAndLogs = JSON.stringify({
    results: runtime.frames.filter((frame) => frame.type === "result"),
    stderr: runtime.stderr(),
  });
  assert.equal(terminalAndLogs.includes(FILE_SECRET), false);
  assert.equal(terminalAndLogs.includes(MCP_SECRET), false);
  assert.equal(terminalAndLogs.includes(SKILL_SECRET), false);
  assert.equal(terminalAndLogs.includes("resource-body-private"), false);

  runtime.child.stdin.end();
  const [exitCode, signal] = await once(runtime.child, "exit");
  assert.equal(exitCode, 0, `Runtime failed with ${signal}: ${runtime.stderr()}`);
});

test("headless OAuth controls expose safe authorization state and support finish, logout, and reconnect", async (t) => {
  const fixture = await makeFixture(t);
  const oauth = await startOAuthFixture();
  t.after(() => oauth.close());
  fixture.mcpConfig = JSON.stringify({
    mcpServers: {
      "oauth:fixture": { type: "http", url: oauth.serverUrl, oauth: true },
    },
  });
  const runtime = startRuntime(fixture, "http://127.0.0.1:1", {
    CLAUDE_CODE_MCP_OAUTH_REDIRECT_URL: "http://127.0.0.1/oauth/callback",
  });
  t.after(async () => {
    if (runtime.child.exitCode === null && runtime.child.signalCode === null) {
      runtime.child.kill("SIGKILL");
      await once(runtime.child, "exit");
    }
  });
  await initialize(runtime);
  const status = await control(runtime, "oauth-status", { subtype: "mcp_status" });
  const pending = status.response.response.mcpServers[0];
  assert.equal(pending.name, "oauth:fixture");
  assert.equal(pending.status, "needs-auth");
  assert.equal(new URL(pending.oauth.authorizationUrl).pathname, "/authorize");
  assert.equal(new URL(pending.oauth.authorizationUrl).searchParams.get("state"), pending.oauth.state);

  const finished = await control(runtime, "oauth-finish", {
    subtype: "mcp_finish_auth",
    serverName: "oauth:fixture",
    code: "oauth-control-code",
    state: pending.oauth.state,
  });
  assert.equal(finished.response.subtype, "success");
  assert.equal(finished.response.response.mcpServer.status, "connected");

  const loggedOut = await control(runtime, "oauth-logout", {
    subtype: "mcp_logout",
    serverName: "oauth:fixture",
  });
  assert.equal(loggedOut.response.response.mcpServer.status, "needs-auth");
  const reconnected = await control(runtime, "oauth-reconnect", {
    subtype: "mcp_reconnect",
    serverName: "oauth:fixture",
  });
  assert.equal(reconnected.response.subtype, "success");
  const pendingAgain = await control(runtime, "oauth-status-again", { subtype: "mcp_status" });
  assert.equal(pendingAgain.response.response.mcpServers[0].status, "needs-auth");
  assert.equal(new URL(pendingAgain.response.response.mcpServers[0].oauth.authorizationUrl).pathname, "/authorize");

  const frames = JSON.stringify(runtime.frames);
  assert.equal(frames.includes("oauth-access-private"), false);
  assert.equal(frames.includes("oauth-refresh-private"), false);
  assert.equal(oauth.requests.some(({ path: requestPath }) => requestPath === "/authorize"), false);

  runtime.child.stdin.end();
  const [exitCode, signal] = await once(runtime.child, "exit");
  assert.equal(exitCode, 0, `Runtime failed with ${signal}: ${runtime.stderr()}`);
});
