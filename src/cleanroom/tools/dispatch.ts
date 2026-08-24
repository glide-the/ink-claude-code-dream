// [Input] Model-generated built-in tool call plus Workspace, permission, sandbox, and AbortSignal context.
// [Output] Bounded results for Dream's Workspace/session tools or a fail-closed error without duplicate permission prompts.
// [Pos] Clean-room tool execution coordinator; all paths cross WorkspaceBoundary first.
// [Sync] 2026-08-24: add bounded notebook/todo/task/list/multi-edit and stored Bash output tools.
// [Sync] 2026-08-24: honor an explicit PreToolUse allow without invoking can_use_tool a second time.

import { constants } from "node:fs";
import {
  lstat,
  chmod,
  mkdir,
  open,
  opendir,
  readdir,
  readFile,
  realpath,
  rename,
  stat,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { FailClosedSandbox, type SandboxAdapter } from "../sandbox/sandbox.ts";
import { isCleanroomToolName, type CleanroomToolName } from "./definitions.ts";
import { ToolPermissionPolicy } from "./permissions.ts";
import { WorkspaceBoundary } from "./workspace.ts";

type JsonObject = Record<string, unknown>;

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TRAVERSAL_ENTRIES = 100_000;
const DEFAULT_GREP_LIMIT = 1_000;
const DEFAULT_BASH_TIMEOUT_MS = 120_000;
const TASK_STATUSES = new Set(["pending", "in_progress", "completed"]);

export interface ToolDispatchContext {
  workspace: WorkspaceBoundary;
  permissions: ToolPermissionPolicy;
  permissionGranted?: boolean;
  sandbox?: SandboxAdapter;
  signal?: AbortSignal;
  allowUntrustedSandboxForTests?: boolean;
  stateDirectory?: string;
}

export interface CleanroomToolResult {
  content: string;
  isError: boolean;
  terminalReason?: "completed" | "timed_out" | "cancelled" | "output_limit";
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requiredString(input: JsonObject, name: string, allowEmpty = false): string {
  const value = input[name];
  if (typeof value !== "string" || (!allowEmpty && value.length === 0) || value.includes("\0")) {
    throw new Error(`${name} must be ${allowEmpty ? "a" : "a non-empty"} string without NUL bytes`);
  }
  return value;
}

function optionalPositiveInteger(
  input: JsonObject,
  name: string,
  fallback: number,
  maximum: number,
): number {
  const value = input[name];
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || (value as number) <= 0 || (value as number) > maximum) {
    throw new Error(`${name} must be an integer between 1 and ${maximum}`);
  }
  return value as number;
}

function safeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function globRegularExpression(pattern: string): RegExp {
  if (!pattern || pattern.length > 4096 || pattern.includes("\0")) {
    throw new Error("glob pattern must contain between 1 and 4096 characters");
  }
  const normalized = pattern.replaceAll("\\", "/").replace(/^\.\//, "");
  let source = "^";
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];
    if (character === "*") {
      if (normalized[index + 1] === "*") {
        index += 1;
        if (normalized[index + 1] === "/") {
          index += 1;
          source += "(?:.*/)?";
        } else {
          source += ".*";
        }
      } else {
        source += "[^/]*";
      }
    } else if (character === "?") {
      source += "[^/]";
    } else {
      source += character.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
    }
  }
  return new RegExp(`${source}$`);
}

interface TraversedFile {
  absolute: string;
  relative: string;
}

