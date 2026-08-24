#!/usr/bin/env node
// [Input] Clean-room tool modules, temporary Workspace fixtures, and local SDK control frames.
// [Output] Provider-free evidence for file tools, confinement, permissions, and Bash lifecycle bounds.
// [Pos] Independent tools/workspace/sandbox slice contract; no provider or restored source is used.
// [Sync] 2026-08-24: cover six tools, traversal/symlink rejection, allow/deny, timeout, and cancel.

import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { dispatchCleanroomTool } from "../src/cleanroom/tools/dispatch.ts";
import {
  SdkPermissionChannel,
  ToolPermissionPolicy,
} from "../src/cleanroom/tools/permissions.ts";
import { WorkspaceBoundary } from "../src/cleanroom/tools/workspace.ts";
import { FailClosedSandbox } from "../src/cleanroom/sandbox/sandbox.ts";
import { BoundedProcessFixtureSandbox } from "../src/cleanroom/sandbox/process-fixture.ts";

async function fixture() {
  const base = await mkdtemp(path.join(os.tmpdir(), "ink-cleanroom-tools-"));
  const workspacePath = path.join(base, "workspace");
  const outsidePath = path.join(base, "outside");
  await mkdir(workspacePath, { mode: 0o700 });
  await mkdir(outsidePath, { mode: 0o700 });
  return {
    base,
    workspacePath,
    outsidePath,
    workspace: await WorkspaceBoundary.create(workspacePath),
    cleanup: () => rm(base, { recursive: true, force: true }),
  };
}

function allowAll() {
  return new ToolPermissionPolicy({ mode: "bypassPermissions" });
}

test("Read/Write/Edit/Glob/Grep stay inside the canonical Workspace", async () => {
  const target = await fixture();
  try {
    const context = { workspace: target.workspace, permissions: allowAll() };
    const written = await dispatchCleanroomTool(
      "Write",
      { file_path: "notes/entry.txt", content: "alpha\nbeta\nalpha\n" },
      "tool-write",
      context,
    );
    assert.equal(written.isError, false, written.content);
    assert.equal(await readFile(path.join(target.workspacePath, "notes/entry.txt"), "utf8"), "alpha\nbeta\nalpha\n");

    const read = await dispatchCleanroomTool(
      "Read",
      { file_path: "notes/entry.txt", offset: 2, limit: 1 },
      "tool-read",
      context,
    );
    assert.deepEqual(read, { content: "beta", isError: false });

    const ambiguous = await dispatchCleanroomTool(
      "Edit",
      {
        file_path: "notes/entry.txt",
        old_string: "alpha",
        new_string: "gamma",
      },
      "tool-edit-ambiguous",
      context,
    );
    assert.equal(ambiguous.isError, true);
    assert.match(ambiguous.content, /not unique/);

    const edited = await dispatchCleanroomTool(
      "Edit",
      {
        file_path: "notes/entry.txt",
        old_string: "alpha",
        new_string: "gamma",
        replace_all: true,
      },
      "tool-edit",
      context,
    );
    assert.equal(edited.isError, false, edited.content);

    const globbed = await dispatchCleanroomTool(
      "Glob",
      { pattern: "**/*.txt" },
      "tool-glob",
      context,
    );
    assert.deepEqual(globbed, { content: "notes/entry.txt", isError: false });

    const grepped = await dispatchCleanroomTool(
      "Grep",
      { pattern: "^gamma$", glob: "**/*.txt" },
      "tool-grep",
      context,
    );
    assert.equal(grepped.isError, false, grepped.content);
    assert.equal(grepped.content, "notes/entry.txt:1:gamma\nnotes/entry.txt:3:gamma");
  } finally {
    await target.cleanup();
  }
});

test("lexical traversal and symlink escape fail closed for reads and writes", async () => {
  const target = await fixture();
  try {
    await writeFile(path.join(target.outsidePath, "secret.txt"), "outside", "utf8");
    await symlink(target.outsidePath, path.join(target.workspacePath, "escape"));
    await symlink(
      path.join(target.outsidePath, "secret.txt"),
      path.join(target.workspacePath, "secret-link.txt"),
    );
    const context = { workspace: target.workspace, permissions: allowAll() };

    const traversal = await dispatchCleanroomTool(
      "Read",
      { file_path: "../outside/secret.txt" },
      "tool-traversal",
      context,
    );
    assert.equal(traversal.isError, true);
    assert.match(traversal.content, /escapes the canonical cwd/);

    const symlinkRead = await dispatchCleanroomTool(
      "Read",
      { file_path: "secret-link.txt" },
      "tool-symlink-read",
      context,
    );
    assert.equal(symlinkRead.isError, true);
    assert.match(symlinkRead.content, /symlink resolves outside/);

    const symlinkParentWrite = await dispatchCleanroomTool(
      "Write",
      { file_path: "escape/overwrite.txt", content: "must-not-write" },
      "tool-symlink-parent-write",
      context,
    );
    assert.equal(symlinkParentWrite.isError, true);
    assert.match(symlinkParentWrite.content, /parent symlink resolves outside/);

    const symlinkTargetWrite = await dispatchCleanroomTool(
      "Write",
      { file_path: "secret-link.txt", content: "must-not-write" },
      "tool-symlink-target-write",
      context,
    );
    assert.equal(symlinkTargetWrite.isError, true);
    assert.match(symlinkTargetWrite.content, /symbolic-link target/);
    assert.equal(await readFile(path.join(target.outsidePath, "secret.txt"), "utf8"), "outside");
  } finally {
    await target.cleanup();
  }
});

