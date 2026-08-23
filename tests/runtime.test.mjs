// [Input] Exercise the built Node launcher with deterministic fake Claude CLI processes and release metadata.
// [Output] Prove Runtime evidence, opaque CLI/SDK/MCP forwarding, version/TMPDIR gates, lifecycle cleanup, and lazy imports.
// [Pos] Provider-free runtime contract suite; it does not claim a real Dream/model acceptance.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { test } from "node:test";

const executable = resolve(
  "dist/release/ink-claude-runtime-0.1.0/bin/ink-claude-runtime.mjs",
);
const fakeClaude = resolve("tests/fixtures/fake-claude.mjs");
await chmod(fakeClaude, 0o755);

function run(args, { env = {}, input = Buffer.alloc(0), cwd = process.cwd() } = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [executable, ...args], {
      env: { ...process.env, ...env },
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.once("error", reject);
    child.once("close", (code, signal) =>
      resolveRun({
        code,
        signal,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
      }),
    );
    child.stdin.end(input);
  });
}

async function workspaceFixture() {
  const workspace = await mkdtemp(join(tmpdir(), "ink-runtime-test-"));
  const claudeTmpdir = join(workspace, ".claude-tmp");
  await mkdir(claudeTmpdir, { mode: 0o700 });
  await chmod(claudeTmpdir, 0o700);
  return { workspace, claudeTmpdir };
}

function runtimeEnv(fixture, extra = {}) {
  return {
    INK_CLAUDE_CODE_EXECUTABLE: fakeClaude,
    INK_CLAUDE_RUNTIME_WORKSPACE_ROOT: fixture.workspace,
    CLAUDE_CODE_TMPDIR: fixture.claudeTmpdir,
    ...extra,
  };
}

test("Runtime manifest diagnostic does not need or launch a Claude core", async () => {
  const result = await run(["--runtime-manifest"], {
    env: { INK_CLAUDE_CODE_EXECUTABLE: "/definitely/missing" },
  });
  assert.equal(result.code, 0);
  const envelope = JSON.parse(result.stdout.toString("utf8"));
  assert.equal(envelope.manifest.schemaVersion, "ink-claude-cli-envelope/v1");
  assert.equal(envelope.manifest.protocol.name, "claude-code-stream-json");
  assert.equal(envelope.manifest.protocol.version, 1);
  assert.equal(envelope.manifest.core.loadingReduction, 0);
  assert.equal(envelope.manifest.core.version, "2.1.241");
  assert.equal(envelope.manifest.core.execution, "unmodified-as-published");
  assert.equal(envelope.manifest.runtime.integration.sdkModified, false);
  assert.equal(envelope.manifest.runtime.integration.sdkVersion, "0.2.143");
  assert.equal(envelope.manifest.runtime.integration.environment, "CLAUDE_CODE_CLI_PATH");
  assert.match(envelope.sha256, /^[a-f0-9]{64}$/);
});

test("MCP 1.27.0 and 1.27.1 are Runtime evidence, not an SDK handshake", async () => {
  const envelope = JSON.parse((await run(["--runtime-manifest"])).stdout.toString("utf8"));
  assert.deepEqual(envelope.manifest.mcpVersionsRegressed, [
    "1.27.0",
    "1.27.1",
  ]);
  assert.deepEqual(envelope.manifest.claudeCodeMcpChangelogVersions, [
    "2.1.240",
    "2.1.238",
  ]);
});

test("argv, JSONL stdin/stdout, stderr, cwd, MCP/plugin env stay opaque", async () => {
  const fixture = await workspaceFixture();
  const recordPath = join(fixture.workspace, "record.json");
  const configPath = join(fixture.workspace, "mcp.json");
  const versionCount = join(fixture.workspace, "version-count");
  await writeFile(configPath, '{"mcpServers":{"remote":{"type":"sse"}}}\n');
  const input = Buffer.from(
    '{"type":"user","message":{"role":"user","content":"hello"}}\n' +
      '{"type":"control_response","response":{"subtype":"can_use_tool"}}\n',
  );
  const args = [
    "-p",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    "--resume",
    "session-123",
    "--mcp-config",
    configPath,
    "--plugin-dir",
    join(fixture.workspace, ".ink", "plugins", "example"),
  ];
  const result = await run(args, {
    input,
    env: runtimeEnv(fixture, {
      FAKE_CLAUDE_RECORD: recordPath,
      FAKE_VERSION_COUNT: versionCount,
      CLAUDE_CONFIG_DIR: join(fixture.workspace, ".claude-home"),
      MCP_USER_TOKEN: "test-only-token",
      PLUGIN_PATH: join(fixture.workspace, ".ink", "plugins"),
    }),
  });
  assert.equal(result.code, 0);
  assert.deepEqual(result.stdout, input);
  assert.equal(result.stderr.toString("utf8"), "fake-claude-stderr\n");
  const record = JSON.parse(await readFile(recordPath, "utf8"));
  assert.deepEqual(record.args, args);
  assert.equal(record.stdinBase64, input.toString("base64"));
  assert.equal(record.cwd, process.cwd());
  assert.equal(record.env.CLAUDE_CODE_TMPDIR, fixture.claudeTmpdir);
  assert.equal(record.env.MCP_USER_TOKEN, "test-only-token");
  assert.equal(record.env.INK_CLAUDE_CODE_EXECUTABLE, null);
  assert.equal(record.env.INK_CLAUDE_RUNTIME_WORKSPACE_ROOT, null);
  await assert.rejects(readFile(versionCount), /ENOENT/);
});

