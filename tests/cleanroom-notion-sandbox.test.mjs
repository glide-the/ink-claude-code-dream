#!/usr/bin/env node
// [Input] Synthetic thread Workspaces, native ntn resolution, and parent/wrapped environment maps.
// [Output] Prove only a canonical thread-bound Notion CLI environment can reach production Bash.
// [Pos] Provider-free Notion environment and network contract for the clean-room sandbox.
// [Sync] 2026-08-30: cover exact NOTION_* injection, filesystem validation, native ntn, and host scope.

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
  symlink,
  writeFile,
} from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  cleanEnvironment,
  NOTION_SANDBOX_ALLOWED_DOMAINS,
  resolveNotionBashEnvironment,
  resolveNtnExecutable,
} from "../src/cleanroom/sandbox/production.ts";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bun = path.join(repositoryRoot, "node_modules", ".bin", "bun");
const outputRoot = path.join(repositoryRoot, "dist", "cleanroom-notion-sandbox-test");
const executable = path.join(outputRoot, "claude");
const SESSION_ID = "018f0f5e-7b8d-7c1a-8a2b-1234567890af";
const firstToken = "synthetic-notion-runtime-token-one";
const secondToken = "synthetic-notion-runtime-token-two";

async function fixture(t) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "ink-notion-env-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspace = path.join(root, "workspace");
  const notionHome = path.join(workspace, ".notion-home");
  const workersFile = path.join(notionHome, "workers.json");
  await mkdir(notionHome, { recursive: true, mode: 0o700 });
  await chmod(notionHome, 0o700);
  return { root, workspace, notionHome, workersFile };
}

test("exact thread-bound Notion variables reach only the explicit Bash environment", async (t) => {
  const { workspace, notionHome, workersFile } = await fixture(t);
  await writeFile(workersFile, "{}\n", { mode: 0o600 });
  const source = {
    PATH: "/usr/bin:/bin",
    LANG: "zh_CN.UTF-8",
    NOTION_HOME: notionHome,
    NOTION_API_TOKEN: "secret-token",
    NOTION_KEYRING: "unexpected-user-value",
    NOTION_WORKERS_CONFIG_FILE: workersFile,
    NOTION_WORKSPACE_ID: "must-not-pass",
  };
  const notionEnvironment = await resolveNotionBashEnvironment(workspace, source);
  assert.deepEqual(notionEnvironment, {
    NOTION_HOME: notionHome,
    NOTION_KEYRING: "0",
    NOTION_API_TOKEN: "secret-token",
    NOTION_WORKERS_CONFIG_FILE: workersFile,
  });
  assert.deepEqual(
    cleanEnvironment(
      "/tmp/ink-notion-tmp",
      { PATH: "/wrapped/bin", LANG: "zh_CN.UTF-8" },
      notionEnvironment,
    ),
    {
      TMPDIR: "/tmp/ink-notion-tmp",
      ...(process.env.LC_ALL ? { LC_ALL: process.env.LC_ALL } : {}),
      ...(process.env.LC_CTYPE ? { LC_CTYPE: process.env.LC_CTYPE } : {}),
      ...(process.env.TERM ? { TERM: process.env.TERM } : {}),
      PATH: "/wrapped/bin",
      LANG: "zh_CN.UTF-8",
      NOTION_HOME: notionHome,
      NOTION_KEYRING: "0",
      NOTION_API_TOKEN: "secret-token",
      NOTION_WORKERS_CONFIG_FILE: workersFile,
    },
  );
});

test("generic Bash environment keeps its existing parent fallback without admitting ambient Notion values", () => {
  const environment = cleanEnvironment("/tmp/ink-notion-tmp", {}, {});
  for (const name of ["LANG", "LC_ALL", "LC_CTYPE", "PATH", "TERM"]) {
    if (process.env[name]) assert.equal(environment[name], process.env[name]);
  }
  for (const name of [
    "NOTION_HOME",
    "NOTION_API_TOKEN",
    "NOTION_KEYRING",
    "NOTION_WORKERS_CONFIG_FILE",
  ]) {
    assert.equal(Object.hasOwn(environment, name), false);
  }
});

