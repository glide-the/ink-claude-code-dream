#!/usr/bin/env node
// [Input] Compiled clean-room CLI and a provider-free local Anthropic Messages SSE transport.
// [Output] Golden final-HTTP-body evidence for effort/max_tokens parsing, opaque-model capability, bounds, omission, streaming, and tool follow-ups.
// [Pos] Focused request-serialization regression gate; it never calls a real model or records credentials.
// [Sync] 2026-08-28: prove a server-owned opaque-model capability reaches every compiled transport request.
// [Sync] 2026-09-12: remove unsupported fictional model-family expectations.

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdir, rm } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bun = path.join(repositoryRoot, "node_modules", ".bin", "bun");
const outputRoot = path.join(repositoryRoot, "dist", "cleanroom-request-parameters-test");
const executable = path.join(outputRoot, "claude");
const placeholderToken = "provider-free-request-parameter-token";

function sse(event, payload) {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

function textStream(sequence) {
  return [
    sse("message_start", {
      type: "message_start",
      message: {
        id: `msg_request_parameters_${sequence}`,
        type: "message",
        role: "assistant",
        content: [],
        model: "fixture-model",
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 0 },
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
      delta: { type: "text_delta", text: `fixture-${sequence}` },
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

function toolStream() {
  const input = JSON.stringify({ pattern: "__request_parameter_fixture_no_match__" });
  return [
    sse("message_start", {
      type: "message_start",
      message: {
        id: "msg_request_parameters_tool",
        type: "message",
        role: "assistant",
        content: [],
        model: "fixture-model",
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 0 },
      },
    }),
    sse("content_block_start", {
      type: "content_block_start",
      index: 0,
      content_block: {
        type: "tool_use",
        id: "request-parameter-tool-use",
        name: "Glob",
        input: {},
      },
    }),
    sse("content_block_delta", {
      type: "content_block_delta",
      index: 0,
      delta: { type: "input_json_delta", partial_json: input },
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

function finalUserText(payload) {
  const content = payload.messages?.at(-1)?.content;
  return typeof content === "string" ? content : "";
}

async function startTransportFixture() {
  const requests = [];
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      requests.push(payload);
      response.writeHead(200, { "content-type": "text/event-stream" });
      if (finalUserText(payload) === "TOOL_FOLLOW_UP") {
        response.end(toolStream());
      } else {
        response.end(textStream(requests.length));
      }
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");
  return {
    baseURL: `http://127.0.0.1:${address.port}`,
    requests,
    async close() {
      server.closeAllConnections();
      server.close();
      await once(server, "close");
    },
  };
}

function isolatedEnvironment(baseURL, overrides = {}) {
  const environment = { ...process.env };
  for (const name of [
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_MAX_TOKENS",
    "CLAUDE_CODE_EFFORT_LEVEL",
    "CLAUDE_CODE_MAX_OUTPUT_TOKENS",
    "INK_CLAUDE_CODE_MODEL_MAX_OUTPUT_TOKENS",
    "CLAUDE_CONFIG_DIR",
    "CLAUDE_CODE_TMPDIR",
  ]) {
    delete environment[name];
  }
  return {
    ...environment,
    ANTHROPIC_API_KEY: "",
    ANTHROPIC_AUTH_TOKEN: placeholderToken,
    ANTHROPIC_BASE_URL: baseURL,
    ...overrides,
  };
}

async function runTurn(fixture, options = {}) {
  const before = fixture.requests.length;
  const prompt = options.prompt ?? "REQUEST_PARAMETER_FIXTURE";
  const child = spawn(
    executable,
    [
      "--output-format", "stream-json",
      "--input-format", "stream-json",
      "--model", options.model ?? "gateway-compatible-model",
      "--permission-mode", "bypassPermissions",
      ...(options.args ?? []),
    ],
    {
      cwd: repositoryRoot,
      env: isolatedEnvironment(fixture.baseURL, options.environment),
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  const frames = [];
  let stderr = "";
  const waiters = new Set();
  createInterface({ input: child.stdout, crlfDelay: Number.POSITIVE_INFINITY }).on(
    "line",
    (line) => {
      frames.push(JSON.parse(line));
      for (const wake of waiters) wake();
    },
  );
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });
  const waitForResult = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      waiters.delete(check);
      reject(new Error(`request fixture timed out; stderr=${stderr}`));
    }, 7_500);
    const check = () => {
      const result = frames.find((frame) => frame.type === "result");
      if (!result) return;
      clearTimeout(timeout);
      waiters.delete(check);
      resolve(result);
    };
    waiters.add(check);
  });
  child.stdin.write(`${JSON.stringify({
    type: "user",
    message: { role: "user", content: prompt },
  })}\n`);
  try {
    const result = await waitForResult;
    assert.equal(result.is_error, false, `Runtime result failed: ${stderr}`);
    child.stdin.end();
    const [exitCode, signal] = await once(child, "exit");
    assert.equal(exitCode, 0, `Runtime failed with ${signal}: ${stderr}`);
    assert.equal(stderr.includes(placeholderToken), false);
    assert.equal(stderr.includes(prompt), false);
    return fixture.requests.slice(before);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await once(child, "exit");
    }
  }
}

function runInvalid(fixture, args, environment = {}) {
  const result = spawnSync(
    executable,
    ["--output-format", "stream-json", "--input-format", "stream-json", ...args],
    {
      cwd: repositoryRoot,
      env: isolatedEnvironment(fixture.baseURL, environment),
      encoding: "utf8",
      input: "",
      timeout: 7_500,
    },
  );
  assert.notEqual(result.status, 0);
  assert.equal(result.stderr.includes(placeholderToken), false);
  return result;
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

test("compiled transport serializes all explicit effort levels and omits unset effort", async (t) => {
  const fixture = await startTransportFixture();
  t.after(() => fixture.close());

  for (const effort of ["low", "medium", "high", "xhigh", "max"]) {
    const [payload] = await runTurn(fixture, { args: ["--effort", effort] });
    assert.deepEqual(
      {
        max_tokens: payload.max_tokens,
        output_config: payload.output_config,
        stream: payload.stream,
      },
      {
        max_tokens: 32_000,
        output_config: { effort },
        stream: true,
      },
    );
  }

  const [absent] = await runTurn(fixture);
  assert.equal(Object.hasOwn(absent, "output_config"), false);

  const [settings] = await runTurn(fixture, {
    args: ["--settings", JSON.stringify({ effortLevel: "medium" })],
  });
  assert.deepEqual(settings.output_config, { effort: "medium" });

  const [environmentWins] = await runTurn(fixture, {
    args: ["--effort", "low", "--settings", JSON.stringify({ effortLevel: "medium" })],
    environment: { CLAUDE_CODE_EFFORT_LEVEL: "xhigh" },
  });
  assert.deepEqual(environmentWins.output_config, { effort: "xhigh" });

  const [explicitUnset] = await runTurn(fixture, {
    args: ["--effort", "high"],
    environment: { CLAUDE_CODE_EFFORT_LEVEL: "unset" },
  });
  assert.equal(Object.hasOwn(explicitUnset, "output_config"), false);

  const [invalidEnvironmentFallsThrough] = await runTurn(fixture, {
    args: ["--effort", "high"],
    environment: { CLAUDE_CODE_EFFORT_LEVEL: "not-an-effort" },
  });
  assert.deepEqual(invalidEnvironmentFallsThrough.output_config, { effort: "high" });

  for (const effortLevel of ["max", "ultra"]) {
    const [invalidPersistedSetting] = await runTurn(fixture, {
      args: ["--settings", JSON.stringify({ effortLevel })],
    });
    assert.equal(Object.hasOwn(invalidPersistedSetting, "output_config"), false);
  }
});

test("compiled transport computes and bounds max_tokens by model capability", async (t) => {
  const fixture = await startTransportFixture();
  t.after(() => fixture.close());

  const cases = [
    { model: "gateway-compatible-model", expected: 32_000 },
    { model: "claude-opus-4-7", expected: 64_000 },
    { model: "claude-opus-4-8", expected: 64_000 },
    { model: "claude-opus-5", expected: 64_000 },
    { model: "claude-sonnet-5", expected: 64_000 },
    { model: "claude-opus-4-6", expected: 64_000 },
    { model: "claude-sonnet-4-6", expected: 32_000 },
    { model: "claude-3-opus", expected: 4_096 },
    { model: "claude-3-5-sonnet", expected: 8_192 },
    { model: "claude-3-7-sonnet", expected: 32_000 },
  ];
  for (const entry of cases) {
    const [payload] = await runTurn(fixture, { model: entry.model });
    assert.equal(payload.max_tokens, entry.expected, entry.model);
  }

  const [configured] = await runTurn(fixture, {
    environment: { CLAUDE_CODE_MAX_OUTPUT_TOKENS: "16000" },
  });
  assert.equal(configured.max_tokens, 16_000);

  const [capped] = await runTurn(fixture, {
    model: "claude-opus-4-6",
    environment: { CLAUDE_CODE_MAX_OUTPUT_TOKENS: "999999" },
  });
  assert.equal(capped.max_tokens, 128_000);

  const [hugeNumericCapped] = await runTurn(fixture, {
    model: "claude-sonnet-4-6",
    environment: { CLAUDE_CODE_MAX_OUTPUT_TOKENS: "900719925474099999" },
  });
  assert.equal(hugeNumericCapped.max_tokens, 128_000);

  const [invalid] = await runTurn(fixture, {
    environment: { CLAUDE_CODE_MAX_OUTPUT_TOKENS: "invalid" },
  });
  assert.equal(invalid.max_tokens, 32_000);

  const [legacyAmbientIgnored] = await runTurn(fixture, {
    environment: { ANTHROPIC_MAX_TOKENS: "777" },
  });
  assert.equal(legacyAmbientIgnored.max_tokens, 32_000);
});

test("compiled transport uses explicit opaque-model capability and bounds overrides", async (t) => {
  const fixture = await startTransportFixture();
  t.after(() => fixture.close());

  const capabilityEnvironment = {
    INK_CLAUDE_CODE_MODEL_MAX_OUTPUT_TOKENS: "384000",
  };
  const [configured] = await runTurn(fixture, {
    model: "gateway-private-alias",
    environment: capabilityEnvironment,
  });
  assert.equal(configured.max_tokens, 384_000);
  assert.equal(configured.stream, true);

  const [lowerOverride] = await runTurn(fixture, {
    model: "gateway-private-alias",
    environment: {
      ...capabilityEnvironment,
      CLAUDE_CODE_MAX_OUTPUT_TOKENS: "120000",
    },
  });
  assert.equal(lowerOverride.max_tokens, 120_000);

  const [boundedOverride] = await runTurn(fixture, {
    model: "gateway-private-alias",
    environment: {
      ...capabilityEnvironment,
      CLAUDE_CODE_MAX_OUTPUT_TOKENS: "999999",
    },
  });
  assert.equal(boundedOverride.max_tokens, 384_000);

  const before = fixture.requests.length;
  for (const invalidCapability of [
    "0",
    "-1",
    "384000.5",
    "not-a-number",
    "9007199254740992",
  ]) {
    const result = runInvalid(fixture, [], {
      INK_CLAUDE_CODE_MODEL_MAX_OUTPUT_TOKENS: invalidCapability,
    });
    assert.match(result.stderr, /Runtime initialization or execution failed/);
    assert.equal(result.stderr.includes(invalidCapability), false);
  }
  assert.equal(fixture.requests.length, before);
});

test("tool follow-up reuses the same final request policy", async (t) => {
  const fixture = await startTransportFixture();
  t.after(() => fixture.close());
  const requests = await runTurn(fixture, {
    args: ["--effort", "high"],
    environment: { INK_CLAUDE_CODE_MODEL_MAX_OUTPUT_TOKENS: "384000" },
    prompt: "TOOL_FOLLOW_UP",
  });
  assert.equal(requests.length, 2);
  for (const payload of requests) {
    assert.equal(payload.max_tokens, 384_000);
    assert.deepEqual(payload.output_config, { effort: "high" });
    assert.equal(payload.stream, true);
  }
  assert.equal(requests[1].messages.at(-1).content[0].type, "tool_result");
});

test("compiled transport applies current model effort capabilities", async (t) => {
  const fixture = await startTransportFixture();
  t.after(() => fixture.close());

  const [opus47] = await runTurn(fixture, {
    args: ["--effort", "xhigh"],
    model: "claude-opus-4-7",
  });
  assert.deepEqual(opus47.output_config, { effort: "xhigh" });

  const [opus46] = await runTurn(fixture, {
    args: ["--effort", "xhigh"],
    model: "claude-opus-4-6",
  });
  assert.deepEqual(opus46.output_config, { effort: "high" });

  const [opus45] = await runTurn(fixture, {
    args: ["--effort", "max"],
    model: "claude-opus-4-5",
  });
  assert.deepEqual(opus45.output_config, { effort: "high" });

  const [haiku45] = await runTurn(fixture, {
    args: ["--effort", "high"],
    model: "claude-haiku-4-5",
  });
  assert.equal(Object.hasOwn(haiku45, "output_config"), false);
});

test("invalid explicit effort fails before transport without leaking credentials", async (t) => {
  const fixture = await startTransportFixture();
  t.after(() => fixture.close());
  const before = fixture.requests.length;
  runInvalid(fixture, ["--effort", "ultra"]);
  assert.equal(fixture.requests.length, before);
});

test("request builder preserves existing output_config members and effort", () => {
  const moduleUrl = pathToFileURL(path.join(repositoryRoot, "src", "cleanroom", "request.ts")).href;
  const script = `
    import { buildMessageRequest } from ${JSON.stringify(moduleUrl)};
    const merged = buildMessageRequest({
      model: "fixture",
      messages: [],
      tools: [],
      parameters: { effort: "high", maxTokens: 32000 },
      outputConfig: { format: { type: "json_schema" } },
    });
    const retained = buildMessageRequest({
      model: "fixture",
      messages: [],
      tools: [],
      parameters: { effort: "high", maxTokens: 32000 },
      outputConfig: { effort: "low", format: { type: "json_schema" } },
    });
    process.stdout.write(JSON.stringify({ merged, retained }));
  `;
  const result = spawnSync(bun, ["-e", script], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.deepEqual(output.merged.output_config, {
    effort: "high",
    format: { type: "json_schema" },
  });
  assert.deepEqual(output.retained.output_config, {
    effort: "low",
    format: { type: "json_schema" },
  });
});
