#!/usr/bin/env node
// [Input] Clean-room source, locked Bun compiler, and a local Anthropic-compatible SSE fixture.
// [Output] Provider-free evidence for version, initialize, streaming, parser shapes, sessions, headers, and interrupt.
// [Pos] First-slice process-boundary contract; it makes no external provider, tool, MCP, or persistence call.
// [Sync] 2026-08-24: add clean-room Runtime JSONL/SSE/interrupt coverage.
// [Sync] 2026-09-13: verify the truthful Runtime 0.1.7 help surface.

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { rm } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bun = path.join(repositoryRoot, "node_modules", ".bin", "bun");
const executable = path.join(repositoryRoot, "dist", "cleanroom", "claude");
const buildScript = path.join(repositoryRoot, "scripts", "build-cleanroom-runtime.ts");

function sse(event, payload) {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

function streamPrefix(id, text) {
  return [
    sse("message_start", {
      type: "message_start",
      message: {
        id,
        type: "message",
        role: "assistant",
        content: [],
        model: "claude-cleanroom-fixture",
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 2, output_tokens: 0 },
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
      delta: { type: "text_delta", text },
    }),
  ].join("");
}

function streamSuffix() {
  return [
    sse("content_block_stop", { type: "content_block_stop", index: 0 }),
    sse("message_delta", {
      type: "message_delta",
      delta: { stop_reason: "end_turn", stop_sequence: null },
      usage: { output_tokens: 1 },
    }),
    sse("message_stop", { type: "message_stop" }),
  ].join("");
}

function userText(payload) {
  const content = payload.messages?.at(-1)?.content;
  if (typeof content === "string") return content;
  return Array.isArray(content)
    ? content.filter((block) => block?.type === "text").map((block) => block.text).join("")
    : "";
}

async function startFixture() {
  const requests = [];
  let interruptedResponseClosed = false;
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      requests.push({
        payload,
        authorization: request.headers.authorization,
        customHeader: request.headers["x-cleanroom-fixture"],
      });
      response.writeHead(200, {
        "content-type": "text/event-stream",
        connection: "keep-alive",
      });
      const sequence = requests.length;
      if (userText(payload) === "WAIT_FOR_INTERRUPT") {
        response.write(streamPrefix(`msg_fixture_${sequence}`, "interrupt-started"));
        response.on("close", () => {
          interruptedResponseClosed = true;
        });
        return;
      }
      response.end(
        streamPrefix(`msg_fixture_${sequence}`, `turn-${sequence} 协议✅`) +
          streamSuffix(),
      );
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");
  return {
    baseURL: `http://127.0.0.1:${address.port}`,
    requests,
    interruptedResponseClosed: () => interruptedResponseClosed,
    close: async () => {
      server.closeAllConnections();
      await new Promise((resolve, reject) => {
        server.close((error) =>
          error && error.code !== "ERR_SERVER_NOT_RUNNING" ? reject(error) : resolve(),
        );
      });
    },
  };
}

function startRuntime(baseURL) {
  const child = spawn(
    executable,
    [
      "--output-format",
      "stream-json",
      "--verbose",
      "--system-prompt",
      "fixture-system",
      "--model",
      "claude-cleanroom-fixture",
      "--permission-mode",
      "default",
      "--include-partial-messages",
      "--input-format",
      "stream-json",
    ],
    {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        ANTHROPIC_API_KEY: "",
        ANTHROPIC_AUTH_TOKEN: "fixture-token",
        ANTHROPIC_BASE_URL: baseURL,
        ANTHROPIC_CUSTOM_HEADERS: "x-cleanroom-fixture: present",
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  const frames = [];
  const waiters = new Set();
  let stderr = "";
  createInterface({ input: child.stdout, crlfDelay: Number.POSITIVE_INFINITY }).on(
    "line",
    (line) => {
      const frame = JSON.parse(line);
      frames.push(frame);
      for (const wake of waiters) wake();
    },
  );
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });

  const send = (frame) => child.stdin.write(`${JSON.stringify(frame)}\n`);
  const waitFor = async (predicate, timeoutMs = 5_000) => {
    const existing = frames.find(predicate);
    if (existing) return existing;
    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        waiters.delete(check);
        reject(
          new Error(
            `timed out waiting for frame; frames=${JSON.stringify(frames)}; stderr=${stderr}`,
          ),
        );
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
  };
  return { child, frames, send, waitFor, stderr: () => stderr };
}

function assertPythonParserShape(frame) {
  if (frame.type === "system") {
    assert.equal(typeof frame.subtype, "string");
    return;
  }
  if (frame.type === "stream_event") {
    assert.equal(typeof frame.uuid, "string");
    assert.equal(typeof frame.session_id, "string");
    assert.equal(typeof frame.event, "object");
    return;
  }
  if (frame.type === "assistant") {
    assert(Array.isArray(frame.message.content));
    assert.equal(typeof frame.message.model, "string");
    return;
  }
  if (frame.type === "result") {
    for (const key of [
      "subtype",
      "duration_ms",
      "duration_api_ms",
      "is_error",
      "num_turns",
      "session_id",
    ]) {
      assert(Object.hasOwn(frame, key), `result is missing Python parser field ${key}`);
    }
    return;
  }
  assert.fail(`unexpected parser frame ${frame.type}`);
}

function validateWithInstalledPythonSdk(frames) {
  const python = process.env.INK_SDK_PYTHON;
  if (!python) return;
  const script = [
    "import json, sys",
    "from claude_agent_sdk._internal.message_parser import parse_message",
    "frames = json.load(sys.stdin)",
    "parsed = [parse_message(frame) for frame in frames]",
    "assert all(message is not None for message in parsed)",
    "print(len(parsed))",
  ].join("\n");
  const result = spawnSync(python, ["-c", script], {
    encoding: "utf8",
    input: JSON.stringify(frames),
  });
  assert.equal(
    result.status,
    0,
    `Python SDK parser rejected clean-room output\nstdout=${result.stdout}\nstderr=${result.stderr}`,
  );
  assert.equal(Number(result.stdout.trim()), frames.length);
}

test.before(() => {
  const result = spawnSync(bun, [buildScript], {
    cwd: repositoryRoot,
    encoding: "utf8",
    timeout: 120_000,
  });
  assert.equal(result.status, 0, `build failed\nstdout=${result.stdout}\nstderr=${result.stderr}`);
});

test.after(async () => {
  await rm(path.dirname(executable), { recursive: true, force: true });
});

test("standalone clean-room CLI reports the compatible Claude Code version", () => {
  const result = spawnSync(executable, ["--version"], { encoding: "utf8" });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "2.1.241 (Claude Code)\n");
  assert.equal(result.stderr, "");
});

