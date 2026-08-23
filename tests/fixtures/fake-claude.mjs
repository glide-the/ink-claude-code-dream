#!/usr/bin/env node
// [Input] Consume launcher-forwarded argv/stdin/env and test-only behavior controls.
// [Output] Emulate the public Claude CLI process boundary for deterministic protocol/lifecycle tests.
// [Pos] Test fixture only; never copied into release artifacts.

import { appendFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--version") {
  if (process.env.FAKE_VERSION_COUNT) {
    await appendFile(process.env.FAKE_VERSION_COUNT, "v");
  }
  process.stdout.write(`${process.env.FAKE_CLAUDE_VERSION || "2.1.235"} (Claude Code)\n`);
  process.exit(0);
}
if (args.length === 1 && args[0] === "-v") {
  if (process.env.FAKE_VERSION_COUNT) {
    await appendFile(process.env.FAKE_VERSION_COUNT, "v");
  }
  process.stdout.write(`${process.env.FAKE_CLAUDE_VERSION || "2.1.235"} (Claude Code)\n`);
  process.exit(0);
}

const chunks = [];
for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
const input = Buffer.concat(chunks);
const recordPath = process.env.FAKE_CLAUDE_RECORD;
const record = {
  args,
  cwd: process.cwd(),
  stdinBase64: input.toString("base64"),
  env: {
    CLAUDE_CODE_TMPDIR: process.env.CLAUDE_CODE_TMPDIR ?? null,
    CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR ?? null,
    MCP_USER_TOKEN: process.env.MCP_USER_TOKEN ?? null,
    PLUGIN_PATH: process.env.PLUGIN_PATH ?? null,
    INK_CLAUDE_CODE_EXECUTABLE: process.env.INK_CLAUDE_CODE_EXECUTABLE ?? null,
    INK_CLAUDE_RUNTIME_WORKSPACE_ROOT:
      process.env.INK_CLAUDE_RUNTIME_WORKSPACE_ROOT ?? null,
    CLAUDE_CODE_CLI_PATH: process.env.CLAUDE_CODE_CLI_PATH ?? null,
  },
};
if (recordPath) await writeFile(recordPath, `${JSON.stringify(record)}\n`);

if (args.includes("--fake-crash")) process.exit(23);
if (args.includes("--fake-grandchild")) {
  const heartbeat = process.env.FAKE_GRANDCHILD_HEARTBEAT;
  const pidPath = process.env.FAKE_GRANDCHILD_PID;
  if (!heartbeat || !pidPath) process.exit(64);
  const grandchild = spawn(
    process.execPath,
    [
      "-e",
      `process.on('SIGTERM',()=>{});setInterval(()=>require('fs').appendFileSync(${JSON.stringify(
        heartbeat,
      )},'x'),20)`,
    ],
    { stdio: "ignore" },
  );
  await writeFile(pidPath, String(grandchild.pid));
  process.on("SIGTERM", () => {
    if (process.env.FAKE_LEADER_EXITS_ON_TERM === "1") process.exit(0);
  });
  await appendFile(heartbeat, "s");
  setInterval(() => {}, 1000);
  await new Promise(() => {});
}

process.stdout.write(input);
process.stderr.write("fake-claude-stderr\n");
if (process.env.FAKE_CLAUDE_EXIT_CODE) {
  process.exit(Number(process.env.FAKE_CLAUDE_EXIT_CODE));
}