test("foreign homes and workers files fail closed instead of crossing threads", async (t) => {
  const { workspace, notionHome } = await fixture(t);
  assert.deepEqual(await resolveNotionBashEnvironment(workspace, {
    NOTION_HOME: path.join(path.dirname(workspace), "other-thread", ".notion-home"),
    NOTION_API_TOKEN: "foreign-token",
  }), {});
  assert.deepEqual(await resolveNotionBashEnvironment(workspace, {
    NOTION_HOME: notionHome,
    NOTION_API_TOKEN: "current-token",
    NOTION_WORKERS_CONFIG_FILE: path.join(workspace, "workers.json"),
  }), {
    NOTION_HOME: notionHome,
    NOTION_KEYRING: "0",
    NOTION_API_TOKEN: "current-token",
  });
});

test("loose Notion homes and writable workers projections fail closed", async (t) => {
  const { workspace, notionHome, workersFile } = await fixture(t);
  await chmod(notionHome, 0o755);
  assert.deepEqual(await resolveNotionBashEnvironment(workspace, {
    NOTION_HOME: notionHome,
    NOTION_API_TOKEN: "must-not-pass",
  }), {});

  await chmod(notionHome, 0o700);
  await writeFile(workersFile, "{}\n", { mode: 0o600 });
  await chmod(workersFile, 0o666);
  assert.deepEqual(await resolveNotionBashEnvironment(workspace, {
    NOTION_HOME: notionHome,
    NOTION_WORKERS_CONFIG_FILE: workersFile,
  }), {
    NOTION_HOME: notionHome,
    NOTION_KEYRING: "0",
  });
});

test("missing tokens are valid while malformed, symlinked, and ambient projections fail closed", async (t) => {
  const { root, workspace, notionHome } = await fixture(t);
  assert.deepEqual(await resolveNotionBashEnvironment(workspace, {
    NOTION_HOME: notionHome,
  }), {
    NOTION_HOME: notionHome,
    NOTION_KEYRING: "0",
  });
  assert.deepEqual(await resolveNotionBashEnvironment(workspace, {
    NOTION_API_TOKEN: "ambient-token",
    NOTION_KEYRING: "1",
  }), {});
  for (const token of [" whitespace ", "two\nlines"]) {
    assert.deepEqual(await resolveNotionBashEnvironment(workspace, {
      NOTION_HOME: notionHome,
      NOTION_API_TOKEN: token,
    }), {
      NOTION_HOME: notionHome,
      NOTION_KEYRING: "0",
    });
  }

  const linkedWorkspace = path.join(root, "linked-workspace");
  const foreignHome = path.join(root, "foreign-home");
  await mkdir(linkedWorkspace);
  await mkdir(foreignHome, { mode: 0o700 });
  await symlink(foreignHome, path.join(linkedWorkspace, ".notion-home"));
  assert.deepEqual(await resolveNotionBashEnvironment(linkedWorkspace, {
    NOTION_HOME: path.join(linkedWorkspace, ".notion-home"),
    NOTION_API_TOKEN: "must-not-pass",
  }), {});
});

test("Notion network scope is HTTPS-only doctor, API spec, and identity", () => {
  assert.deepEqual(NOTION_SANDBOX_ALLOWED_DOMAINS, [
    "api.notion.com:443",
    "developers.notion.com:443",
    "ntn.dev:443",
  ]);
});

