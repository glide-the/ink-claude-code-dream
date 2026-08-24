// [Input] Explicit canonical config root plus MCP server identity and OAuth state mutations.
// [Output] Symlink-safe, owner-only, atomically persisted OAuth state for one server.
// [Pos] Credential filesystem boundary for the clean-room MCP OAuth provider.
// [Sync] 2026-08-24: add 0700/0600 canonical storage with serialized atomic updates.

import { createHash, randomBytes } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import path from "node:path";
import type { OAuthClientInformationMixed, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { OAuthDiscoveryState } from "@modelcontextprotocol/sdk/client/auth.js";

export interface PersistedOAuthState {
  clientInformation?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  codeVerifier?: string;
  discoveryState?: OAuthDiscoveryState;
  callbackState?: string;
}

const EMPTY_STATE: Readonly<PersistedOAuthState> = Object.freeze({});

function assertAbsoluteCanonicalInput(configDir: string): string {
  if (!configDir || !path.isAbsolute(configDir)) {
    throw new Error("OAuth storage requires an explicit absolute CLAUDE_CONFIG_DIR");
  }
  const normalized = path.normalize(configDir);
  if (normalized !== configDir || normalized === path.parse(normalized).root) {
    throw new Error("CLAUDE_CONFIG_DIR must be a normalized non-root path");
  }
  return normalized;
}

async function assertPrivateDirectory(directory: string, create: boolean): Promise<string> {
  if (create) await createDirectoryWithoutSymlinkTraversal(directory);
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error("OAuth storage path must be a real directory");
  }
  if (typeof process.getuid === "function" && info.uid !== process.getuid()) {
    throw new Error("OAuth storage directory must be owned by the current user");
  }
  const canonical = await realpath(directory);
  if (canonical !== directory) {
    throw new Error("OAuth storage path must not traverse symlinks");
  }
  await chmod(directory, 0o700);
  return canonical;
}

async function createDirectoryWithoutSymlinkTraversal(directory: string): Promise<void> {
  const missing: string[] = [];
  let cursor = directory;
  while (true) {
    try {
      const info = await lstat(cursor);
      if (!info.isDirectory() || info.isSymbolicLink()) {
        throw new Error("OAuth storage path must not traverse symlinks");
      }
      if (await realpath(cursor) !== cursor) {
        throw new Error("OAuth storage path must not traverse symlinks");
      }
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      missing.unshift(cursor);
      const parent = path.dirname(cursor);
      if (parent === cursor) throw new Error("OAuth storage has no canonical parent directory");
      cursor = parent;
    }
  }
  for (const next of missing) {
    await mkdir(next, { mode: 0o700 });
    const info = await lstat(next);
    if (!info.isDirectory() || info.isSymbolicLink() || await realpath(next) !== next) {
      throw new Error("OAuth storage path must not traverse symlinks");
    }
  }
}

function stateFileName(serverUrl: string): string {
  const identity = new URL(serverUrl).href;
  return `${createHash("sha256").update(identity).digest("hex")}.json`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseState(text: string): PersistedOAuthState {
  const value = JSON.parse(text) as unknown;
  if (!isRecord(value) || value.schemaVersion !== 1 || !isRecord(value.state)) {
    throw new Error("OAuth credential state is invalid");
  }
  return value.state as PersistedOAuthState;
}

export class PrivateOAuthStore {
  readonly configDir: string;
  readonly serverUrl: string;
  private readonly fileName: string;
  private operation = Promise.resolve<unknown>(undefined);

  constructor(configDir: string, serverUrl: string) {
    this.configDir = assertAbsoluteCanonicalInput(configDir);
    this.serverUrl = new URL(serverUrl).href;
    this.fileName = stateFileName(this.serverUrl);
  }

  get relativeStatePath(): string {
    return path.join("mcp-oauth", this.fileName);
  }

  async read(): Promise<PersistedOAuthState> {
    return this.serialize(async () => this.readUnlocked());
  }

  async update(mutator: (state: PersistedOAuthState) => PersistedOAuthState): Promise<void> {
    await this.serialize(async () => {
      const current = await this.readUnlocked();
      await this.writeUnlocked(mutator({ ...current }));
    });
  }

  async clear(): Promise<void> {
    await this.serialize(async () => {
      const directory = await this.storageDirectory(false).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      });
      if (!directory) return;
      await rm(path.join(directory, this.fileName), { force: true });
    });
  }

  private async serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operation.then(operation, operation);
    this.operation = result.then(() => undefined, () => undefined);
    return result;
  }

  private async storageDirectory(create: boolean): Promise<string> {
    const root = await assertPrivateDirectory(this.configDir, create);
    const directory = path.join(root, "mcp-oauth");
    return assertPrivateDirectory(directory, create);
  }

  private async readUnlocked(): Promise<PersistedOAuthState> {
    const directory = await this.storageDirectory(false).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (!directory) return { ...EMPTY_STATE };
    const file = path.join(directory, this.fileName);
    let info;
    try {
      info = await lstat(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ...EMPTY_STATE };
      throw error;
    }
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new Error("OAuth credential state must be a regular file");
    }
    if (typeof process.getuid === "function" && info.uid !== process.getuid()) {
      throw new Error("OAuth credential state must be owned by the current user");
    }
    await chmod(file, 0o600);
    const canonical = await realpath(file);
    if (canonical !== file) throw new Error("OAuth credential state must not traverse symlinks");
    return parseState(await readFile(file, "utf8"));
  }

  private async writeUnlocked(state: PersistedOAuthState): Promise<void> {
    const directory = await this.storageDirectory(true);
    const target = path.join(directory, this.fileName);
    const temporary = path.join(
      directory,
      `.${this.fileName}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`,
    );
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify({ schemaVersion: 1, state })}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await chmod(temporary, 0o600);
      await rename(temporary, target);
      await chmod(target, 0o600);
      const directoryHandle = await open(directory, "r");
      try {
        await directoryHandle.sync();
      } finally {
        await directoryHandle.close();
      }
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }
}
