#!/usr/bin/env node
// [Input] Public clean-room modules, a disposable Workspace/config home, and SDK-shaped argv.
// [Output] Provider-free evidence for Dream tool inventory, local tools, durable tasks, and stored Bash output.
// [Pos] Dream-specific P0/P1 compatibility gate; it does not read vendor or restored Runtime source.
// [Sync] 2026-09-12: cover documented tool aliases and fail-closed unknown options.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createInterface } from "node:readline";
import { parseRuntimeArgv } from "../src/cleanroom/argv.ts";
import { dispatchCleanroomTool } from "../src/cleanroom/tools/dispatch.ts";
import { ToolPermissionPolicy } from "../src/cleanroom/tools/permissions.ts";
import { WorkspaceBoundary } from "../src/cleanroom/tools/workspace.ts";
import { BoundedProcessFixtureSandbox } from "../src/cleanroom/sandbox/process-fixture.ts";

async function fixture(t) {
  const base = await realpath(await mkdtemp(path.join(os.tmpdir(), "ink-cleanroom-dream-protocol-")));
  t.after(() => rm(base, { recursive: true, force: true }));
  const workspacePath = path.join(base, "workspace");
  const configDir = path.join(workspacePath, ".claude-home");
  const stateDirectory = path.join(configDir, "projects", "fixture", "session-private");
  await mkdir(workspacePath, { mode: 0o700 });
  await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
  return {
    base,
    configDir,
    stateDirectory,
    workspacePath,
    workspace: await WorkspaceBoundary.create(workspacePath),
  };
}

test("argv distinguishes default tools from an explicit empty --tools inventory", () => {
  assert.equal(parseRuntimeArgv([]).tools, undefined);
  assert.equal(parseRuntimeArgv(["--tools", "default"]).tools, undefined);
  assert.deepEqual(parseRuntimeArgv(["--tools", ""]).tools, []);
  assert.deepEqual(parseRuntimeArgv(["--tools", "Read,mcp__user__lookup"]).tools, [
    "Read",
    "mcp__user__lookup",
  ]);
});

test("argv accepts the reference tool aliases and rejects unknown options", () => {
  const parsed = parseRuntimeArgv([
    "-p",
    "-r", "session-from-short-alias",
    "--allowedTools", "Read",
    "--allowed-tools", "Grep",
    "--disallowedTools", "Write",
    "--disallowed-tools", "Edit",
  ]);
  assert.deepEqual(parsed.allowedTools, ["Read", "Grep"]);
  assert.deepEqual(parsed.disallowedTools, ["Write", "Edit"]);
  assert.equal(parsed.resume, "session-from-short-alias");
  assert.throws(
    () => parseRuntimeArgv(["--invented-runtime-mode", "enabled"]),
    /unsupported option: --invented-runtime-mode/,
  );
  assert.throws(
    () => parseRuntimeArgv(["--invented-runtime-mode=enabled"]),
    /unsupported option: --invented-runtime-mode/,
  );
  assert.throws(
    () => parseRuntimeArgv(["-x"]),
    /unsupported option: -x/,
  );
});