test("ntn resolution follows Runtime PATH and accepts only a canonical native executable", async (t) => {
  assert.equal(await resolveNtnExecutable({ PATH: "/definitely/missing" }), undefined);
  const scriptRoot = await mkdtemp(path.join(os.tmpdir(), "ink-notion-script-"));
  t.after(() => rm(scriptRoot, { recursive: true, force: true }));
  await writeFile(path.join(scriptRoot, "ntn"), "#!/bin/sh\nexit 0\n");
  await chmod(path.join(scriptRoot, "ntn"), 0o755);
  assert.equal(await resolveNtnExecutable({ PATH: scriptRoot }), undefined);

  const nativeRoot = await mkdtemp(path.join(os.tmpdir(), "ink-notion-native-"));
  t.after(() => rm(nativeRoot, { recursive: true, force: true }));
  await writeFile(path.join(nativeRoot, "ntn.c"), "int main(void) { return 0; }\n");
  const compiled = spawnSync("cc", [path.join(nativeRoot, "ntn.c"), "-o", path.join(nativeRoot, "ntn")], {
    encoding: "utf8",
  });
  assert.equal(compiled.status, 0, `${compiled.stdout}\n${compiled.stderr}`);
  await chmod(path.join(nativeRoot, "ntn"), 0o777);
  assert.equal(await resolveNtnExecutable({ PATH: nativeRoot }), undefined);

  const resolved = await resolveNtnExecutable(process.env);
  if (resolved !== undefined) {
    assert.equal(path.isAbsolute(resolved.path), true);
    assert.equal(path.basename(resolved.path), "ntn");
    assert(["elf", "mach-o"].includes(resolved.format));
  }
});

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
      model: "claude-cleanroom-notion",
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 0 },
    },
  });
}