test("MCP/auth management, version, and help pass through without thread TMPDIR", async () => {
  const root = await mkdtemp(join(tmpdir(), "ink-runtime-mcp-"));
  const commands = [
    ["mcp", "add", "--transport", "http", "name", "https://example.test/mcp"],
    ["mcp", "login", "name", "--no-browser"],
    ["mcp", "get", "name"],
    ["mcp", "list"],
    ["mcp", "logout", "name"],
    ["mcp", "remove", "name"],
    ["mcp", "--help"],
    ["mcp", "--version"],
    ["auth", "login"],
    ["auth", "logout"],
    ["auth", "status"],
    ["setup-token"],
    ["--help"],
  ];
  for (const [index, args] of commands.entries()) {
    const recordPath = join(root, `record-${index}.json`);
    const input = Buffer.from(`opaque-management-${index}\n`);
    const result = await run(args, {
      input,
      env: {
        INK_CLAUDE_CODE_EXECUTABLE: fakeClaude,
        FAKE_CLAUDE_RECORD: recordPath,
        INK_CLAUDE_BARE_PROFILE: "dream-explicit-v1",
        ANTHROPIC_API_KEY: "fixture-api-key",
        ANTHROPIC_AUTH_TOKEN: "fixture-auth-token",
        CLAUDE_CODE_OAUTH_TOKEN: "fixture-oauth-token",
        CLAUDE_CODE_USE_BEDROCK: "1",
        CLAUDE_CODE_USE_VERTEX: "1",
        CLAUDE_CODE_USE_FOUNDRY: "1",
      },
    });
    assert.equal(result.code, 0, `${args.join(" ")} failed`);
    const record = JSON.parse(await readFile(recordPath, "utf8"));
    assert.deepEqual(record.args, args);
    assert.deepEqual(result.stdout, input);
    assert.equal(result.stderr.toString("utf8"), "fake-claude-stderr\n");
    assert.equal(record.stdinBase64, input.toString("base64"));
    assert.equal(record.env.CLAUDE_CODE_TMPDIR, null);
    assert.equal(record.env.CLAUDE_CODE_CLI_PATH, null);
    assert.equal(record.env.INK_CLAUDE_BARE_PROFILE, null);
    assert.deepEqual(record.env.authenticationPresence, {
      ANTHROPIC_API_KEY: true,
      ANTHROPIC_AUTH_TOKEN: true,
      CLAUDE_CODE_OAUTH_TOKEN: true,
      CLAUDE_CODE_USE_BEDROCK: true,
      CLAUDE_CODE_USE_VERTEX: true,
      CLAUDE_CODE_USE_FOUNDRY: true,
    });
  }

  const nonzero = await run(["mcp", "get", "missing"], {
    input: Buffer.from("opaque-nonzero\n"),
    env: {
      INK_CLAUDE_CODE_EXECUTABLE: fakeClaude,
      FAKE_CLAUDE_EXIT_CODE: "19",
    },
  });
  assert.equal(nonzero.code, 19);
  assert.equal(nonzero.stdout.toString("utf8"), "opaque-nonzero\n");
});

test("SDK -v output is passed through while doctor alone enforces the pin", async () => {
  const root = await mkdtemp(join(tmpdir(), "ink-runtime-version-"));
  const versionCount = join(root, "version-count");
  const good = await run(["-v"], {
    env: {
      INK_CLAUDE_CODE_EXECUTABLE: fakeClaude,
      FAKE_VERSION_COUNT: versionCount,
    },
  });
  assert.equal(good.code, 0);
  assert.equal(good.stdout.toString("utf8"), "2.1.241 (Claude Code)\n");
  assert.equal(await readFile(versionCount, "utf8"), "v");

  const passThroughMismatch = await run(["--version"], {
    env: {
      INK_CLAUDE_CODE_EXECUTABLE: fakeClaude,
      FAKE_CLAUDE_VERSION: "2.1.240",
    },
  });
  assert.equal(passThroughMismatch.code, 0);
  assert.equal(passThroughMismatch.stdout.toString("utf8"), "2.1.240 (Claude Code)\n");

  const doctorMismatch = await run(["--runtime-doctor"], {
    env: {
      INK_CLAUDE_CODE_EXECUTABLE: fakeClaude,
      FAKE_CLAUDE_VERSION: "2.1.240",
    },
  });
  assert.equal(doctorMismatch.code, 70);
  assert.match(doctorMismatch.stderr.toString("utf8"), /incompatible/);
});