test("SDK can_use_tool control channel accepts updated input and propagates denial", async () => {
  const target = await fixture();
  try {
    const emitted = [];
    let channel;
    channel = new SdkPermissionChannel({
      timeoutMs: 1_000,
      emit(frame) {
        emitted.push(frame);
        queueMicrotask(() => {
          channel.handleControlResponse({
            type: "control_response",
            response: {
              subtype: "success",
              request_id: frame.request_id,
              response:
                frame.request.tool_name === "Write"
                  ? {
                      behavior: "allow",
                      updatedInput: {
                        file_path: "approved.txt",
                        content: "approved by SDK callback",
                      },
                    }
                  : { behavior: "deny", message: "denied by SDK callback" },
            },
          });
        });
      },
    });
    const policy = new ToolPermissionPolicy({ mode: "default", prompter: channel });
    const context = { workspace: target.workspace, permissions: policy };

    const allowed = await dispatchCleanroomTool(
      "Write",
      { file_path: "unapproved.txt", content: "original" },
      "tool-sdk-allow",
      context,
    );
    assert.equal(allowed.isError, false, allowed.content);
    assert.equal(await readFile(path.join(target.workspacePath, "approved.txt"), "utf8"), "approved by SDK callback");
    assert.equal(emitted[0].type, "control_request");
    assert.equal(emitted[0].request.subtype, "can_use_tool");
    assert.equal(emitted[0].request.tool_name, "Write");
    assert.equal(emitted[0].request.tool_use_id, "tool-sdk-allow");

    const denied = await dispatchCleanroomTool(
      "Read",
      { file_path: "approved.txt" },
      "tool-sdk-deny",
      context,
    );
    assert.deepEqual(denied, { content: "denied by SDK callback", isError: true });
  } finally {
    await target.cleanup();
  }
});

test("disallowedTools wins over allowedTools and permission modes remain fail closed", async () => {
  const target = await fixture();
  try {
    const policy = new ToolPermissionPolicy({
      mode: "bypassPermissions",
      allowedTools: ["Write"],
      disallowedTools: ["Write(*)"],
    });
    const denied = await dispatchCleanroomTool(
      "Write",
      { file_path: "denied.txt", content: "no" },
      "tool-rule-deny",
      { workspace: target.workspace, permissions: policy },
    );
    assert.equal(denied.isError, true);
    assert.match(denied.content, /explicitly disallowed/);

    const noCallback = await dispatchCleanroomTool(
      "Read",
      { file_path: "missing.txt" },
      "tool-no-callback",
      {
        workspace: target.workspace,
        permissions: new ToolPermissionPolicy({ mode: "default" }),
      },
    );
    assert.equal(noCallback.isError, true);
    assert.match(noCallback.content, /no SDK callback/);
  } finally {
    await target.cleanup();
  }
});

test("Bash defaults to fail closed and the provider-free fixture binds cwd", async () => {
  const target = await fixture();
  try {
    const context = { workspace: target.workspace, permissions: allowAll() };
    const failClosed = await dispatchCleanroomTool(
      "Bash",
      { command: "pwd" },
      "tool-bash-fail-closed",
      { ...context, sandbox: new FailClosedSandbox() },
    );
    assert.equal(failClosed.isError, true);
    assert.match(failClosed.content, /no production-qualified sandbox/);

    const sandbox = await BoundedProcessFixtureSandbox.create({
      allowUnisolatedProcessForTests: true,
      workspaceRoot: target.workspace.root,
    });
    const missingOptIn = await dispatchCleanroomTool(
      "Bash",
      { command: "pwd" },
      "tool-bash-untrusted",
      { ...context, sandbox },
    );
    assert.equal(missingOptIn.isError, true);
    assert.match(missingOptIn.content, /untrusted sandbox/);

    const executed = await dispatchCleanroomTool(
      "Bash",
      { command: "pwd; printf fixture-ok", timeout: 2_000 },
      "tool-bash-fixture",
      { ...context, sandbox, allowUntrustedSandboxForTests: true },
    );
    assert.equal(executed.isError, false, executed.content);
    assert.match(executed.content, new RegExp(target.workspace.root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(executed.content, /fixture-ok/);
    assert.equal(executed.terminalReason, "completed");
  } finally {
    await target.cleanup();
  }
});

test("bounded Bash process fixture terminates on timeout and cancel", async () => {
  const target = await fixture();
  try {
    const sandbox = await BoundedProcessFixtureSandbox.create({
      allowUnisolatedProcessForTests: true,
      workspaceRoot: target.workspace.root,
    });
    const started = Date.now();
    const timedOut = await sandbox.execute({
      command: "sleep 5",
      cwd: target.workspace.root,
      timeoutMs: 75,
    });
    assert.equal(timedOut.terminalReason, "timed_out");
    assert(Date.now() - started < 2_000, "timeout did not terminate the process promptly");

    const controller = new AbortController();
    const running = sandbox.execute({
      command: "sleep 5",
      cwd: target.workspace.root,
      timeoutMs: 5_000,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 50);
    const cancelled = await running;
    assert.equal(cancelled.terminalReason, "cancelled");
  } finally {
    await target.cleanup();
  }
});