function toolStream(id, command) {
  const input = JSON.stringify({ command });
  return [
    messageStart(id),
    sse("content_block_start", {
      type: "content_block_start",
      index: 0,
      content_block: { type: "tool_use", id: `${id}-bash`, name: "Bash", input: {} },
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

const validStatusCommand = [
  'test "$NOTION_HOME" = "$PWD/.notion-home" || exit 21',
  'test -n "$NOTION_API_TOKEN" || exit 22',
  'test "$NOTION_KEYRING" = "0" || exit 23',
  'test -z "${NOTION_WORKERS_CONFIG_FILE+x}" || exit 24',
  'if [ "${NOTION_HOME+x}" = x ]; then printf "NOTION_HOME=set\\n"; else printf "NOTION_HOME=unset\\n"; fi',
  'if [ "${NOTION_API_TOKEN+x}" = x ]; then printf "NOTION_API_TOKEN=set\\n"; else printf "NOTION_API_TOKEN=unset\\n"; fi',
  'if [ "${NOTION_KEYRING+x}" = x ]; then printf "NOTION_KEYRING=set\\n"; else printf "NOTION_KEYRING=unset\\n"; fi',
  'if [ "${NOTION_WORKERS_CONFIG_FILE+x}" = x ]; then printf "NOTION_WORKERS_CONFIG_FILE=set\\n"; else printf "NOTION_WORKERS_CONFIG_FILE=unset\\n"; fi',
].join("; ");

const closedStatusCommand = [
  'if [ "${NOTION_HOME+x}" = x ]; then printf "NOTION_HOME=set\\n"; else printf "NOTION_HOME=unset\\n"; fi',
  'if [ "${NOTION_API_TOKEN+x}" = x ]; then printf "NOTION_API_TOKEN=set\\n"; else printf "NOTION_API_TOKEN=unset\\n"; fi',
  'if [ "${NOTION_KEYRING+x}" = x ]; then printf "NOTION_KEYRING=set\\n"; else printf "NOTION_KEYRING=unset\\n"; fi',
  'if [ "${NOTION_WORKERS_CONFIG_FILE+x}" = x ]; then printf "NOTION_WORKERS_CONFIG_FILE=set\\n"; else printf "NOTION_WORKERS_CONFIG_FILE=unset\\n"; fi',
].join("; ");

async function startMessagesFixture() {
  const requests = [];
  const toolResults = [];
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      requests.push(payload);
      const latest = payload.messages.at(-1);
      let body;
      if (typeof latest?.content === "string") {
        const valid = latest.content === "VALID_NOTION_ENV";
        body = toolStream(valid ? "notion-valid" : "notion-foreign", valid
          ? validStatusCommand
          : closedStatusCommand);
      } else {
        const result = latest?.content?.find?.((block) => block.type === "tool_result");
        if (result) toolResults.push(result.content);
        body = textStream(`notion-done-${requests.length}`, "notion-bash-complete");
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
    toolResults,
    async close() {
      server.closeAllConnections();
      server.close();
      await once(server, "close");
    },
  };
}

async function runtimeFixture(t) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "ink-notion-runtime-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspace = path.join(root, "workspace");
  const notionHome = path.join(workspace, ".notion-home");
  const tmpdir = path.join(workspace, ".claude-tmp");
  const configDir = path.join(root, "config");
  const toolRoot = path.join(root, "tools");
  await mkdir(notionHome, { recursive: true, mode: 0o700 });
  await mkdir(tmpdir, { mode: 0o700 });
  await mkdir(configDir, { mode: 0o700 });
  await mkdir(toolRoot);
  await chmod(notionHome, 0o700);
  await chmod(tmpdir, 0o700);

  const ntnSource = path.join(toolRoot, "ntn.c");
  const ntn = path.join(toolRoot, "ntn");
  await writeFile(ntnSource, "int main(void) { return 0; }\n");
  const compiled = spawnSync("cc", [ntnSource, "-o", ntn], { encoding: "utf8" });
  assert.equal(compiled.status, 0, `${compiled.stdout}\n${compiled.stderr}`);

  const mcpMarker = path.join(root, "mcp-environment.jsonl");
  const mcpFixture = path.join(root, "mcp-fixture.mjs");
  await writeFile(mcpFixture, `import { appendFileSync } from "node:fs";
import { McpServer } from ${JSON.stringify(path.join(repositoryRoot, "node_modules", "@modelcontextprotocol", "sdk", "dist", "esm", "server", "mcp.js"))};
import { StdioServerTransport } from ${JSON.stringify(path.join(repositoryRoot, "node_modules", "@modelcontextprotocol", "sdk", "dist", "esm", "server", "stdio.js"))};
const names = ["NOTION_HOME", "NOTION_API_TOKEN", "NOTION_KEYRING", "NOTION_WORKERS_CONFIG_FILE"];
appendFileSync(${JSON.stringify(mcpMarker)}, JSON.stringify(Object.fromEntries(names.map(name => [name, process.env[name] === undefined ? "unset" : "set"]))) + "\\n");
await new McpServer({ name: "notion-env-fixture", version: "1.0.0" }).connect(new StdioServerTransport());
`);
  const mcpConfig = JSON.stringify({
    mcpServers: {
      fixture: {
        command: process.execPath,
        args: [mcpFixture],
        env: {
          NOTION_HOME: "must-not-propagate",
          NOTION_API_TOKEN: "must-not-propagate",
          NOTION_KEYRING: "must-not-propagate",
          NOTION_WORKERS_CONFIG_FILE: "must-not-propagate",
        },
      },
    },
  });
  return { configDir, mcpConfig, mcpMarker, notionHome, root, tmpdir, toolRoot, workspace };
}

function startRuntime(fixture, baseURL, sessionArgs, notionEnvironment) {
  const child = spawn(executable, [
    "--output-format", "stream-json",
    "--input-format", "stream-json",
    "--model", "claude-cleanroom-notion",
    "--permission-mode", "bypassPermissions",
    "--max-turns", "3",
    "--mcp-config", fixture.mcpConfig,
    ...sessionArgs,
  ], {
    cwd: fixture.workspace,
    env: {
      ...process.env,
      ANTHROPIC_API_KEY: "",
      ANTHROPIC_AUTH_TOKEN: "provider-free-notion-token",
      ANTHROPIC_BASE_URL: baseURL,
      CLAUDE_CODE_TMPDIR: fixture.tmpdir,
      CLAUDE_CONFIG_DIR: fixture.configDir,
      PATH: `${fixture.toolRoot}${path.delimiter}${process.env.PATH ?? ""}`,
      ...notionEnvironment,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const frames = [];
  const waiters = new Set();
  let stderr = "";
  createInterface({ input: child.stdout, crlfDelay: Number.POSITIVE_INFINITY }).on("line", (line) => {
    frames.push(JSON.parse(line));
    for (const wake of waiters) wake();
  });
  child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
  return {
    child,
    frames,
    stderr: () => stderr,
    send(frame) { child.stdin.write(`${JSON.stringify(frame)}\n`); },
    waitFor(predicate, timeoutMs = 10_000) {
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

async function runRuntime(runtime, prompt, suffix) {
  runtime.send({
    type: "control_request",
    request_id: `notion-init-${suffix}`,
    request: { subtype: "initialize", hooks: {} },
  });
  await runtime.waitFor((frame) =>
    frame.type === "control_response" && frame.response?.request_id === `notion-init-${suffix}`);
  runtime.send({ type: "user", message: { role: "user", content: prompt } });
  const result = await runtime.waitFor((frame) =>
    frame.type === "result" && frame.result === "notion-bash-complete");
  assert.equal(result.is_error, false);
  runtime.child.stdin.end();
  const [exitCode, signal] = await once(runtime.child, "exit");
  assert.equal(exitCode, 0, `Runtime failed with ${signal}: ${runtime.stderr()}`);
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

test("compiled Runtime reprojects Notion env per fresh/resume process and keeps MCP private", async (t) => {
  if (process.platform !== "darwin" && process.platform !== "linux") {
    return t.skip("production sandbox is unavailable on this platform");
  }
  const fixture = await runtimeFixture(t);
  const messages = await startMessagesFixture();
  t.after(() => messages.close());

  const fresh = startRuntime(fixture, messages.baseURL, [`--session-id=${SESSION_ID}`], {
    NOTION_HOME: fixture.notionHome,
    NOTION_API_TOKEN: firstToken,
    NOTION_KEYRING: "1",
  });
  await runRuntime(fresh, "VALID_NOTION_ENV", "fresh");

  const resumed = startRuntime(fixture, messages.baseURL, [`--resume=${SESSION_ID}`], {
    NOTION_HOME: path.join(fixture.root, "foreign-thread", ".notion-home"),
    NOTION_API_TOKEN: secondToken,
    NOTION_KEYRING: "1",
  });
  await runRuntime(resumed, "FOREIGN_NOTION_ENV", "resume");

  assert.match(messages.toolResults[0], /NOTION_HOME=set/);
  assert.match(messages.toolResults[0], /NOTION_API_TOKEN=set/);
  assert.match(messages.toolResults[0], /NOTION_KEYRING=set/);
  assert.match(messages.toolResults[0], /NOTION_WORKERS_CONFIG_FILE=unset/);
  assert.match(messages.toolResults[1], /NOTION_HOME=unset/);
  assert.match(messages.toolResults[1], /NOTION_API_TOKEN=unset/);
  assert.match(messages.toolResults[1], /NOTION_KEYRING=unset/);
  assert.match(messages.toolResults[1], /NOTION_WORKERS_CONFIG_FILE=unset/);

  const mcpStatuses = (await readFile(fixture.mcpMarker, "utf8"))
    .trimEnd().split("\n").map((line) => JSON.parse(line));
  assert.equal(mcpStatuses.length, 2);
  for (const status of mcpStatuses) {
    assert.deepEqual(status, {
      NOTION_HOME: "unset",
      NOTION_API_TOKEN: "unset",
      NOTION_KEYRING: "unset",
      NOTION_WORKERS_CONFIG_FILE: "unset",
    });
  }
  const observable = JSON.stringify({
    requests: messages.requests,
    frames: [...fresh.frames, ...resumed.frames],
    stderr: `${fresh.stderr()}${resumed.stderr()}`,
  });
  assert.equal(observable.includes(firstToken), false);
  assert.equal(observable.includes(secondToken), false);
});