test("explicit bare profile forwards exact argv and fails closed on missing carriers", async () => {
  const fixture = await workspaceFixture();
  const settings = join(fixture.workspace, "explicit-settings.json");
  const mcpConfig = join(fixture.workspace, "explicit-mcp.json");
  const pluginDirectory = join(fixture.workspace, "explicit-plugin");
  const recordPath = join(fixture.workspace, "bare-record.json");
  await writeFile(settings, '{"hooks":{},"sandbox":{},"permissions":{}}\n');
  await writeFile(mcpConfig, '{"mcpServers":{"fixture":{"command":"true"}}}\n');
  await mkdir(pluginDirectory);
  const args = [
    "--bare",
    "-p",
    "--settings",
    settings,
    "--strict-mcp-config",
    "--mcp-config",
    mcpConfig,
    "--plugin-dir",
    pluginDirectory,
    "--resume",
    "session-123",
  ];
  const result = await run(args, {
    cwd: fixture.workspace,
    env: runtimeEnv(fixture, {
      INK_CLAUDE_BARE_PROFILE: "dream-explicit-v1",
      FAKE_CLAUDE_RECORD: recordPath,
    }),
  });
  assert.equal(result.code, 0);
  const record = JSON.parse(await readFile(recordPath, "utf8"));
  assert.deepEqual(record.args, args);
  assert.equal(record.env.INK_CLAUDE_BARE_PROFILE, null);

  const missingProfile = await run(args, {
    cwd: fixture.workspace,
    env: runtimeEnv(fixture),
  });
  assert.equal(missingProfile.code, 70);
  assert.match(missingProfile.stderr.toString("utf8"), /requires explicit/);

  const missingPlugin = await run(
    args.slice(0, args.indexOf("--plugin-dir")),
    {
      cwd: fixture.workspace,
      env: runtimeEnv(fixture, { INK_CLAUDE_BARE_PROFILE: "dream-explicit-v1" }),
    },
  );
  assert.equal(missingPlugin.code, 70);
  assert.match(missingPlugin.stderr.toString("utf8"), /requires --plugin-dir/);
});

test("configured external artifact path must be absolute", async () => {
  const result = await run(["--version"], {
    env: { INK_CLAUDE_CODE_EXECUTABLE: "relative/claude" },
  });
  assert.equal(result.code, 70);
  assert.match(result.stderr.toString("utf8"), /must be an absolute path/);
});

test("TMPDIR symlink and loose permissions fail closed", async () => {
  const fixture = await workspaceFixture();
  const real = join(fixture.workspace, "real-tmp");
  const link = join(fixture.workspace, "linked", ".claude-tmp");
  await mkdir(real, { mode: 0o700 });
  await mkdir(join(fixture.workspace, "linked"));
  await symlink(real, link);
  const symlinkResult = await run(["-p"], {
    env: runtimeEnv(fixture, {
      CLAUDE_CODE_TMPDIR: link,
      INK_CLAUDE_RUNTIME_WORKSPACE_ROOT: "",
    }),
  });
  assert.equal(symlinkResult.code, 70);
  assert.match(symlinkResult.stderr.toString("utf8"), /not a symlink/);

  await chmod(fixture.claudeTmpdir, 0o755);
  const modeResult = await run(["-p"], { env: runtimeEnv(fixture) });
  assert.equal(modeResult.code, 70);
  assert.match(modeResult.stderr.toString("utf8"), /0700/);
});