async function traverseFiles(
  workspace: WorkspaceBoundary,
  root: string,
  signal?: AbortSignal,
): Promise<TraversedFile[]> {
  const rootMetadata = await stat(root);
  if (rootMetadata.isFile()) {
    return [{ absolute: root, relative: path.basename(root) }];
  }
  if (!rootMetadata.isDirectory()) throw new Error("search path must be a file or directory");

  const files: TraversedFile[] = [];
  const queue = [root];
  const visitedDirectories = new Set<string>([await realpath(root)]);
  let entries = 0;
  while (queue.length > 0) {
    if (signal?.aborted) throw new Error("tool call was cancelled");
    const directory = queue.shift()!;
    const handle = await opendir(directory);
    for await (const entry of handle) {
      entries += 1;
      if (entries > MAX_TRAVERSAL_ENTRIES) {
        throw new Error(`Workspace traversal exceeds ${MAX_TRAVERSAL_ENTRIES} entries`);
      }
      const candidate = path.join(directory, entry.name);
      const relative = path.relative(root, candidate).split(path.sep).join("/");
      if (entry.isSymbolicLink()) {
        try {
          const canonical = await workspace.resolveExisting(
            path.relative(workspace.root, candidate),
            "any",
          );
          const metadata = await stat(canonical);
          if (metadata.isFile()) files.push({ absolute: canonical, relative });
          // Symlink directories are deliberately not traversed, avoiding cycles and races.
        } catch {
          // Escaping or broken symlinks are omitted from discovery; direct access still errors.
        }
      } else if (entry.isDirectory()) {
        const canonical = await realpath(candidate);
        if (!workspace.contains(canonical)) continue;
        if (!visitedDirectories.has(canonical)) {
          visitedDirectories.add(canonical);
          queue.push(canonical);
        }
      } else if (entry.isFile()) {
        files.push({ absolute: candidate, relative });
      }
    }
  }
  return files;
}

