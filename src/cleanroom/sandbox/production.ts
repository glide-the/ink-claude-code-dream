// [Input] Canonical Dream Workspace/tmpdir, bounded Bash request, and official SandboxManager 0.0.73.
// [Output] OS-sandboxed process-tree completion with network deny, environment allowlist, and bounded output.
// [Pos] Production SandboxAdapter; unsupported or missing platform isolation always fails closed.
// [Sync] 2026-08-24: integrate Apache-2.0 Anthropic Sandbox Runtime without a raw-process fallback.

import { SandboxManager, type SandboxRuntimeConfig } from "@anthropic-ai/sandbox-runtime";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  SandboxAdapter,
  SandboxCommandRequest,
  SandboxCommandResult,
} from "./sandbox.ts";

const OUTPUT_LIMIT_BYTES = 1_048_576;
const MAX_TIMEOUT_MS = 120_000;
const ENV_ALLOWLIST = ["LANG", "LC_ALL", "LC_CTYPE", "PATH", "TERM"] as const;

export interface AnthropicSandboxOptions {
  tmpdir: string;
  workspaceRoot: string;
}

function cleanEnvironment(tmpdir: string, wrapped: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { TMPDIR: tmpdir };
  for (const name of ENV_ALLOWLIST) {
    const value = wrapped[name] ?? process.env[name];
    if (value) environment[name] = value;
  }
  return environment;
}

function terminateProcessGroup(child: ReturnType<typeof spawn>, signal: NodeJS.Signals): void {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform !== "win32") process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch {
    // The sandbox leader may have exited between the status check and signal.
  }
}

function baseConfig(workspaceRoot: string, tmpdir: string): SandboxRuntimeConfig {
  const home = os.homedir();
  const denyRead = [os.homedir()];
  const canonicalSystemTmp = path.resolve(os.tmpdir());
  if (!workspaceRoot.startsWith(`${canonicalSystemTmp}${path.sep}`)) {
    denyRead.push(canonicalSystemTmp);
  }
  return {
    network: {
      allowedDomains: [],
      deniedDomains: ["*"],
      allowLocalBinding: false,
      allowUnixSockets: [],
      allowAllUnixSockets: false,
    },
    filesystem: {
      denyRead,
      allowRead: [workspaceRoot, tmpdir],
      allowWrite: [workspaceRoot, tmpdir],
      denyWrite: [
        "/tmp/claude",
        "/private/tmp/claude",
        path.join(home, ".npm", "_logs"),
        path.join(home, ".claude", "debug"),
      ],
      allowGitConfig: false,
    },
    enableWeakerNestedSandbox: false,
    enableWeakerNetworkIsolation: false,
    allowAppleEvents: false,
  };
}

export class AnthropicSandboxAdapter implements SandboxAdapter {
  readonly trust = "trusted" as const;
  private closed = false;
  private readonly tmpdir: string;
  private readonly workspaceRoot: string;

  private constructor(workspaceRoot: string, tmpdir: string) {
    this.workspaceRoot = workspaceRoot;
    this.tmpdir = tmpdir;
  }

  static async create(options: AnthropicSandboxOptions): Promise<AnthropicSandboxAdapter> {
    if (process.platform !== "darwin" && process.platform !== "linux") {
      throw new Error("production sandbox is unavailable on this platform");
    }
    const workspaceRoot = await realpath(options.workspaceRoot);
    const tmpdir = await realpath(options.tmpdir);
    if (tmpdir !== path.join(workspaceRoot, ".claude-tmp")) {
      throw new Error("production sandbox requires exact Workspace/.claude-tmp");
    }
    if (process.env.CLAUDE_CODE_TMPDIR !== tmpdir) {
      throw new Error("production sandbox requires CLAUDE_CODE_TMPDIR to match the exact Workspace tmpdir");
    }
    const tmpStatus = await lstat(tmpdir);
    if (!tmpStatus.isDirectory() || tmpStatus.isSymbolicLink() || (tmpStatus.mode & 0o777) !== 0o700) {
      throw new Error("production sandbox tmpdir must be a real 0700 directory");
    }
    if (!SandboxManager.isSupportedPlatform()) {
      throw new Error("production sandbox platform is unsupported");
    }
    const dependencies = await SandboxManager.checkDependenciesAsync();
    if (dependencies.errors.length > 0) {
      throw new Error("production sandbox dependencies are unavailable");
    }
    await SandboxManager.initialize(baseConfig(workspaceRoot, tmpdir));
    if (!SandboxManager.isSandboxingEnabled()) {
      await SandboxManager.reset().catch(() => undefined);
      throw new Error("production sandbox did not enable OS isolation");
    }
    return new AnthropicSandboxAdapter(workspaceRoot, tmpdir);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await SandboxManager.reset();
  }

