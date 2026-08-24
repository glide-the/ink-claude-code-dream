// [Input] An explicit absolute CLAUDE_CONFIG_DIR and user-scoped MCP mutations.
// [Output] Symlink-safe private `.claude.json` and `.credentials.json` managed keys.
// [Pos] Filesystem authority boundary for the clean-room MCP management CLI.
// [Sync] 2026-08-24: add canonical 0700 roots and atomic 0600 managed-key writes.

import { randomBytes } from "node:crypto";
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

export type JsonObject = Record<string, unknown>;
export type UserMcpServers = Record<string, JsonObject>;

const USER_CONFIG_FILE = ".claude.json";
const CREDENTIALS_FILE = ".credentials.json";
const MAX_DOCUMENT_BYTES = 1_048_576;

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function configRootInput(value: string | undefined): string {
  if (!value || !path.isAbsolute(value)) {
    throw new Error("MCP management requires an explicit absolute CLAUDE_CONFIG_DIR");
  }
  const normalized = path.normalize(value);
  if (normalized !== value || normalized === path.parse(normalized).root) {
    throw new Error("CLAUDE_CONFIG_DIR must be a normalized non-root path");
  }
  return normalized;
}

async function ensureCanonicalPrivateDirectory(directory: string): Promise<string> {
  const missing: string[] = [];
  let cursor = directory;
  while (true) {
    try {
      const info = await lstat(cursor);
      if (!info.isDirectory() || info.isSymbolicLink() || await realpath(cursor) !== cursor) {
        throw new Error("CLAUDE_CONFIG_DIR must not traverse symlinks");
      }
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      missing.unshift(cursor);
      const parent = path.dirname(cursor);
      if (parent === cursor) throw new Error("CLAUDE_CONFIG_DIR has no canonical parent");
      cursor = parent;
    }
  }
  for (const next of missing) {
    await mkdir(next, { mode: 0o700 });
    const info = await lstat(next);
    if (!info.isDirectory() || info.isSymbolicLink() || await realpath(next) !== next) {
      throw new Error("CLAUDE_CONFIG_DIR must not traverse symlinks");
    }
  }
  const root = await realpath(directory);
  if (root !== directory) throw new Error("CLAUDE_CONFIG_DIR must be canonical");
  const info = await lstat(root);
  if (typeof process.getuid === "function" && info.uid !== process.getuid()) {
    throw new Error("CLAUDE_CONFIG_DIR must be owned by the current user");
  }
  await chmod(root, 0o700);
  return root;
}

async function readPrivateDocument(file: string): Promise<JsonObject> {
  let info;
  try {
    info = await lstat(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
  if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0) {
    throw new Error("MCP state file is not a private regular file");
  }
  if (typeof process.getuid === "function" && info.uid !== process.getuid()) {
    throw new Error("MCP state file must be owned by the current user");
  }
  if (info.size > MAX_DOCUMENT_BYTES || await realpath(file) !== file) {
    throw new Error("MCP state file is unsafe");
  }
  const text = await readFile(file, "utf8");
  const value = JSON.parse(text) as unknown;
  if (!isObject(value)) throw new Error("MCP state file must contain a JSON object");
  return value;
}

async function writePrivateDocument(root: string, file: string, value: JsonObject): Promise<void> {
  const temporary = path.join(root, `.${path.basename(file)}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`);
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await chmod(temporary, 0o600);
    await rename(temporary, file);
    await chmod(file, 0o600);
    const directory = await open(root, "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

function managedMapping(document: JsonObject, key: string): Record<string, JsonObject> {
  const value = document[key];
  if (value === undefined) return {};
  if (!isObject(value)) throw new Error(`MCP state ${key} must be an object`);
  const result: Record<string, JsonObject> = {};
  for (const [name, item] of Object.entries(value)) {
    if (!name || !isObject(item)) throw new Error(`MCP state ${key} is malformed`);
    result[name] = structuredClone(item);
  }
  return result;
}

export class UserMcpStateStore {
  readonly configDir: string;
  private readonly configFile: string;
  private readonly credentialsFile: string;

  private constructor(configDir: string) {
    this.configDir = configDir;
    this.configFile = path.join(configDir, USER_CONFIG_FILE);
    this.credentialsFile = path.join(configDir, CREDENTIALS_FILE);
  }

  static async open(configDir: string | undefined): Promise<UserMcpStateStore> {
    return new UserMcpStateStore(
      await ensureCanonicalPrivateDirectory(configRootInput(configDir)),
    );
  }

  async listServers(): Promise<UserMcpServers> {
    return managedMapping(await readPrivateDocument(this.configFile), "mcpServers");
  }

  async getServer(name: string): Promise<JsonObject | undefined> {
    return (await this.listServers())[name];
  }

  async addHttpServer(name: string, serverUrl: string): Promise<void> {
    const url = new URL(serverUrl);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username || url.password || url.hash || serverUrl.length > 8_192
    ) {
      throw new Error("MCP server URL must be an absolute HTTP(S) URL without credentials or fragment");
    }
    const document = await readPrivateDocument(this.configFile);
    const servers = managedMapping(document, "mcpServers");
    servers[name] = { type: "http", url: url.href, oauth: true };
    await writePrivateDocument(this.configDir, this.configFile, { ...document, mcpServers: servers });
  }

  async removeServer(name: string): Promise<boolean> {
    const document = await readPrivateDocument(this.configFile);
    const servers = managedMapping(document, "mcpServers");
    if (!(name in servers)) return false;
    delete servers[name];
    await writePrivateDocument(this.configDir, this.configFile, { ...document, mcpServers: servers });
    await this.deleteOAuth(name);
    return true;
  }

  async readOAuth(name: string): Promise<JsonObject | undefined> {
    return managedMapping(await readPrivateDocument(this.credentialsFile), "mcpOAuth")[name];
  }

  async writeOAuth(name: string, state: JsonObject): Promise<void> {
    const document = await readPrivateDocument(this.credentialsFile);
    const oauth = managedMapping(document, "mcpOAuth");
    oauth[name] = structuredClone(state);
    await writePrivateDocument(this.configDir, this.credentialsFile, { ...document, mcpOAuth: oauth });
  }

  async deleteOAuth(name: string): Promise<void> {
    const document = await readPrivateDocument(this.credentialsFile);
    const oauth = managedMapping(document, "mcpOAuth");
    if (!(name in oauth)) return;
    delete oauth[name];
    const updated = { ...document };
    if (Object.keys(oauth).length > 0) updated.mcpOAuth = oauth;
    else delete updated.mcpOAuth;
    if (Object.keys(updated).length === 0) {
      await rm(this.credentialsFile, { force: true });
      return;
    }
    await writePrivateDocument(this.configDir, this.credentialsFile, updated);
  }
}
