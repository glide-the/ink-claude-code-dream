// [Input] Explicit test opt-in plus a canonical cwd, bounded shell command, timeout, and AbortSignal.
// [Output] Provider-free process lifecycle evidence with process-group termination.
// [Pos] Untrusted test fixture only; it is not a filesystem or network sandbox.
// [Sync] 2026-08-24: add cwd binding, output cap, timeout, cancel, and child cleanup.

import { spawn } from "node:child_process";
import { realpath } from "node:fs/promises";
import type {
  SandboxAdapter,
  SandboxCommandRequest,
  SandboxCommandResult,
} from "./sandbox.ts";

const DEFAULT_OUTPUT_LIMIT = 1_048_576;

export interface BoundedProcessFixtureOptions {
  allowUnisolatedProcessForTests: true;
  workspaceRoot: string;
  outputLimitBytes?: number;
  shell?: string;
}

export class BoundedProcessFixtureSandbox implements SandboxAdapter {
  readonly trust = "untrusted-test-fixture" as const;
  private readonly outputLimitBytes: number;
  private readonly shell: string;
  private readonly workspaceRoot: string;

  private constructor(options: BoundedProcessFixtureOptions, canonicalRoot: string) {
    if (options.allowUnisolatedProcessForTests !== true) {
      throw new Error("bounded process fixture requires explicit test opt-in");
    }
    this.workspaceRoot = canonicalRoot;
    this.outputLimitBytes = options.outputLimitBytes ?? DEFAULT_OUTPUT_LIMIT;
    this.shell = options.shell ?? "/bin/sh";
    if (!Number.isSafeInteger(this.outputLimitBytes) || this.outputLimitBytes <= 0) {
      throw new Error("sandbox output limit must be a positive integer");
    }
  }

  static async create(options: BoundedProcessFixtureOptions): Promise<BoundedProcessFixtureSandbox> {
    return new BoundedProcessFixtureSandbox(options, await realpath(options.workspaceRoot));
  }

  async execute(request: SandboxCommandRequest): Promise<SandboxCommandResult> {
    if (!request.command.trim() || request.command.includes("\0")) {
      throw new Error("Bash command must be non-empty and contain no NUL bytes");
    }
    if (!Number.isSafeInteger(request.timeoutMs) || request.timeoutMs <= 0 || request.timeoutMs > 120_000) {
      throw new Error("Bash timeout must be between 1 and 120000 milliseconds");
    }
    const canonicalCwd = await realpath(request.cwd);
    if (canonicalCwd !== this.workspaceRoot) {
      throw new Error("Bash cwd must equal the canonical Workspace root");
    }
    if (request.signal?.aborted) {
      return {
        stdout: "",
        stderr: "",
        exitCode: null,
        signal: null,
        terminalReason: "cancelled",
      };
    }

    return await new Promise<SandboxCommandResult>((resolve, reject) => {
      const child = spawn(this.shell, ["-lc", request.command], {
        cwd: canonicalCwd,
        detached: process.platform !== "win32",
        env: {
          PATH: process.env.PATH ?? "/usr/bin:/bin",
          LANG: process.env.LANG ?? "C.UTF-8",
          LC_ALL: process.env.LC_ALL ?? "C.UTF-8",
          TMPDIR: process.env.CLAUDE_CODE_TMPDIR ?? process.env.TMPDIR ?? "/tmp",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = Buffer.alloc(0);
      let stderr = Buffer.alloc(0);
      let terminalReason: SandboxCommandResult["terminalReason"] = "completed";
      let settled = false;

      const terminate = (reason: SandboxCommandResult["terminalReason"]): void => {
        if (terminalReason === "completed") terminalReason = reason;
        if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
        try {
          if (process.platform !== "win32") process.kill(-child.pid, "SIGTERM");
          else child.kill("SIGTERM");
        } catch {
          // The process may have exited between the status check and kill.
        }
        const forceTimer = setTimeout(() => {
          if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
          try {
            if (process.platform !== "win32") process.kill(-child.pid, "SIGKILL");
            else child.kill("SIGKILL");
          } catch {
            // Best-effort cleanup after an already completed process.
          }
        }, 250);
        forceTimer.unref();
      };

      const append = (current: Buffer, chunk: Buffer): Buffer => {
        const remaining = this.outputLimitBytes - stdout.byteLength - stderr.byteLength;
        if (remaining <= 0) {
          terminate("output_limit");
          return current;
        }
        const accepted = chunk.subarray(0, remaining);
        const next = Buffer.concat([current, accepted]);
        if (accepted.byteLength < chunk.byteLength) terminate("output_limit");
        return next;
      };

      child.stdout.on("data", (chunk: Buffer) => {
        stdout = append(stdout, chunk);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr = append(stderr, chunk);
      });

      const timeout = setTimeout(() => terminate("timed_out"), request.timeoutMs);
      const onAbort = (): void => terminate("cancelled");
      request.signal?.addEventListener("abort", onAbort, { once: true });

      const cleanup = (): void => {
        clearTimeout(timeout);
        request.signal?.removeEventListener("abort", onAbort);
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
          stderr: stderr.toString("utf8"),
          exitCode,
          signal,
          terminalReason,
        });
      });
    });
  }
}