test("explicit empty --tools exposes no built-ins and disallowedTools removes inventory", async () => {
  const runInitialize = async (args) => {
    const repositoryRoot = path.resolve(import.meta.dirname, "..");
    const child = spawn(path.join(repositoryRoot, "node_modules", ".bin", "bun"), ["src/cleanroom/cli.ts", ...args], {
      cwd: repositoryRoot,
      env: { ...process.env, ANTHROPIC_API_KEY: "fixture-not-used" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const frames = [];
    createInterface({ input: child.stdout, crlfDelay: Number.POSITIVE_INFINITY }).on("line", (line) => {
      frames.push(JSON.parse(line));
    });
    child.stdin.write(`${JSON.stringify({ type: "control_request", request_id: "init", request: { subtype: "initialize" } })}\n`);
    child.stdin.end();
    const [code] = await once(child, "exit");
    assert.equal(code, 0);
    return frames.find((frame) => frame.type === "system" && frame.subtype === "init");
  };
  const empty = await runInitialize(["--tools", "", "--input-format", "stream-json", "--output-format", "stream-json"]);
  assert.deepEqual(empty.tools, []);
  const filtered = await runInitialize(["--disallowedTools", "Read,mcp__user__*", "--input-format", "stream-json", "--output-format", "stream-json"]);
  assert.equal(filtered.tools.includes("Read"), false);
  assert(filtered.tools.includes("Write"));
});

test("Dream local tools remain confined and persist only private session/task state", async (t) => {
  const f = await fixture(t);
  const previousConfig = process.env.CLAUDE_CONFIG_DIR;
  const previousList = process.env.CLAUDE_CODE_TASK_LIST_ID;
  process.env.CLAUDE_CONFIG_DIR = f.configDir;
  process.env.CLAUDE_CODE_TASK_LIST_ID = "main";
  t.after(() => {
    if (previousConfig === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = previousConfig;
    if (previousList === undefined) delete process.env.CLAUDE_CODE_TASK_LIST_ID;
    else process.env.CLAUDE_CODE_TASK_LIST_ID = previousList;
  });
  const sandbox = await BoundedProcessFixtureSandbox.create({
    allowUnisolatedProcessForTests: true,
    workspaceRoot: f.workspacePath,
  });
  const context = {
    workspace: f.workspace,
    permissions: new ToolPermissionPolicy({ mode: "bypassPermissions" }),
    stateDirectory: f.stateDirectory,
    sandbox,
    allowUntrustedSandboxForTests: true,
  };

  await writeFile(path.join(f.workspacePath, "note.txt"), "alpha beta gamma", "utf8");
  const multi = await dispatchCleanroomTool("MultiEdit", {
    file_path: "note.txt",
    edits: [
      { old_string: "alpha", new_string: "A" },
      { old_string: "gamma", new_string: "G" },
    ],
  }, "multi-1", context);
  assert.equal(multi.isError, false, multi.content);
  assert.equal(await readFile(path.join(f.workspacePath, "note.txt"), "utf8"), "A beta G");

  const ls = await dispatchCleanroomTool("LS", {}, "ls-1", context);
  assert.match(ls.content, /note\.txt/);
  await writeFile(path.join(f.workspacePath, "book.ipynb"), JSON.stringify({
    cells: [{ cell_type: "code", source: ["print('ok')"], outputs: [] }],
  }), "utf8");
  const notebook = await dispatchCleanroomTool(
    "NotebookRead",
    { notebook_path: "book.ipynb" },
    "notebook-1",
    context,
  );
  assert.match(notebook.content, /print\('ok'\)/);

  const todoWrite = await dispatchCleanroomTool("TodoWrite", {
    todos: [{ content: "验证协议", status: "in_progress", activeForm: "正在验证协议" }],
  }, "todo-write", context);
  assert.equal(todoWrite.isError, false, todoWrite.content);
  const todoRead = await dispatchCleanroomTool("TodoRead", {}, "todo-read", context);
  assert.deepEqual(JSON.parse(todoRead.content), [
    { content: "验证协议", status: "in_progress", activeForm: "正在验证协议" },
  ]);

  const created = await dispatchCleanroomTool("TaskCreate", {
    subject: "打包 Runtime",
    activeForm: "正在打包 Runtime",
  }, "task-create", context);
  assert.equal(created.isError, false, created.content);
  assert.equal(JSON.parse(created.content).id, "1");
  const updated = await dispatchCleanroomTool("TaskUpdate", {
    taskId: "1",
    status: "completed",
  }, "task-update", context);
  assert.equal(JSON.parse(updated.content).status, "completed");
  const listed = await dispatchCleanroomTool("TaskList", {}, "task-list", context);
  assert.equal(JSON.parse(listed.content).length, 1);
  const fetched = await dispatchCleanroomTool("TaskGet", { taskId: "1" }, "task-get", context);
  assert.equal(JSON.parse(fetched.content).subject, "打包 Runtime");
  assert.equal(
    JSON.parse(await readFile(path.join(f.configDir, "tasks", "main", "1.json"), "utf8")).status,
    "completed",
  );

  const bash = await dispatchCleanroomTool(
    "Bash",
    { command: "printf bounded-output" },
    "bash-safe-id",
    context,
  );
  assert.equal(bash.isError, false, bash.content);
  assert.match(bash.content, /shell_id bash-safe-id/);
  const output = await dispatchCleanroomTool(
    "BashOutput",
    { bash_id: "bash-safe-id" },
    "bash-output",
    context,
  );
  assert.match(output.content, /bounded-output/);
});