test("normal launch requires TMPDIR while Runtime manifest is not read on the hot path", async () => {
  const missingTmp = await run(["-p"], {
    env: { INK_CLAUDE_CODE_EXECUTABLE: fakeClaude },
  });
  assert.equal(missingTmp.code, 70);
  assert.match(missingTmp.stderr.toString("utf8"), /CLAUDE_CODE_TMPDIR/);
  const emptyInteractive = await run([], {
    env: { INK_CLAUDE_CODE_EXECUTABLE: fakeClaude },
  });
  assert.equal(emptyInteractive.code, 70);
  assert.match(emptyInteractive.stderr.toString("utf8"), /CLAUDE_CODE_TMPDIR/);
  const resume = await run(["-p", "--resume", "session-123"], {
    env: { INK_CLAUDE_CODE_EXECUTABLE: fakeClaude },
  });
  assert.equal(resume.code, 70);
  assert.match(resume.stderr.toString("utf8"), /CLAUDE_CODE_TMPDIR/);

  const fixture = await workspaceFixture();
  const result = await run(["-p"], {
    env: runtimeEnv(fixture, {
      INK_CLAUDE_RUNTIME_MANIFEST_PATH: "/definitely/missing/release manifest.json",
    }),
  });
  assert.equal(result.code, 0);
});

test("headless launch rejects the upstream SDK version-check bypass without spawning core", async () => {
  const fixture = await workspaceFixture();
  const recordPath = join(fixture.workspace, "skip-version-record.json");
  const result = await run(
    ["-p", "--output-format", "stream-json", "--input-format", "stream-json"],
    {
      env: runtimeEnv(fixture, {
        CLAUDE_AGENT_SDK_SKIP_VERSION_CHECK: "1",
        FAKE_CLAUDE_RECORD: recordPath,
      }),
    },
  );
  assert.equal(result.code, 70);
  assert.match(result.stderr.toString("utf8"), /SKIP_VERSION_CHECK is forbidden/);
  await assert.rejects(readFile(recordPath), /ENOENT/);
});

test("official child crash exit code is preserved", async () => {
  const fixture = await workspaceFixture();
  const result = await run(["--fake-crash"], { env: runtimeEnv(fixture) });
  assert.equal(result.code, 23);
});

test("timeout terminates the whole process group and returns 124", async () => {
  const fixture = await workspaceFixture();
  const heartbeat = join(fixture.workspace, "heartbeat");
  const pidPath = join(fixture.workspace, "grandchild.pid");
  const result = await run(["--fake-grandchild"], {
    env: runtimeEnv(fixture, {
      INK_CLAUDE_RUNTIME_TIMEOUT_MS: "120",
      INK_CLAUDE_RUNTIME_KILL_GRACE_MS: "120",
      FAKE_GRANDCHILD_HEARTBEAT: heartbeat,
      FAKE_GRANDCHILD_PID: pidPath,
    }),
  });
  assert.equal(result.code, 124);
  const grandchildPid = Number(await readFile(pidPath, "utf8"));
  await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  assert.throws(() => process.kill(grandchildPid, 0), /ESRCH/);
});

test("cancellation finishes immediately when the core leader exits and cleans descendants", async () => {
  const fixture = await workspaceFixture();
  const heartbeat = join(fixture.workspace, "cancel-heartbeat");
  const pidPath = join(fixture.workspace, "cancel-grandchild.pid");
  const child = spawn(process.execPath, [executable, "--fake-grandchild"], {
    env: {
      ...process.env,
      ...runtimeEnv(fixture, {
        INK_CLAUDE_RUNTIME_KILL_GRACE_MS: "2000",
        FAKE_GRANDCHILD_HEARTBEAT: heartbeat,
        FAKE_GRANDCHILD_PID: pidPath,
        FAKE_LEADER_EXITS_ON_TERM: "1",
      }),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let grandchildPid;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      grandchildPid = Number(await readFile(pidPath, "utf8"));
      break;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await new Promise((resolveWait) => setTimeout(resolveWait, 10));
    }
  }
  assert.ok(grandchildPid, "fake grandchild did not start");
  const started = performance.now();
  child.kill("SIGTERM");
  const result = await new Promise((resolveClose, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolveClose({ code, signal }));
  });
  const elapsed = performance.now() - started;
  assert.equal(result.code, 143);
  assert.ok(elapsed < 1000, `cancellation waited ${elapsed}ms for a 2000ms grace`);
  assert.throws(() => process.kill(grandchildPid, 0), /ESRCH/);
});

test("esbuild keeps launcher and Runtime manifest diagnostic behind dynamic imports", async () => {
  const metafile = JSON.parse(
    await readFile(
      resolve(
        "dist/release/ink-claude-runtime-0.1.0/manifest/esbuild-metafile.json",
      ),
      "utf8",
    ),
  );
  const entry = Object.values(metafile.outputs).find(
    (output) => output.entryPoint === "src/cli.ts",
  );
  assert.ok(entry, "CLI entry output missing");
  assert.ok(
    entry.imports.some((item) => item.kind === "dynamic-import"),
    "CLI entry must retain dynamic imports",
  );
  assert.equal(
    entry.imports.some(
      (item) => item.kind === "import-statement" && item.path.includes("launcher"),
    ),
    false,
  );
});
