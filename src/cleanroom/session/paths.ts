// [Input] CLAUDE_CONFIG_DIR, process cwd, and Dream's CLAUDE_CODE_TMPDIR binding.
// [Output] Canonical real paths confined to actor config or the exact workspace temp directory.
// [Pos] Filesystem trust boundary for clean-room session state.
// [Sync] 2026-08-24: enforce absolute normalized non-symlink paths and private directories.

import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, realpath } from "node:fs/promises";
import path from "node:path";

const PRIVATE_DIRECTORY_MODE = 0o700;

function displayMode(mode: number): string {
  return (mode & 0o777).toString(8).padStart(4, "0");
}

export function requireCanonicalAbsolutePath(label: string, value: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.trim() !== value ||
    value.includes("\0") ||
    !path.isAbsolute(value) ||
    path.normalize(value) !== value ||
    path.resolve(value) !== value ||
    value.normalize("NFC") !== value
  ) {
    throw new Error(`${label} must be an absolute normalized path`);
  }
  return value;
}

export async function requireRealDirectory(
  label: string,
  value: string,
): Promise<string> {
  const canonical = requireCanonicalAbsolutePath(label, value);
  const status = await lstat(canonical).catch(() => undefined);
  if (!status?.isDirectory() || status.isSymbolicLink()) {
    throw new Error(`${label} must be a real directory, not a symlink`);
  }
  const resolved = await realpath(canonical);
  if (resolved !== canonical) {
    throw new Error(`${label} must not contain symlink path components`);
  }
  return canonical;
}

async function ensurePrivateDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  const status = await lstat(directory);
  if (!status.isDirectory() || status.isSymbolicLink()) {
    throw new Error("transcript path must contain only real directories");
  }
  await chmod(directory, PRIVATE_DIRECTORY_MODE);
  const resolved = await realpath(directory);
  if (resolved !== directory) {
    throw new Error("transcript path escaped CLAUDE_CONFIG_DIR through a symlink");
  }
  const secured = await lstat(directory);
  if ((secured.mode & 0o777) !== PRIVATE_DIRECTORY_MODE) {
    throw new Error(
      `transcript directory permissions must be 0700, got ${displayMode(secured.mode)}`,
    );
  }
}

export async function prepareProjectTranscriptDirectory(input: {
  configDir: string;
  cwd: string;
}): Promise<string> {
  const configDir = requireCanonicalAbsolutePath("CLAUDE_CONFIG_DIR", input.configDir);
  await mkdir(configDir, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  await requireRealDirectory("CLAUDE_CONFIG_DIR", configDir);
  const cwd = await requireRealDirectory("cwd", input.cwd);

  const projectsDirectory = path.join(configDir, "projects");
  await ensurePrivateDirectory(projectsDirectory);
  const projectIdentity = createHash("sha256").update(cwd, "utf8").digest("hex");
  const projectDirectory = path.join(projectsDirectory, projectIdentity);
  await ensurePrivateDirectory(projectDirectory);
  return projectDirectory;
}

export async function validateClaudeCodeTmpdir(input: {
  cwd: string;
  tmpdir: string;
}): Promise<string> {
  const cwd = await requireRealDirectory("cwd", input.cwd);
  const tmpdir = requireCanonicalAbsolutePath("CLAUDE_CODE_TMPDIR", input.tmpdir);
  const expected = path.join(cwd, ".claude-tmp");
  if (tmpdir !== expected || path.basename(tmpdir) !== ".claude-tmp") {
    throw new Error("CLAUDE_CODE_TMPDIR must be the exact cwd/.claude-tmp path");
  }
  await requireRealDirectory("CLAUDE_CODE_TMPDIR", tmpdir);
  const status = await lstat(tmpdir);
  if ((status.mode & 0o777) !== PRIVATE_DIRECTORY_MODE) {
    throw new Error(
      `CLAUDE_CODE_TMPDIR permissions must be 0700, got ${displayMode(status.mode)}`,
    );
  }
  return tmpdir;
}
