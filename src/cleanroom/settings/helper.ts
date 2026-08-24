// [Input] A validated apiKeyHelper command plus the Runtime provider environment.
// [Output] Exactly one bounded ephemeral provider token, or a redacted fail-closed error.
// [Pos] Shell-free helper execution boundary for Dream's short-lived subject-token helper.
// [Sync] 2026-08-24: expose bounded helper failure categories without returning commands, paths, tokens, or stderr.

import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, lstat, realpath } from "node:fs/promises";

const MAX_TOKEN_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 30_000;

export type ProviderCredentialHelperFailure =
  | "command"
  | "executable"
  | "exit"
  | "output"
  | "spawn"
  | "timeout";

export class ProviderCredentialHelperError extends Error {
  readonly reason: ProviderCredentialHelperFailure;

  constructor(reason: ProviderCredentialHelperFailure) {
    super("Provider credential helper failed safely");
    this.name = "ProviderCredentialHelperError";
    this.reason = reason;
  }
}

function fail(reason: ProviderCredentialHelperFailure): never {
  throw new ProviderCredentialHelperError(reason);
}

function splitCommand(command: string): string[] {
  const tokens: string[] = [];
  let token = "";
  let state: "plain" | "single" | "double" = "plain";
  let escaped = false;
  let started = false;
  const push = (): void => {
    if (!started) return;
    tokens.push(token);
    token = "";
    started = false;
  };
  for (const character of command) {
    if (escaped) {
      token += character;
      started = true;
      escaped = false;
      continue;
    }
    if (state === "single") {
      if (character === "'") state = "plain";
      else token += character;
      started = true;
      continue;
    }
    if (state === "double") {
      if (character === '"') state = "plain";
      else if (character === "\\") escaped = true;
      else token += character;
      started = true;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      started = true;
    } else if (character === "'") {
      state = "single";
      started = true;
    } else if (character === '"') {
      state = "double";
      started = true;
    } else if (/\s/.test(character)) {
      push();
    } else if (";&|<>`$(){}".includes(character)) {
      fail("command");
    } else {
      token += character;
      started = true;
    }
  }
  if (escaped || state !== "plain") fail("command");
  push();
  if (tokens.length === 0 || tokens.length > 128) fail("command");
  return tokens;
}

function helperTimeoutMs(environment: NodeJS.ProcessEnv): number {
  const raw = environment.CLAUDE_CODE_API_KEY_HELPER_TIMEOUT_MS;
  if (raw === undefined || raw === "") return DEFAULT_TIMEOUT_MS;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 100 || parsed > MAX_TIMEOUT_MS) fail("timeout");
  return parsed;
}

async function resolveExecutable(value: string): Promise<string> {
  if (!value.startsWith("/") || value.includes("\0")) fail("executable");
  let canonical: string;
  let requested;
  let info;
  try {
    requested = await lstat(value);
    canonical = await realpath(value);
    info = await lstat(canonical);
    await access(value, constants.X_OK);
  } catch {
    fail("executable");
  }
  if (
    (!requested.isFile() && !requested.isSymbolicLink()) ||
    (typeof process.getuid === "function" && requested.uid !== process.getuid() && requested.uid !== 0) ||
    !info.isFile() ||
    (info.mode & 0o022) !== 0 ||
    (typeof process.getuid === "function" && info.uid !== process.getuid() && info.uid !== 0)
  ) {
    fail("executable");
  }
  // Execute the caller's validated absolute entry rather than `canonical`.
  // Python virtual environments rely on the `.venv/bin/python` argv path to
  // select their pyvenv.cfg and site-packages even though it is a symlink.
  return value;
}

export async function runApiKeyHelper(
  command: string,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const [rawExecutable, ...args] = splitCommand(command);
  const executable = await resolveExecutable(rawExecutable);
  const timeoutMs = helperTimeoutMs(environment);
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: process.cwd(),
      env: environment,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdout: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    const finish = (error?: Error, token?: string): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(token as string);
    };
    const terminate = (reason: ProviderCredentialHelperFailure): void => {
      child.kill("SIGKILL");
      finish(new ProviderCredentialHelperError(reason));
    };
    const timer = setTimeout(() => terminate("timeout"), timeoutMs);
    child.once("error", () => terminate("spawn"));
    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.byteLength;
      if (stdoutBytes > MAX_TOKEN_BYTES) return terminate("output");
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.byteLength;
      if (stderrBytes > MAX_TOKEN_BYTES) terminate("output");
    });
    child.once("close", (code, signal) => {
      if (settled) return;
      if (code !== 0 || signal !== null) return finish(new ProviderCredentialHelperError("exit"));
      const output = Buffer.concat(stdout).toString("utf8");
      const token = output.endsWith("\n") ? output.slice(0, -1) : output;
      if (
        !token ||
        token !== token.trim() ||
        /[\0\r\n]/.test(token) ||
        Buffer.byteLength(token, "utf8") > MAX_TOKEN_BYTES
      ) {
        return finish(new ProviderCredentialHelperError("output"));
      }
      finish(undefined, token);
    });
  });
}
