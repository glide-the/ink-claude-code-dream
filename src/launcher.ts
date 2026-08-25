// [Input] Consume opaque Claude CLI argv/stdio plus the server-owned runtime environment and release manifest.
// [Output] Validate the pinned core/TMPDIR boundary, then transparently supervise the official CLI process group.
// [Pos] Lazy-loaded execution boundary; no Claude protocol, MCP payload, transcript, setting, or secret is parsed here.
// [Sync] 2026-08-24: align the SDK probe comment with Dream's locked 0.2.144 distribution.
// [Sync] 2026-08-26: move the immutable release path to Runtime 0.1.1.

import { constants as fsConstants } from "node:fs";
import { access, lstat, realpath } from "node:fs/promises";
import { basename, delimiter, isAbsolute, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import type { LaunchResult, ReleaseManifest } from "./contracts.js";

const CONTROL_ENV_KEYS = [
  "INK_CLAUDE_CODE_EXECUTABLE",
  "INK_CLAUDE_RUNTIME_MANIFEST_PATH",
  "INK_CLAUDE_RUNTIME_WORKSPACE_ROOT",
  "INK_CLAUDE_RUNTIME_TIMEOUT_MS",
  "INK_CLAUDE_RUNTIME_KILL_GRACE_MS",
  "INK_CLAUDE_BARE_PROFILE",
  "CLAUDE_CODE_CLI_PATH",
] as const;
const BARE_PROFILE = "dream-explicit-v1";
const MAX_VERSION_OUTPUT_BYTES = 4096;
const SIGNAL_NUMBERS: Partial<Record<NodeJS.Signals, number>> = {
  SIGHUP: 1,
  SIGINT: 2,
  SIGQUIT: 3,
  SIGTERM: 15,
};

function parseMilliseconds(
  value: string | undefined,
  fallback: number,
  maximum: number,
): number {
  if (!value) return fallback;
  if (!/^\d+$/.test(value)) throw new Error("runtime timeout value is invalid");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > maximum) {
    throw new Error("runtime timeout value is out of range");
  }
  return parsed;
}

async function executableFromPath(command: string): Promise<string | null> {
  const candidates = command.includes("/")
    ? [resolve(command)]
    : (process.env.PATH ?? "")
        .split(delimiter)
        .filter(Boolean)
        .map((directory) => join(directory, command));
  const launcherPath = await realpath(process.argv[1]);
  for (const candidate of candidates) {
    try {
      await access(candidate, fsConstants.X_OK);
      const resolved = await realpath(candidate);
      if (resolved !== launcherPath) return resolved;
    } catch {
      // Continue searching PATH; missing and non-executable candidates are normal.
    }
  }
  return null;
}

export async function resolveCoreExecutable(): Promise<string> {
  const configured = process.env.INK_CLAUDE_CODE_EXECUTABLE?.trim();
  if (configured && !isAbsolute(configured)) {
    throw new Error("INK_CLAUDE_CODE_EXECUTABLE must be an absolute path");
  }
  const executable = await executableFromPath(configured || "claude");
  if (!executable) {
    throw new Error("official Claude Code executable was not found");
  }
  return executable;
}

function hasFlag(args: string[], names: string[]): boolean {
  return args.some((argument) =>
    names.some((name) => argument === name || argument.startsWith(`${name}=`)),
  );
}

function flagValues(args: string[], name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === name) {
      const value = args[index + 1];
      if (!value || value.startsWith("-")) {
        throw new Error(`explicit bare profile requires a value for ${name}`);
      }
      values.push(value);
      index += 1;
    } else if (argument.startsWith(`${name}=`)) {
      const value = argument.slice(name.length + 1);
      if (!value) throw new Error(`explicit bare profile requires a value for ${name}`);
      values.push(value);
    }
  }
  return values;
}

async function validateExplicitCarrier(
  raw: string,
  label: string,
  allowDirectory: boolean,
): Promise<void> {
  if (!isAbsolute(raw)) throw new Error(`${label} must use an absolute path`);
  const info = await lstat(raw);
  if (info.isSymbolicLink()) throw new Error(`${label} must not be a symlink`);
  if (!info.isFile() && !(allowDirectory && info.isDirectory())) {
    throw new Error(`${label} is not an allowed file or directory`);
  }
  await access(raw, fsConstants.R_OK);
}