async function atomicWrite(
  workspace: WorkspaceBoundary,
  rawPath: string,
  content: string,
): Promise<string> {
  const initialTarget = await workspace.resolveWrite(rawPath);
  await mkdir(path.dirname(initialTarget), { recursive: true, mode: 0o700 });
  const canonicalParent = await workspace.resolveExisting(
    path.relative(workspace.root, path.dirname(initialTarget)),
    "directory",
  );
  const target = path.join(canonicalParent, path.basename(initialTarget));
  const existing = await lstat(target).catch(() => undefined);
  if (existing?.isSymbolicLink()) throw new Error("Refusing to replace a symbolic-link target");
  if (existing?.isDirectory()) throw new Error("Workspace write target is a directory");
  const mode = existing ? existing.mode & 0o777 : 0o600;
  const temporary = path.join(canonicalParent, `.${path.basename(target)}.${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await open(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      mode,
    );
    await handle.writeFile(content, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, target);
  } catch (error: unknown) {
    await handle?.close().catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
  return target;
}

async function executeRead(input: JsonObject, context: ToolDispatchContext): Promise<string> {
  const rawPath = requiredString(input, "file_path");
  const target = await context.workspace.resolveExisting(rawPath, "file");
  const metadata = await stat(target);
  if (metadata.size > MAX_FILE_BYTES) throw new Error(`Read refuses files larger than ${MAX_FILE_BYTES} bytes`);
  const text = await readFile(target, "utf8");
  const lines = text.split("\n");
  const offset = optionalPositiveInteger(input, "offset", 1, Number.MAX_SAFE_INTEGER);
  const limit = optionalPositiveInteger(input, "limit", lines.length || 1, 10_000);
  return lines.slice(offset - 1, offset - 1 + limit).join("\n");
}

async function executeWrite(input: JsonObject, context: ToolDispatchContext): Promise<string> {
  const rawPath = requiredString(input, "file_path");
  const content = requiredString(input, "content", true);
  const target = await atomicWrite(context.workspace, rawPath, content);
  return `Wrote ${Buffer.byteLength(content, "utf8")} bytes to ${path.relative(context.workspace.root, target)}`;
}

async function executeEdit(input: JsonObject, context: ToolDispatchContext): Promise<string> {
  const rawPath = requiredString(input, "file_path");
  const oldString = requiredString(input, "old_string");
  const newString = requiredString(input, "new_string", true);
  const replaceAll = input.replace_all === true;
  const target = await context.workspace.resolveExisting(rawPath, "file");
  const metadata = await stat(target);
  if (metadata.size > MAX_FILE_BYTES) throw new Error(`Edit refuses files larger than ${MAX_FILE_BYTES} bytes`);
  const content = await readFile(target, "utf8");
  const occurrences = content.split(oldString).length - 1;
  if (occurrences === 0) throw new Error("Edit old_string was not found");
  if (!replaceAll && occurrences !== 1) {
    throw new Error("Edit old_string is not unique; set replace_all to replace every occurrence");
  }
  const changed = replaceAll ? content.split(oldString).join(newString) : content.replace(oldString, newString);
  await atomicWrite(context.workspace, path.relative(context.workspace.root, target), changed);
  return `Updated ${replaceAll ? occurrences : 1} occurrence(s) in ${path.relative(context.workspace.root, target)}`;
}

async function executeGlob(input: JsonObject, context: ToolDispatchContext): Promise<string> {
  const pattern = requiredString(input, "pattern");
  const rawRoot = typeof input.path === "string" ? input.path : ".";
  const root = await context.workspace.resolveExisting(rawRoot, "directory");
  const matcher = globRegularExpression(pattern);
  const files = await traverseFiles(context.workspace, root, context.signal);
  return files
    .filter((file) => matcher.test(file.relative))
    .map((file) => path.relative(context.workspace.root, file.absolute).split(path.sep).join("/"))
    .sort()
    .join("\n");
}

async function executeGrep(input: JsonObject, context: ToolDispatchContext): Promise<string> {
  const pattern = requiredString(input, "pattern");
  if (pattern.length > 4096) throw new Error("grep pattern exceeds 4096 characters");
  let expression: RegExp;
  try {
    expression = new RegExp(pattern);
  } catch {
    throw new Error("grep pattern is not a valid regular expression");
  }
  const rawRoot = typeof input.path === "string" ? input.path : ".";
  const root = await context.workspace.resolveExisting(rawRoot, "any");
  const fileMatcher = typeof input.glob === "string" ? globRegularExpression(input.glob) : undefined;
  const limit = optionalPositiveInteger(input, "head_limit", DEFAULT_GREP_LIMIT, 10_000);
  const matches: string[] = [];
  for (const file of await traverseFiles(context.workspace, root, context.signal)) {
    if (fileMatcher && !fileMatcher.test(file.relative)) continue;
    if ((await stat(file.absolute)).size > MAX_FILE_BYTES) continue;
    const text = await readFile(file.absolute, "utf8").catch(() => undefined);
    if (text === undefined || text.includes("\0")) continue;
    const label = path.relative(context.workspace.root, file.absolute).split(path.sep).join("/");
    for (const [index, line] of text.split("\n").entries()) {
      if (expression.test(line)) matches.push(`${label}:${index + 1}:${line}`);
      if (matches.length >= limit) return matches.join("\n");
    }
  }
  return matches.join("\n");
}

async function executeMultiEdit(input: JsonObject, context: ToolDispatchContext): Promise<string> {
  const rawPath = requiredString(input, "file_path");
  if (!Array.isArray(input.edits) || input.edits.length === 0 || input.edits.length > 100) {
    throw new Error("edits must contain between 1 and 100 replacements");
  }
  const target = await context.workspace.resolveExisting(rawPath, "file");
  if ((await stat(target)).size > MAX_FILE_BYTES) throw new Error("MultiEdit file is too large");
  let content = await readFile(target, "utf8");
  let changes = 0;
  for (const rawEdit of input.edits) {
    if (!isObject(rawEdit)) throw new Error("each edit must be an object");
    const oldString = requiredString(rawEdit, "old_string");
    const newString = requiredString(rawEdit, "new_string", true);
    const occurrences = content.split(oldString).length - 1;
    if (occurrences === 0) throw new Error("MultiEdit old_string was not found");
    if (rawEdit.replace_all !== true && occurrences !== 1) {
      throw new Error("MultiEdit old_string is not unique");
    }
    content = rawEdit.replace_all === true
      ? content.split(oldString).join(newString)
      : content.replace(oldString, newString);
    changes += rawEdit.replace_all === true ? occurrences : 1;
  }
  await atomicWrite(context.workspace, path.relative(context.workspace.root, target), content);
  return `Applied ${changes} replacement(s) to ${path.relative(context.workspace.root, target)}`;
}

async function executeLs(input: JsonObject, context: ToolDispatchContext): Promise<string> {
  const rawPath = typeof input.path === "string" ? input.path : ".";
  const directory = await context.workspace.resolveExisting(rawPath, "directory");
  const entries = await readdir(directory, { withFileTypes: true });
  if (entries.length > 10_000) throw new Error("LS directory exceeds 10000 entries");
  return entries
    .map((entry) => `${entry.name}${entry.isDirectory() ? "/" : entry.isSymbolicLink() ? "@" : ""}`)
    .sort()
    .join("\n");
}

async function executeNotebookRead(input: JsonObject, context: ToolDispatchContext): Promise<string> {
  const rawPath = requiredString(input, "notebook_path");
  const target = await context.workspace.resolveExisting(rawPath, "file");
  const metadata = await stat(target);
  if (metadata.size > MAX_FILE_BYTES) throw new Error("NotebookRead file is too large");
  const parsed: unknown = JSON.parse(await readFile(target, "utf8"));
  if (!isObject(parsed) || !Array.isArray(parsed.cells)) throw new Error("invalid notebook document");
  const cells = parsed.cells.slice(0, 1_000).map((cell, index) => {
    if (!isObject(cell)) return { index, cell_type: "invalid", source: "" };
    const source = Array.isArray(cell.source)
      ? cell.source.filter((part) => typeof part === "string").join("")
      : typeof cell.source === "string" ? cell.source : "";
    return { index, cell_type: cell.cell_type, source: source.slice(0, 100_000), outputs: Array.isArray(cell.outputs) ? cell.outputs.slice(0, 100) : [] };
  });
  return JSON.stringify({ cells });
}

function requireStateDirectory(context: ToolDispatchContext): string {
  if (!context.stateDirectory || !path.isAbsolute(context.stateDirectory)) {
    throw new Error("session state is unavailable without CLAUDE_CONFIG_DIR");
  }
  return context.stateDirectory;
}

async function privateJsonWrite(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const parent = path.dirname(file);
  const parentStatus = await lstat(parent);
  if (!parentStatus.isDirectory() || parentStatus.isSymbolicLink()) {
    throw new Error("session state directory is invalid");
  }
  await chmod(parent, 0o700);
  if (await realpath(parent) !== path.resolve(parent)) {
    throw new Error("session state directory contains a symlink");
  }
  const temporary = `${file}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    await handle.writeFile(`${JSON.stringify(value)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, file);
  } finally {
    await handle?.close().catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
  }
}

async function privateJsonRead(file: string): Promise<unknown> {
  const parent = path.dirname(file);
  const parentStatus = await lstat(parent);
  if (!parentStatus.isDirectory() || parentStatus.isSymbolicLink() || await realpath(parent) !== path.resolve(parent)) {
    throw new Error("session state directory is invalid");
  }
  const status = await lstat(file);
  if (!status.isFile() || status.isSymbolicLink() || status.size > MAX_FILE_BYTES) {
    throw new Error("session state file is invalid");
  }
  return JSON.parse(await readFile(file, "utf8"));
}

async function executeTodoWrite(input: JsonObject, context: ToolDispatchContext): Promise<string> {
  if (!Array.isArray(input.todos) || input.todos.length > 1_000) {
    throw new Error("todos must be an array with at most 1000 items");
  }
  const todos = input.todos.map((item) => {
    if (!isObject(item)) throw new Error("each todo must be an object");
    const content = requiredString(item, "content");
    const status = requiredString(item, "status");
    if (!TASK_STATUSES.has(status)) throw new Error("todo status is invalid");
    return { content, status, ...(typeof item.activeForm === "string" ? { activeForm: item.activeForm } : {}) };
  });
  await privateJsonWrite(path.join(requireStateDirectory(context), "todos.json"), todos);
  return JSON.stringify(todos);
}

async function executeTodoRead(context: ToolDispatchContext): Promise<string> {
  const file = path.join(requireStateDirectory(context), "todos.json");
  return JSON.stringify(await privateJsonRead(file).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  }));
}

function taskId(input: JsonObject): string {
  const id = requiredString(input, "taskId");
  if (!/^[1-9][0-9]{0,8}$/.test(id)) throw new Error("taskId must be a positive decimal id");
  return id;
}

function tasksDirectory(context: ToolDispatchContext): string {
  const state = requireStateDirectory(context);
  const configDir = process.env.CLAUDE_CONFIG_DIR;
  if (!configDir || !path.isAbsolute(configDir)) return path.join(state, "tasks");
  const listId = process.env.CLAUDE_CODE_TASK_LIST_ID || "main";
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(listId)) throw new Error("task list id is invalid");
  return path.join(configDir, "tasks", listId);
}

async function listTasks(context: ToolDispatchContext): Promise<JsonObject[]> {
  const directory = tasksDirectory(context);
  const names = await readdir(directory).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const tasks: JsonObject[] = [];
  for (const name of names.filter((value) => /^[1-9][0-9]{0,8}\.json$/.test(value)).sort((a, b) => Number.parseInt(a) - Number.parseInt(b))) {
    const task = await privateJsonRead(path.join(directory, name));
    if (isObject(task)) tasks.push({ id: name.slice(0, -5), ...task });
  }
  return tasks;
}

async function executeTaskCreate(input: JsonObject, context: ToolDispatchContext): Promise<string> {
  const subject = requiredString(input, "subject");
  const existing = await listTasks(context);
  const id = String(existing.reduce((max, task) => Math.max(max, Number(task.id) || 0), 0) + 1);
  const task = {
    subject,
    description: typeof input.description === "string" ? input.description : "",
    activeForm: typeof input.activeForm === "string" ? input.activeForm : "",
    status: "pending",
    owner: null,
    blockedBy: [],
  };
  await privateJsonWrite(path.join(tasksDirectory(context), `${id}.json`), task);
  return JSON.stringify({ id, ...task });
}

async function executeTaskUpdate(input: JsonObject, context: ToolDispatchContext): Promise<string> {
  const id = taskId(input);
  const file = path.join(tasksDirectory(context), `${id}.json`);
  const current = await privateJsonRead(file);
  if (!isObject(current)) throw new Error("task state is invalid");
  const next: JsonObject = { ...current };
  for (const field of ["subject", "description", "activeForm", "owner"] as const) {
    if (input[field] !== undefined) next[field] = requiredString(input, field, field !== "subject");
  }
  if (input.status !== undefined) {
    const status = requiredString(input, "status");
    if (!TASK_STATUSES.has(status)) throw new Error("task status is invalid");
    next.status = status;
  }
  const blocked = new Set(Array.isArray(next.blockedBy) ? next.blockedBy.map(String) : []);
  if (Array.isArray(input.addBlockedBy)) for (const value of input.addBlockedBy) blocked.add(String(value));
  if (Array.isArray(input.removeBlockedBy)) for (const value of input.removeBlockedBy) blocked.delete(String(value));
  next.blockedBy = [...blocked];
  await privateJsonWrite(file, next);
  return JSON.stringify({ id, ...next });
}

async function executeTaskGet(input: JsonObject, context: ToolDispatchContext): Promise<string> {
  const id = taskId(input);
  const task = await privateJsonRead(path.join(tasksDirectory(context), `${id}.json`));
  return JSON.stringify({ id, ...(isObject(task) ? task : {}) });
}

async function executeBashOutput(input: JsonObject, context: ToolDispatchContext): Promise<string> {
  const id = requiredString(input, "bash_id");
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(id)) throw new Error("bash_id is invalid");
  return JSON.stringify(await privateJsonRead(path.join(requireStateDirectory(context), "bash", `${id}.json`)));
}

async function executeBash(input: JsonObject, context: ToolDispatchContext, toolUseId: string): Promise<CleanroomToolResult> {
  const command = requiredString(input, "command");
  const timeoutMs = optionalPositiveInteger(input, "timeout", DEFAULT_BASH_TIMEOUT_MS, 120_000);
  const sandbox = context.sandbox ?? new FailClosedSandbox();
  if (sandbox.trust === "untrusted-test-fixture" && context.allowUntrustedSandboxForTests !== true) {
    throw new Error("Bash refuses an untrusted sandbox outside an explicit test fixture");
  }
  const result = await sandbox.execute({
    command,
    cwd: context.workspace.root,
    timeoutMs,
    signal: context.signal,
  });
  const status =
    result.terminalReason === "completed"
      ? `exit code ${String(result.exitCode)}`
      : result.terminalReason;
  const completed = {
    content: `${result.stdout}${result.stderr}${result.stderr && !result.stderr.endsWith("\n") ? "\n" : ""}[${status}]`,
    isError: result.terminalReason !== "completed" || result.exitCode !== 0,
    terminalReason: result.terminalReason,
  };
  if (context.stateDirectory) {
    await privateJsonWrite(path.join(context.stateDirectory, "bash", `${toolUseId}.json`), completed);
    completed.content += `\n[shell_id ${toolUseId}]`;
  }
  return completed;
}

export async function dispatchCleanroomTool(
  toolName: string,
  input: unknown,
  toolUseId: string,
  context: ToolDispatchContext,
): Promise<CleanroomToolResult> {
  if (!isCleanroomToolName(toolName)) {
    return { content: `Unknown clean-room tool: ${toolName}`, isError: true };
  }
  if (!isObject(input)) return { content: `${toolName} input must be an object`, isError: true };

  try {
    let approvedInput = input;
    if (context.permissionGranted !== true) {
      const permission = await context.permissions.authorize({
        toolName,
        input,
        toolUseId,
        signal: context.signal,
      });
      if (permission.behavior === "deny") {
        return { content: permission.message || `${toolName} was denied`, isError: true };
      }
      approvedInput = permission.updatedInput;
    }
    switch (toolName as CleanroomToolName) {
      case "Read":
        return { content: await executeRead(approvedInput, context), isError: false };
      case "Write":
        return { content: await executeWrite(approvedInput, context), isError: false };
      case "Edit":
        return { content: await executeEdit(approvedInput, context), isError: false };
      case "MultiEdit":
        return { content: await executeMultiEdit(approvedInput, context), isError: false };
      case "Glob":
        return { content: await executeGlob(approvedInput, context), isError: false };
      case "Grep":
        return { content: await executeGrep(approvedInput, context), isError: false };
      case "LS":
        return { content: await executeLs(approvedInput, context), isError: false };
      case "NotebookRead":
        return { content: await executeNotebookRead(approvedInput, context), isError: false };
      case "TodoRead":
        return { content: await executeTodoRead(context), isError: false };
      case "TodoWrite":
        return { content: await executeTodoWrite(approvedInput, context), isError: false };
      case "TaskCreate":
        return { content: await executeTaskCreate(approvedInput, context), isError: false };
      case "TaskUpdate":
        return { content: await executeTaskUpdate(approvedInput, context), isError: false };
      case "TaskList":
        return { content: JSON.stringify(await listTasks(context)), isError: false };
      case "TaskGet":
        return { content: await executeTaskGet(approvedInput, context), isError: false };
      case "Bash":
        return await executeBash(approvedInput, context, toolUseId);
      case "BashOutput":
        return { content: await executeBashOutput(approvedInput, context), isError: false };
    }
  } catch (error: unknown) {
    return { content: safeError(error), isError: true };
  }
}
