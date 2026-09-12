// [Input] Run identical provider-free CLI requests directly against the fake core and through the built envelope.
// [Output] Compare opaque protocol bytes/carriers and document the envelope's intentional supervision semantics.
// [Pos] Paired process-boundary differential suite; it is not official-core, OAuth, Remote, or provider evidence.
// [Sync] 2026-09-13: compare against the Runtime 0.1.7 release path.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

const envelope = resolve(
  "dist/release/ink-claude-code-dream-0.1.7/bin/ink-claude-code-dream",
);
const fakeCore = resolve("tests/fixtures/fake-claude.mjs");
await chmod(fakeCore, 0o755);

const CONTROL_ENV_KEYS = [
  "INK_CLAUDE_CODE_EXECUTABLE",
  "INK_CLAUDE_RUNTIME_MANIFEST_PATH",
  "INK_CLAUDE_RUNTIME_WORKSPACE_ROOT",
  "INK_CLAUDE_RUNTIME_TIMEOUT_MS",
  "INK_CLAUDE_RUNTIME_KILL_GRACE_MS",
  "INK_CLAUDE_BARE_PROFILE",
  "CLAUDE_CODE_CLI_PATH",
];

function sanitizedEnvironment(extra = {}) {
  const environment = { ...process.env, ...extra };
  for (const key of CONTROL_ENV_KEYS) delete environment[key];
  return environment;
}

async function workspaceFixture(prefix = "ink-runtime-differential-") {
  const workspace = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  const claudeTmpdir = join(workspace, ".claude-tmp");
  await mkdir(claudeTmpdir, { mode: 0o700 });
  return { workspace, claudeTmpdir };
}

function runNodeScript(script, args, { env, input, cwd }) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.once("error", reject);
    child.once("close", (code, signal) => {
      resolveRun({
        code,
        signal,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
      });
    });
    child.stdin.end(input);
  });
}

async function pairedRun(fixture, args, input, extraEnv = {}) {
  const directRecord = join(fixture.workspace, "direct-record.json");
  const envelopeRecord = join(fixture.workspace, "envelope-record.json");
  const shared = {
    CLAUDE_CODE_TMPDIR: fixture.claudeTmpdir,
    CLAUDE_CONFIG_DIR: join(fixture.workspace, ".claude-home"),
    MCP_USER_TOKEN: "fixture-mcp-token",
    PLUGIN_PATH: join(fixture.workspace, "plugins"),
    ANTHROPIC_API_KEY: "fixture-api-key",
    ANTHROPIC_AUTH_TOKEN: "fixture-auth-token",
    CLAUDE_CODE_OAUTH_TOKEN: "fixture-oauth-token",
    CLAUDE_CODE_USE_BEDROCK: "1",
    CLAUDE_CODE_USE_VERTEX: "1",
    CLAUDE_CODE_USE_FOUNDRY: "1",
    ...extraEnv,
  };
  const directEnv = sanitizedEnvironment({
    ...shared,
    FAKE_CLAUDE_RECORD: directRecord,
  });
  const envelopeEnv = {
    ...sanitizedEnvironment({
      ...shared,
      FAKE_CLAUDE_RECORD: envelopeRecord,
    }),
    INK_CLAUDE_CODE_EXECUTABLE: fakeCore,
    INK_CLAUDE_RUNTIME_WORKSPACE_ROOT: fixture.workspace,
  };
  const [direct, wrapped] = await Promise.all([
    runNodeScript(fakeCore, args, {
      cwd: fixture.workspace,
      env: directEnv,
      input,
    }),
    runNodeScript(envelope, args, {
      cwd: fixture.workspace,
      env: envelopeEnv,
      input,
    }),
  ]);
  const [directReceipt, envelopeReceipt] = await Promise.all([
    readFile(directRecord, "utf8").then(JSON.parse),
    readFile(envelopeRecord, "utf8").then(JSON.parse),
  ]);
  return { direct, wrapped, directReceipt, envelopeReceipt };
}

function comparableResult(result) {
  return {
    code: result.code,
    signal: result.signal,
    stdoutBase64: result.stdout.toString("base64"),
    stderrBase64: result.stderr.toString("base64"),
  };
}

test("paired JSONL request preserves argv, bytes, cwd, session, MCP, tool, sandbox, workspace, and auth carriers", async () => {
  const fixture = await workspaceFixture();
  try {
    const settings = join(fixture.workspace, "settings.json");
    const mcpConfig = join(fixture.workspace, "mcp.json");
    const pluginDirectory = join(fixture.workspace, "plugins");
    const additionalDirectory = join(fixture.workspace, "additional-workspace");
    await writeFile(
      settings,
      '{"sandbox":{"enabled":true},"permissions":{"defaultMode":"default"}}\n',
    );
    await writeFile(mcpConfig, '{"mcpServers":{"fixture":{"command":"true"}}}\n');
    await mkdir(pluginDirectory);
    await mkdir(additionalDirectory);
    const args = [
      "-p",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--verbose",
      "--resume",
      "session-provider-free",
      "--settings",
      settings,
      "--strict-mcp-config",
      "--mcp-config",
      mcpConfig,
      "--plugin-dir",
      pluginDirectory,
      "--add-dir",
      additionalDirectory,
      "--allowedTools",
      "Read",
      "--disallowedTools",
      "Write",
    ];
    const input = Buffer.from(
      '{"type":"user","message":{"role":"user","content":"opaque-sdk"}}\n' +
        '{"type":"control_response","response":{"subtype":"can_use_tool","behavior":"allow"}}\n',
    );
    const result = await pairedRun(fixture, args, input);
    assert.deepEqual(comparableResult(result.wrapped), comparableResult(result.direct));
    assert.deepEqual(result.envelopeReceipt, result.directReceipt);
    assert.deepEqual(result.envelopeReceipt.args, args);
    assert.equal(result.envelopeReceipt.stdinBase64, input.toString("base64"));
    assert.equal(result.envelopeReceipt.cwd, fixture.workspace);
    assert.equal(result.envelopeReceipt.env.CLAUDE_CODE_TMPDIR, fixture.claudeTmpdir);
    assert.deepEqual(result.envelopeReceipt.env.authenticationPresence, {
      ANTHROPIC_API_KEY: true,
      ANTHROPIC_AUTH_TOKEN: true,
      CLAUDE_CODE_OAUTH_TOKEN: true,
      CLAUDE_CODE_USE_BEDROCK: true,
      CLAUDE_CODE_USE_VERTEX: true,
      CLAUDE_CODE_USE_FOUNDRY: true,
    });
  } finally {
    await rm(fixture.workspace, { recursive: true, force: true });
  }
});