async function validateBareProfile(args: string[]): Promise<void> {
  const requested = hasFlag(args, ["--bare"]);
  const profile = process.env.INK_CLAUDE_BARE_PROFILE?.trim();
  if (!requested && !profile) return;
  if (!requested || profile !== BARE_PROFILE) {
    throw new Error("--bare requires explicit INK_CLAUDE_BARE_PROFILE=dream-explicit-v1");
  }
  if (!hasFlag(args, ["-p", "--print"])) {
    throw new Error("explicit bare profile is limited to headless -p/--print launches");
  }
  if (!hasFlag(args, ["--strict-mcp-config"])) {
    throw new Error("explicit bare profile requires --strict-mcp-config");
  }
  if (hasFlag(args, ["--no-session-persistence"])) {
    throw new Error("explicit bare profile must preserve session persistence for resume");
  }
  const settings = flagValues(args, "--settings");
  const mcpConfigs = flagValues(args, "--mcp-config");
  const pluginDirectories = flagValues(args, "--plugin-dir");
  if (settings.length !== 1) {
    throw new Error("explicit bare profile requires exactly one --settings file");
  }
  if (mcpConfigs.length === 0) {
    throw new Error("explicit bare profile requires --mcp-config");
  }
  if (pluginDirectories.length === 0) {
    throw new Error("explicit bare profile requires --plugin-dir for plugins and skills");
  }
  await validateExplicitCarrier(settings[0], "--settings", false);
  for (const path of mcpConfigs) await validateExplicitCarrier(path, "--mcp-config", false);
  for (const path of pluginDirectories) {
    await validateExplicitCarrier(path, "--plugin-dir", true);
  }
  const workspace = process.env.INK_CLAUDE_RUNTIME_WORKSPACE_ROOT?.trim();
  if (!workspace || !isAbsolute(workspace)) {
    throw new Error("explicit bare profile requires an absolute workspace root");
  }
  if ((await realpath(workspace)) !== (await realpath(process.cwd()))) {
    throw new Error("explicit bare profile requires cwd to equal the declared workspace");
  }
  for (const resumeFlag of ["--resume", "--session-id"]) {
    if (hasFlag(args, [resumeFlag])) flagValues(args, resumeFlag);
  }
}

async function validateTmpdir(): Promise<string> {
  const raw = process.env.CLAUDE_CODE_TMPDIR?.trim();
  if (!raw || !isAbsolute(raw)) {
    throw new Error("CLAUDE_CODE_TMPDIR must be an absolute server-owned path");
  }
  if (basename(raw) !== ".claude-tmp") {
    throw new Error("CLAUDE_CODE_TMPDIR must end in .claude-tmp");
  }
  const info = await lstat(raw);
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new Error("CLAUDE_CODE_TMPDIR must be a real directory, not a symlink");
  }
  if ((info.mode & 0o077) !== 0) {
    throw new Error("CLAUDE_CODE_TMPDIR permissions must be 0700 or stricter");
  }
  const resolvedTmpdir = await realpath(raw);
  const workspace = process.env.INK_CLAUDE_RUNTIME_WORKSPACE_ROOT?.trim();
  if (workspace) {
    if (!isAbsolute(workspace)) {
      throw new Error("INK_CLAUDE_RUNTIME_WORKSPACE_ROOT must be absolute");
    }
    const resolvedWorkspace = await realpath(workspace);
    if (resolvedTmpdir !== join(resolvedWorkspace, ".claude-tmp")) {
      throw new Error("CLAUDE_CODE_TMPDIR escaped the declared thread workspace");
    }
  }
  return resolvedTmpdir;
}

function childEnvironment(): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  for (const key of CONTROL_ENV_KEYS) delete environment[key];
  return environment;
}