  async execute(request: SandboxCommandRequest): Promise<SandboxCommandResult> {
    if (this.closed) throw new Error("production sandbox is closed");
    if (await realpath(request.cwd) !== this.workspaceRoot) {
      throw new Error("production sandbox cwd must equal the canonical Workspace");
    }
    if (!request.command.trim() || request.command.includes("\0")) {
      throw new Error("Bash command must be non-empty and contain no NUL bytes");
    }
    if (!Number.isSafeInteger(request.timeoutMs) || request.timeoutMs <= 0 || request.timeoutMs > MAX_TIMEOUT_MS) {
      throw new Error("Bash timeout must be between 1 and 120000 milliseconds");
    }
    if (request.signal?.aborted) {
      return { stdout: "", stderr: "", exitCode: null, signal: null, terminalReason: "cancelled" };
    }

    const invocationId = `bash_${randomUUID()}`;
    const wrapped = await SandboxManager.wrapWithSandboxArgv(
      request.command,
      "/bin/sh",
      undefined,
      request.signal,
      this.workspaceRoot,
      { commandId: invocationId, commandText: request.command },
    );

    return await new Promise<SandboxCommandResult>((resolve, reject) => {
      const child = spawn(wrapped.argv[0], wrapped.argv.slice(1), {
        cwd: this.workspaceRoot,
        detached: process.platform !== "win32",
        env: cleanEnvironment(this.tmpdir, wrapped.env),
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = Buffer.alloc(0);
      let stderr = Buffer.alloc(0);
      let terminalReason: SandboxCommandResult["terminalReason"] = "completed";
      let settled = false;
      let forceTimer: ReturnType<typeof setTimeout> | undefined;

      const terminate = (reason: SandboxCommandResult["terminalReason"]): void => {
        if (terminalReason === "completed") terminalReason = reason;
        terminateProcessGroup(child, "SIGTERM");
        forceTimer ??= setTimeout(() => terminateProcessGroup(child, "SIGKILL"), 500);
      };
      const append = (current: Buffer, chunk: Buffer): Buffer => {
        const remaining = OUTPUT_LIMIT_BYTES - stdout.byteLength - stderr.byteLength;
        if (remaining <= 0) {
          terminate("output_limit");
          return current;
        }
        const accepted = chunk.subarray(0, remaining);
        if (accepted.byteLength < chunk.byteLength) terminate("output_limit");
        return Buffer.concat([current, accepted]);
      };
      child.stdout.on("data", (chunk: Buffer) => { stdout = append(stdout, chunk); });
      child.stderr.on("data", (chunk: Buffer) => { stderr = append(stderr, chunk); });

      const timeout = setTimeout(() => terminate("timed_out"), request.timeoutMs);
      const onAbort = (): void => terminate("cancelled");
      request.signal?.addEventListener("abort", onAbort, { once: true });

      const cleanup = (): void => {
        clearTimeout(timeout);
        if (forceTimer) clearTimeout(forceTimer);
        request.signal?.removeEventListener("abort", onAbort);
        SandboxManager.cleanupAfterCommand();
      };
      child.once("error", (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      });
      child.once("close", (exitCode, signal) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve({
          stdout: stdout.toString("utf8"),
          stderr: SandboxManager.annotateStderrWithSandboxFailures(invocationId, stderr.toString("utf8")),
          exitCode,
          signal,
          terminalReason,
        });
      });
    });
  }
}