test("paired management failure preserves stdout, stderr, and nonzero exit", async () => {
  const fixture = await workspaceFixture();
  try {
    const input = Buffer.from("opaque-management-failure\n");
    const result = await pairedRun(fixture, ["mcp", "get", "missing"], input, {
      FAKE_CLAUDE_EXIT_CODE: "19",
    });
    assert.deepEqual(comparableResult(result.wrapped), comparableResult(result.direct));
    assert.deepEqual(result.envelopeReceipt, result.directReceipt);
    assert.equal(result.wrapped.code, 19);
  } finally {
    await rm(fixture.workspace, { recursive: true, force: true });
  }
});

function closeResult(child) {
  return new Promise((resolveClose, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolveClose({ code, signal }));
  });
}

function readiness(child, timeoutMs = 5000) {
  return new Promise((resolveReady, reject) => {
    let output = "";
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("lifecycle fixture readiness timed out"));
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timeout);
      child.stdout.off("data", onData);
      child.off("close", onClose);
    };
    const onData = (chunk) => {
      output += chunk.toString("utf8");
      const match = output.match(/INK_FAKE_GRANDCHILD_READY:(\d+)\n/);
      if (!match) return;
      cleanup();
      resolveReady(Number(match[1]));
    };
    const onClose = (code, signal) => {
      cleanup();
      reject(new Error(`lifecycle fixture closed before ready: ${code}/${signal}`));
    };
    child.stdout.on("data", onData);
    child.once("close", onClose);
  });
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
}

function killIfPresent(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return;
  try {
    process.kill(pid, "SIGKILL");
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}

function settlesWithin(promise, timeoutMs) {
  return new Promise((resolveSettled) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolveSettled(value);
    };
    const timeout = setTimeout(() => finish(false), timeoutMs);
    promise.then(() => finish(true), () => finish(true));
  });
}

async function signalLane(fixture, script, throughEnvelope) {
  const heartbeat = join(
    fixture.workspace,
    throughEnvelope ? "envelope-heartbeat" : "direct-heartbeat",
  );
  const pidPath = join(
    fixture.workspace,
    throughEnvelope ? "envelope-grandchild.pid" : "direct-grandchild.pid",
  );
  const leaderPidPath = join(
    fixture.workspace,
    throughEnvelope ? "envelope-leader.pid" : "direct-leader.pid",
  );
  const environment = sanitizedEnvironment({
    CLAUDE_CODE_TMPDIR: fixture.claudeTmpdir,
    FAKE_GRANDCHILD_HEARTBEAT: heartbeat,
    FAKE_GRANDCHILD_PID: pidPath,
    FAKE_LEADER_PID: leaderPidPath,
    FAKE_LEADER_EXITS_ON_TERM: "1",
  });
  if (throughEnvelope) {
    environment.INK_CLAUDE_CODE_EXECUTABLE = fakeCore;
    environment.INK_CLAUDE_RUNTIME_WORKSPACE_ROOT = fixture.workspace;
    environment.INK_CLAUDE_RUNTIME_KILL_GRACE_MS = "2000";
  }
  const child = spawn(process.execPath, [script, "--fake-grandchild"], {
    cwd: fixture.workspace,
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const closed = closeResult(child);
  let leaderPid;
  let grandchildPid;
  try {
    grandchildPid = await readiness(child);
    leaderPid = Number(await readFile(leaderPidPath, "utf8"));
    child.kill("SIGTERM");
    const result = await closed;
    return { result, grandchildPid, descendantAlive: processExists(grandchildPid) };
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    if (!leaderPid) {
      leaderPid = await readFile(leaderPidPath, "utf8")
        .then(Number)
        .catch(() => undefined);
    }
    if (!grandchildPid) {
      grandchildPid = await readFile(pidPath, "utf8")
        .then(Number)
        .catch(() => undefined);
    }
    killIfPresent(leaderPid);
    killIfPresent(grandchildPid);
    await settlesWithin(closed, 1000);
  }
}

test("paired SIGTERM records the envelope's intentional exit mapping and descendant cleanup", async () => {
  const fixture = await workspaceFixture();
  try {
    const direct = await signalLane(fixture, fakeCore, false);
    const wrapped = await signalLane(fixture, envelope, true);
    assert.deepEqual(direct.result, { code: 0, signal: null });
    assert.equal(direct.descendantAlive, true);
    assert.deepEqual(wrapped.result, { code: 143, signal: null });
    assert.equal(wrapped.descendantAlive, false);
  } finally {
    await rm(fixture.workspace, { recursive: true, force: true });
  }
});