async function inspectCoreVersion(executable: string): Promise<string> {
  return await new Promise<string>((resolveVersion, reject) => {
    const child = spawn(executable, ["--version"], {
      env: childEnvironment(),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const chunks: Buffer[] = [];
    let total = 0;
    const collect = (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buffer.length;
      if (total <= MAX_VERSION_OUTPUT_BYTES) chunks.push(buffer);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.once("error", reject);
    child.once("close", (code) => {
      if (code !== 0 || total > MAX_VERSION_OUTPUT_BYTES) {
        reject(new Error("Claude Code version probe failed"));
        return;
      }
      const match = Buffer.concat(chunks)
        .toString("utf8")
        .match(/\b(\d+\.\d+\.\d+)\b/);
      if (!match) {
        reject(new Error("Claude Code version probe returned no semantic version"));
        return;
      }
      resolveVersion(match[1]);
    });
  });
}

async function probeAndVerifyCoreVersion(
  executable: string,
  manifest: ReleaseManifest,
): Promise<string> {
  const version = await inspectCoreVersion(executable);
  if (version !== manifest.core.version) {
    throw new Error(
      `Claude Code ${version} is incompatible; expected ${manifest.core.version}`,
    );
  }
  return version;
}

function signalProcessGroup(pid: number | undefined, signal: NodeJS.Signals): void {
  if (!pid) return;
  try {
    if (process.platform === "win32") process.kill(pid, signal);
    else process.kill(-pid, signal);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ESRCH") throw error;
  }
}

export async function launchOfficialCli(args: string[]): Promise<LaunchResult> {
  const executable = await resolveCoreExecutable();
  // Dream's locked ink-claude-dream-agent-sdk 0.2.144 probes cli_path with
  // `-v` before its stream-json launch. Do not add another large-core probe here. Deployment must run
  // --runtime-doctor. Dream's `mcp ...` management calls and help are not
  // thread launches and therefore do not require a thread-local TMPDIR.
  const managementOrHelp =
    args[0] === "mcp" ||
    args[0] === "auth" ||
    args[0] === "setup-token" ||
    (args.length === 1 &&
      (args[0] === "--help" ||
        args[0] === "-h" ||
        args[0] === "--version" ||
        args[0] === "-v"));
  if (!managementOrHelp) {
    if (process.env.CLAUDE_AGENT_SDK_SKIP_VERSION_CHECK) {
      throw new Error(
        "CLAUDE_AGENT_SDK_SKIP_VERSION_CHECK is forbidden for supervised launches",
      );
    }
    await validateBareProfile(args);
    await validateTmpdir();
  }

  const timeoutMs = parseMilliseconds(
    process.env.INK_CLAUDE_RUNTIME_TIMEOUT_MS,
    0,
    24 * 60 * 60 * 1000,
  );
  const killGraceMs = parseMilliseconds(
    process.env.INK_CLAUDE_RUNTIME_KILL_GRACE_MS,
    1000,
    30_000,
  );
  const child = spawn(executable, args, {
    cwd: process.cwd(),
    env: childEnvironment(),
    stdio: "inherit",
    detached: process.platform !== "win32",
    windowsHide: true,
  });

  return await new Promise<LaunchResult>((resolveLaunch, reject) => {
    let timedOut = false;
    let terminationSignal: NodeJS.Signals | null = null;
    let forceTimer: NodeJS.Timeout | undefined;
    let timeoutTimer: NodeJS.Timeout | undefined;
    let closed: { code: number | null; signal: NodeJS.Signals | null } | null = null;

    const cleanupHandlers = () => {
      for (const signal of Object.keys(SIGNAL_NUMBERS) as NodeJS.Signals[]) {
        process.removeListener(signal, signalHandlers[signal]);
      }
      if (timeoutTimer) clearTimeout(timeoutTimer);
    };
    const finish = () => {
      if (!closed) return;
      cleanupHandlers();
      if (forceTimer) clearTimeout(forceTimer);
      resolveLaunch({
        exitCode: timedOut ? 124 : closed.code,
        signal: timedOut ? null : terminationSignal ?? closed.signal,
        timedOut,
      });
    };
    const beginTermination = (signal: NodeJS.Signals, timeout: boolean) => {
      if (terminationSignal) return;
      terminationSignal = signal;
      timedOut = timeout;
      signalProcessGroup(child.pid, signal);
      forceTimer = setTimeout(() => {
        signalProcessGroup(child.pid, "SIGKILL");
        finish();
      }, killGraceMs);
      forceTimer.unref();
    };
    const signalHandlers = Object.fromEntries(
      (Object.keys(SIGNAL_NUMBERS) as NodeJS.Signals[]).map((signal) => [
        signal,
        () => beginTermination(signal, false),
      ]),
    ) as Record<NodeJS.Signals, () => void>;

    for (const signal of Object.keys(SIGNAL_NUMBERS) as NodeJS.Signals[]) {
      process.once(signal, signalHandlers[signal]);
    }
    if (timeoutMs > 0) {
      timeoutTimer = setTimeout(() => beginTermination("SIGTERM", true), timeoutMs);
      timeoutTimer.unref();
    }
    child.once("error", (error) => {
      cleanupHandlers();
      reject(error);
    });
    child.once("close", (code, signal) => {
      closed = { code, signal };
      if (!terminationSignal) finish();
      else {
        // The leader exited before grace elapsed. Kill any remaining process-
        // group descendants immediately, clear the grace timer, and finish.
        signalProcessGroup(child.pid, "SIGKILL");
        finish();
      }
    });
  });
}

export async function doctor(): Promise<Record<string, unknown>> {
  const { readManifestEnvelope } = await import("./manifest.js");
  const [{ manifest, sha256 }, executable] = await Promise.all([
    readManifestEnvelope(),
    resolveCoreExecutable(),
  ]);
  const version = await probeAndVerifyCoreVersion(executable, manifest);
  const tmpdir = process.env.CLAUDE_CODE_TMPDIR ? await validateTmpdir() : null;
  return {
    ok: true,
    runtime: {
      name: manifest.runtime.name,
      version: manifest.runtime.version,
      cliVersion: manifest.core.version,
      integration: manifest.runtime.integration,
    },
    manifestSha256: sha256,
    node: process.versions.node,
    platform: `${process.platform}-${process.arch}`,
    claudeCode: {
      executable,
      version,
    },
    tmpdir: tmpdir ? { configured: true, valid: true } : { configured: false },
  };
}

export function conventionalSignalExitCode(signal: NodeJS.Signals): number {
  return 128 + (SIGNAL_NUMBERS[signal] ?? 0);
}
