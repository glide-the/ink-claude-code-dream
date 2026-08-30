// [Input] Canonical Dream Workspace/tmpdir, server-bound Notion CLI environment, bounded Bash request, and official SandboxManager 0.0.73.
// [Output] OS-sandboxed process-tree completion with default-deny network, actor/thread-bound Notion access, a narrow environment allowlist, and bounded output.
// [Pos] Production SandboxAdapter; unsupported or missing platform isolation always fails closed.
// [Sync] 2026-08-24: integrate Apache-2.0 Anthropic Sandbox Runtime without a raw-process fallback.
// [Sync] 2026-08-30: pass Dream-bound NOTION_* values into Bash and allow only the production Notion hosts needed by ntn.

import { SandboxManager, type SandboxRuntimeConfig } from "@anthropic-ai/sandbox-runtime";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstat, open, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NOTION_BASH_ENV_NAMES } from "../environment.ts";
import type {
  SandboxAdapter,
  SandboxCommandRequest,
  SandboxCommandResult,
} from "./sandbox.ts";

const OUTPUT_LIMIT_BYTES = 1_048_576;
const MAX_TIMEOUT_MS = 120_000;
const ENV_ALLOWLIST = ["LANG", "LC_ALL", "LC_CTYPE", "PATH", "TERM"] as const;
const NOTION_HOME_DIRECTORY = ".notion-home";
const NOTION_CLI_EXECUTABLE = "ntn";
const NOTION_WORKERS_CONFIG_FILENAME = "workers.json";
export const NOTION_SANDBOX_ALLOWED_DOMAINS = [
  "api.notion.com:443",
  "developers.notion.com:443",
  "ntn.dev:443",
] as const;

export interface NtnExecutableContract {
  format: "elf" | "mach-o";
  path: string;
}

export interface AnthropicSandboxOptions {
  tmpdir: string;
  workspaceRoot: string;
}

export async function resolveNtnExecutable(
  source: NodeJS.ProcessEnv = process.env,
): Promise<NtnExecutableContract | undefined> {
  for (const directory of String(source.PATH ?? "").split(path.delimiter)) {
    if (!directory) continue;
    const candidate = path.join(directory, NOTION_CLI_EXECUTABLE);
    try {
      const resolved = await realpath(candidate);
      const info = await lstat(resolved);
      if (
        path.basename(resolved) !== NOTION_CLI_EXECUTABLE ||
        !info.isFile() ||
        info.isSymbolicLink() ||
        (info.mode & 0o111) === 0 ||
        (info.mode & 0o022) !== 0 ||
        (typeof process.getuid === "function" && info.uid !== process.getuid() && info.uid !== 0)
      ) continue;
      const header = Buffer.alloc(4);
      const handle = await open(resolved, "r");
      try {
        const { bytesRead } = await handle.read(header, 0, header.byteLength, 0);
        if (bytesRead !== header.byteLength) continue;
      } finally {
        await handle.close();
      }
      if (header.equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) {
        return { format: "elf", path: resolved };
      }
      const magic = header.readUInt32BE(0);
      if (
        magic === 0xfeedface || magic === 0xcefaedfe ||
        magic === 0xfeedfacf || magic === 0xcffaedfe ||
        magic === 0xcafebabe || magic === 0xbebafeca ||
        magic === 0xcafebabf || magic === 0xbfbafeca
      ) {
        return { format: "mach-o", path: resolved };
      }
    } catch {
      // Continue through the server-owned PATH without surfacing local paths.
    }
  }
  return undefined;
}

