// [Input] Canonical Workspace command request and an optional AbortSignal.
// [Output] Structured command completion from an injected isolation backend.
// [Pos] Trust boundary for the clean-room Bash tool; default behavior never spawns.
// [Sync] 2026-08-24: define trusted adapter contract and fail-closed default.

export interface SandboxCommandRequest {
  command: string;
  cwd: string;
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface SandboxCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  terminalReason: "completed" | "timed_out" | "cancelled" | "output_limit";
}

export interface SandboxAdapter {
  readonly trust: "trusted" | "untrusted-test-fixture" | "fail-closed";
  close?(): Promise<void>;
  execute(request: SandboxCommandRequest): Promise<SandboxCommandResult>;
}

export class FailClosedSandbox implements SandboxAdapter {
  readonly trust = "fail-closed" as const;

  async execute(_request: SandboxCommandRequest): Promise<SandboxCommandResult> {
    throw new Error(
      "Bash is unavailable: no production-qualified sandbox adapter is configured",
    );
  }
}
