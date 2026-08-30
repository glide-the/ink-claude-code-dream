#!/usr/bin/env node
// [Input] Compiled clean-room Runtime, SDK-style --settings, and disposable helper/provider fixtures.
// [Output] Provider-free proof of Dream helper auth headers, in-memory TTL, redaction, and fail-closed settings.
// [Pos] Dream Gateway bootstrap contract; no real Gateway secret, model, database, or business service is used.
// [Sync] 2026-08-24: cover virtualenv-style helper symlinks without weakening real-executable validation.
// [Sync] 2026-08-30: prove Notion's Bash-only projection is absent from provider helper children.

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { chmod, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bun = path.join(repositoryRoot, "node_modules", ".bin", "bun");
const executable = path.join(repositoryRoot, "dist", "cleanroom-dream-bootstrap", "claude");
const helperToken = "fixture-subject-token-never-emit";
const serviceKey = "fixture-service-key-never-emit";

function sse(event, payload) {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

function responseStream(sequence) {
  return [
    sse("message_start", {
      type: "message_start",
      message: {
        id: `msg_bootstrap_${sequence}`,
        type: "message",
        role: "assistant",
        content: [],
        model: "claude-dream-bootstrap-fixture",
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
      delta: { type: "text_delta", text: `bootstrap-${sequence}` },
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

async function startProvider() {
  const requests = [];
  const server = http.createServer((request, response) => {
    request.resume();
    request.once("end", () => {
      requests.push({
        authorization: request.headers.authorization,
        serviceKey: request.headers["x-api-key"],
      });
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
    async close() {
      server.closeAllConnections();
      server.close();
      await once(server, "close");
    },
  };
}

function startRuntime({ baseURL, cwd, marker, settings }) {
  const child = spawn(
    executable,
    [
      "--output-format", "stream-json",
      "--verbose",
      "--input-format", "stream-json",
      "--model", "claude-dream-bootstrap-fixture",
      "--settings", settings,
    ],
    {
      cwd,
      env: {
        ...process.env,
        ANTHROPIC_API_KEY: "",
        ANTHROPIC_AUTH_TOKEN: "",
        ANTHROPIC_BASE_URL: baseURL,
        ANTHROPIC_CUSTOM_HEADERS: `x-api-key: ${serviceKey}`,
        CLAUDE_CODE_API_KEY_HELPER_TTL_MS: "120000",
        INK_BOOTSTRAP_HELPER_MARKER: marker,
        INK_BOOTSTRAP_HELPER_TOKEN: helperToken,
        NOTION_HOME: path.join(cwd, ".notion-home"),
        NOTION_API_TOKEN: "notion-helper-must-not-receive",
        NOTION_KEYRING: "0",
        NOTION_WORKERS_CONFIG_FILE: path.join(cwd, ".notion-home", "workers.json"),
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  const frames = [];
  let stdout = "";
  let stderr = "";
  const waiters = new Set();
  createInterface({ input: child.stdout, crlfDelay: Number.POSITIVE_INFINITY }).on("line", line => {
    stdout += `${line}\n`;
    frames.push(JSON.parse(line));
    for (const wake of waiters) wake();
  });
  child.stderr.on("data", chunk => { stderr += chunk.toString("utf8"); });
  return {
    child,
    frames,
    output: () => `${stdout}${stderr}`,
    send(frame) { child.stdin.write(`${JSON.stringify(frame)}\n`); },
    waitFor(predicate, timeoutMs = 5000) {
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

async function initializeAndTurn(runtime, suffix) {
  runtime.send({
    type: "control_request",
    request_id: `init-${suffix}`,
    request: { subtype: "initialize", hooks: null },
  });
  const initialized = await runtime.waitFor(
    frame => frame.type === "control_response" && frame.response?.request_id === `init-${suffix}`,
  );
  assert.equal(initialized.response.subtype, "success");
  const system = await runtime.waitFor(frame => frame.type === "system" && frame.subtype === "init");
  assert.equal(system.apiKeySource, "apiKeyHelper");
  runtime.send({ type: "user", message: { role: "user", content: suffix } });
  return runtime.waitFor(frame => frame.type === "result" && frame.is_error === false);
}

test.before(async () => {
  const built = spawnSync(bun, [
    "build",
    "--compile",
    "--no-compile-autoload-dotenv",
    "--no-compile-autoload-bunfig",
    "--sourcemap=none",
    `--outfile=${executable}`,
    path.join(repositoryRoot, "src", "cleanroom", "cli.ts"),
  ], { cwd: repositoryRoot, encoding: "utf8", timeout: 120000 });
  assert.equal(built.status, 0, `${built.stdout}\n${built.stderr}`);
});

test.after(() => rm(path.dirname(executable), { recursive: true, force: true }));

test("Dream inline apiKeyHelper supplies Bearer subject plus service header without leaking or persisting", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ink-dream-bootstrap-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const helper = path.join(root, "helper.mjs");
  const marker = path.join(root, "helper-invocations.txt");
  await writeFile(helper, [
    'import { appendFile } from "node:fs/promises";',
    'const names = ["NOTION_HOME", "NOTION_API_TOKEN", "NOTION_KEYRING", "NOTION_WORKERS_CONFIG_FILE"];',
    'const status = names.map(name => `${name}=${process.env[name] === undefined ? "unset" : "set"}`).join(" ");',
    'await appendFile(process.env.INK_BOOTSTRAP_HELPER_MARKER, `called ${status}\\n`);',
    'process.stdout.write(`${process.env.INK_BOOTSTRAP_HELPER_TOKEN}\\n`);',
  ].join("\n"));
  const provider = await startProvider();
  t.after(() => provider.close());
  const command = `${process.execPath} ${helper}`;
  const runtime = startRuntime({
    baseURL: provider.baseURL,
    cwd: root,
    marker,
    settings: JSON.stringify({ apiKeyHelper: command }),
  });
  await initializeAndTurn(runtime, "first");
  runtime.send({ type: "user", message: { role: "user", content: "second" } });
  await runtime.waitFor(frame => frame.type === "result" && frame.result === "bootstrap-2");
  runtime.child.stdin.end();
  const [code] = await once(runtime.child, "exit");
  assert.equal(code, 0, runtime.output());
  assert.deepEqual(provider.requests, [
    { authorization: `Bearer ${helperToken}`, serviceKey },
    { authorization: `Bearer ${helperToken}`, serviceKey },
  ]);
  assert.equal(
    await readFile(marker, "utf8"),
    "called NOTION_HOME=unset NOTION_API_TOKEN=unset NOTION_KEYRING=unset NOTION_WORKERS_CONFIG_FILE=unset\n",
  );
  assert(!runtime.output().includes(helperToken));
  assert(!runtime.output().includes(serviceKey));
  assert(!JSON.stringify(runtime.frames).includes(helperToken));
  assert(!JSON.stringify(runtime.frames).includes(serviceKey));
  assert(!JSON.stringify(await import("node:fs/promises").then(fs => fs.readdir(root))).includes(helperToken));
});

test("Dream settings file works while missing, writable, and non-executable helper paths fail closed", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ink-dream-bootstrap-file-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const marker = path.join(root, "helper-invocations.txt");
  const helper = path.join(root, "helper.mjs");
  await writeFile(helper, 'process.stdout.write(`${process.env.INK_BOOTSTRAP_HELPER_TOKEN}\\n`);\n');
  const settingsPath = path.join(root, "settings.json");
  await writeFile(settingsPath, JSON.stringify({ apiKeyHelper: `${process.execPath} ${helper}` }), { mode: 0o600 });
  await chmod(settingsPath, 0o600);
  const provider = await startProvider();
  t.after(() => provider.close());
  const valid = startRuntime({ baseURL: provider.baseURL, cwd: root, marker, settings: settingsPath });
  await initializeAndTurn(valid, "file");
  valid.child.stdin.end();
  assert.equal((await once(valid.child, "exit"))[0], 0, valid.output());

  const helperTarget = path.join(root, "helper-target.sh");
  const helperLink = path.join(root, "helper-link");
  await writeFile(
    helperTarget,
    '#!/bin/sh\n[ "$(basename "$0")" = "helper-link" ] || exit 91\nprintf "%s\\n" "$INK_BOOTSTRAP_HELPER_TOKEN"\n',
    { mode: 0o700 },
  );
  await chmod(helperTarget, 0o700);
  await symlink(helperTarget, helperLink);
  const linked = startRuntime({
    baseURL: provider.baseURL,
    cwd: root,
    marker,
    settings: JSON.stringify({ apiKeyHelper: helperLink }),
  });
  await initializeAndTurn(linked, "symlink-entry");
  linked.child.stdin.end();
  assert.equal((await once(linked.child, "exit"))[0], 0, linked.output());

  for (const invalidSettings of [
    path.join(root, "missing.json"),
    JSON.stringify({ apiKeyHelper: `${path.join(root, "missing-helper")} --token ${helperToken}` }),
  ]) {
    const invalid = startRuntime({ baseURL: provider.baseURL, cwd: root, marker, settings: invalidSettings });
    invalid.child.stdin.write(`${JSON.stringify({ type: "user", message: { role: "user", content: "fail" } })}\n`);
    invalid.child.stdin.end();
    const [code] = await once(invalid.child, "exit");
    assert.equal(code, 1);
    const expectedStage = invalidSettings.startsWith("{")
      ? "provider-auth:helper-executable"
      : "provider-auth";
    assert.equal(invalid.output(), `ink-claude-code-dream: Runtime initialization or execution failed [stage=${expectedStage}]\n`);
    assert(!invalid.output().includes(helperToken));
  }

  await chmod(settingsPath, 0o666);
  const writable = startRuntime({ baseURL: provider.baseURL, cwd: root, marker, settings: settingsPath });
  writable.child.stdin.end();
  assert.equal((await once(writable.child, "exit"))[0], 1);
  assert.equal(writable.output(), "ink-claude-code-dream: Runtime initialization or execution failed [stage=provider-auth]\n");
});