test("standalone clean-room CLI exposes truthful headless help", () => {
  const result = spawnSync(executable, ["--help"], { encoding: "utf8" });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^Usage: claude /);
  assert.match(result.stdout, /--input-format <format>/);
  assert.match(result.stdout, /mcp\s+Configure and inspect MCP servers/);
  assert.equal(result.stderr, "");
});

test("provider-free stream-json fixture covers initialize, two turns, and interrupt", async () => {
  const fixture = await startFixture();
  const runtime = startRuntime(fixture.baseURL);
  try {
    runtime.send({
      type: "control_request",
      request_id: "initialize-1",
      request: { subtype: "initialize", hooks: null },
    });
    const initialize = await runtime.waitFor(
      (frame) =>
        frame.type === "control_response" &&
        frame.response?.request_id === "initialize-1",
    );
    assert.deepEqual(initialize.response.response.commands, []);
    assert.equal(initialize.response.subtype, "success");
    const system = await runtime.waitFor(
      (frame) => frame.type === "system" && frame.subtype === "init",
    );
    assertPythonParserShape(system);

    runtime.send({
      type: "user",
      message: { role: "user", content: "FIRST_TURN" },
    });
    const firstResult = await runtime.waitFor(
      (frame) => frame.type === "result" && frame.result.includes("turn-1"),
    );
    assert.equal(firstResult.is_error, false);
    assert.equal(firstResult.terminal_reason, "completed");
    assertPythonParserShape(firstResult);
    const firstAssistant = runtime.frames.find(
      (frame) => frame.type === "assistant" && frame.message.id === "msg_fixture_1",
    );
    assert(firstAssistant);
    assertPythonParserShape(firstAssistant);
    assert(
      runtime.frames.some(
        (frame) =>
          frame.type === "stream_event" &&
          frame.event?.type === "content_block_delta" &&
          frame.event.delta?.text.includes("turn-1"),
      ),
    );

    runtime.send({
      type: "user",
      message: { role: "user", content: "SECOND_TURN" },
    });
    const secondResult = await runtime.waitFor(
      (frame) => frame.type === "result" && frame.result.includes("turn-2"),
    );
    assert.equal(secondResult.session_id, firstResult.session_id);
    assert.equal(system.session_id, firstResult.session_id);
    assert.equal(fixture.requests[1].payload.messages.length, 3);
    assert.equal(fixture.requests[0].authorization, "Bearer fixture-token");
    assert.equal(fixture.requests[0].customHeader, "present");

    runtime.send({
      type: "user",
      message: { role: "user", content: "WAIT_FOR_INTERRUPT" },
    });
    await runtime.waitFor(
      (frame) =>
        frame.type === "stream_event" &&
        frame.event?.type === "content_block_delta" &&
        frame.event.delta?.text === "interrupt-started",
    );
    runtime.send({
      type: "control_request",
      request_id: "interrupt-1",
      request: { subtype: "interrupt" },
    });
    const interruptResponse = await runtime.waitFor(
      (frame) =>
        frame.type === "control_response" &&
        frame.response?.request_id === "interrupt-1",
    );
    assert.equal(interruptResponse.response.subtype, "success");
    const interrupted = await runtime.waitFor(
      (frame) =>
        frame.type === "result" && frame.terminal_reason === "aborted_streaming",
    );
    assert.equal(interrupted.is_error, false);
    assert.equal(interrupted.session_id, firstResult.session_id);
    assertPythonParserShape(interrupted);
    // The public contract is the bounded terminal frame. Node/Bun keep-alive
    // pools may defer the fixture socket's close event until server teardown.

    validateWithInstalledPythonSdk(
      runtime.frames.filter((frame) =>
        ["system", "stream_event", "assistant", "result"].includes(frame.type),
      ),
    );

    runtime.child.stdin.end();
    const [exitCode, signal] = await once(runtime.child, "exit");
    assert.equal(exitCode, 0, `runtime failed with ${signal}: ${runtime.stderr()}`);
  } finally {
    if (runtime.child.exitCode === null && runtime.child.signalCode === null) {
      runtime.child.kill("SIGKILL");
      await once(runtime.child, "exit");
    }
    await fixture.close();
  }
});

test("SIGTERM closes an idle SDK stdin loop within the bounded shutdown window", async () => {
  const fixture = await startFixture();
  const runtime = startRuntime(fixture.baseURL);
  try {
    runtime.send({
      type: "control_request",
      request_id: "initialize-signal",
      request: { subtype: "initialize", hooks: null },
    });
    await runtime.waitFor((frame) => frame.type === "system" && frame.subtype === "init");
    const started = performance.now();
    runtime.child.kill("SIGTERM");
    const [exitCode, signal] = await once(runtime.child, "exit");
    assert(performance.now() - started < 3_000);
    assert.equal(signal, null);
    assert.equal(exitCode, 0);
  } finally {
    if (runtime.child.exitCode === null && runtime.child.signalCode === null) {
      runtime.child.kill("SIGKILL");
      await once(runtime.child, "exit");
    }
    await fixture.close();
  }
});