export async function resolveNotionBashEnvironment(
  workspaceRoot: string,
  source: NodeJS.ProcessEnv = process.env,
): Promise<NodeJS.ProcessEnv> {
  const expectedHome = path.join(path.resolve(workspaceRoot), NOTION_HOME_DIRECTORY);
  if (source.NOTION_HOME !== expectedHome) return {};
  try {
    const homeStatus = await lstat(expectedHome);
    if (
      !homeStatus.isDirectory() ||
      homeStatus.isSymbolicLink() ||
      (homeStatus.mode & 0o077) !== 0 ||
      await realpath(expectedHome) !== expectedHome
    ) return {};
  } catch {
    return {};
  }

  const environment: NodeJS.ProcessEnv = {
    NOTION_HOME: expectedHome,
    NOTION_KEYRING: "0",
  };
  const token = source.NOTION_API_TOKEN;
  if (token && token === token.trim() && !/[\0\r\n]/.test(token)) {
    environment.NOTION_API_TOKEN = token;
  }

  const expectedWorkersFile = path.join(expectedHome, NOTION_WORKERS_CONFIG_FILENAME);
  if (source.NOTION_WORKERS_CONFIG_FILE === expectedWorkersFile) {
    try {
      const workersStatus = await lstat(expectedWorkersFile);
      if (
        workersStatus.isFile() &&
        !workersStatus.isSymbolicLink() &&
        (workersStatus.mode & 0o022) === 0 &&
        await realpath(expectedWorkersFile) === expectedWorkersFile
      ) {
        environment.NOTION_WORKERS_CONFIG_FILE = expectedWorkersFile;
      }
    } catch {
      // A missing or non-canonical workers projection is omitted fail-closed.
    }
  }
  return environment;
}

export function cleanEnvironment(
  tmpdir: string,
  wrapped: NodeJS.ProcessEnv,
  notionEnvironment: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { TMPDIR: tmpdir };
  for (const name of ENV_ALLOWLIST) {
    const value = wrapped[name] ?? process.env[name];
    if (value) environment[name] = value;
  }
  for (const name of NOTION_BASH_ENV_NAMES) {
    const value = notionEnvironment[name];
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

function baseConfig(
  workspaceRoot: string,
  tmpdir: string,
  notionEnvironment: NodeJS.ProcessEnv,
  notionExecutable: NtnExecutableContract | undefined,
): SandboxRuntimeConfig {
  const home = os.homedir();
  const denyRead = [os.homedir()];
  const canonicalSystemTmp = path.resolve(os.tmpdir());
  if (!workspaceRoot.startsWith(`${canonicalSystemTmp}${path.sep}`)) {
    denyRead.push(canonicalSystemTmp);
  }
  return {
    network: {
      allowedDomains: notionEnvironment.NOTION_HOME
        ? [...NOTION_SANDBOX_ALLOWED_DOMAINS]
        : [],
      deniedDomains: notionEnvironment.NOTION_HOME ? [] : ["*"],
      strictAllowlist: true,
      allowLocalBinding: false,
      allowUnixSockets: [],
      allowAllUnixSockets: false,
    },
    filesystem: {
      denyRead,
      allowRead: [
        workspaceRoot,
        tmpdir,
        ...(notionExecutable ? [notionExecutable.path] : []),
      ],
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
  private readonly notionEnvironment: NodeJS.ProcessEnv;

  private constructor(
    workspaceRoot: string,
    tmpdir: string,
    notionEnvironment: NodeJS.ProcessEnv,
  ) {
    this.workspaceRoot = workspaceRoot;
    this.tmpdir = tmpdir;
    this.notionEnvironment = notionEnvironment;
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
    const candidateNotionEnvironment = await resolveNotionBashEnvironment(workspaceRoot);
    const notionExecutable = candidateNotionEnvironment.NOTION_HOME
      ? await resolveNtnExecutable()
      : undefined;
    const notionEnvironment = notionExecutable ? candidateNotionEnvironment : {};
    await SandboxManager.initialize(
      baseConfig(workspaceRoot, tmpdir, notionEnvironment, notionExecutable),
    );
    if (!SandboxManager.isSandboxingEnabled()) {
      await SandboxManager.reset().catch(() => undefined);
      throw new Error("production sandbox did not enable OS isolation");
    }
    return new AnthropicSandboxAdapter(workspaceRoot, tmpdir, notionEnvironment);
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
        env: cleanEnvironment(
          this.tmpdir,
          wrapped.env,
          this.notionEnvironment,
        ),
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
