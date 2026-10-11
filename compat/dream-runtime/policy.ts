// [Input] Explicit candidate environment and canonical thread workspace; no implicit process.env inheritance.
// [Output] Validated child/model projection and image-compatible copies for original compact requests.
// [Pos] Pure compatibility policy used by byte-bound original-module compiler transforms.
// [Sync] 2026-09-13: preserve Dream contracts without duplicating Runtime state or changing original src.
// [Sync] 2026-10-11: keep current compact materials and actual completion output; omit historical image bytes only from summaries.

import { closeSync, lstatSync, openSync, readSync, realpathSync } from "node:fs";
import { basename, delimiter, isAbsolute, join, resolve } from "node:path";

type Environment = Record<string, string | undefined>;
export const NOTION_KEYS = ["NOTION_HOME", "NOTION_API_TOKEN", "NOTION_KEYRING", "NOTION_WORKERS_CONFIG_FILE"] as const;
export const NOTION_HTTPS_DOMAINS = ["api.notion.com:443", "developers.notion.com:443", "ntn.dev:443"] as const;
const NATIVE_MAGICS = new Set(["7f454c46", "feedface", "cefaedfe", "feedfacf", "cffaedfe", "cafebabe", "bebafeca", "cafebabf", "bfbafeca"]);

export function stripNotionEnvironment(candidate: Environment): Environment {
  const result = { ...candidate };
  // Explicit undefined also defeats execa's default {...process.env, ...env} merge.
  for (const name of NOTION_KEYS) result[name] = undefined;
  return result;
}

function safeOwner(uid: number): boolean {
  return uid === 0 || (typeof process.getuid === "function" && uid === process.getuid());
}

function nativeNtn(pathValue: string | undefined): string | undefined {
  if (!pathValue) return undefined;
  for (const directory of pathValue.split(delimiter)) {
    if (!isAbsolute(directory)) return undefined;
    let fd: number | undefined;
    try {
      const executable = realpathSync(join(directory, "ntn"));
      const info = lstatSync(executable);
      if (basename(executable) !== "ntn" || !info.isFile() || !safeOwner(info.uid) ||
          (info.mode & 0o111) === 0 || (info.mode & 0o022) !== 0) return undefined;
      fd = openSync(executable, "r");
      const header = Buffer.alloc(4);
      if (readSync(fd, header, 0, 4, 0) === 4 && NATIVE_MAGICS.has(header.toString("hex"))) return executable;
      return undefined;
    } catch { /* Invalid/missing PATH entries do not enable Notion. */ }
    finally { if (fd !== undefined) closeSync(fd); }
  }
  return undefined;
}

export function notionProjection(workspace: string, source: Environment): {
  environment: Environment; allowRead: string[]; allowWrite: string[]; allowedDomains: string[];
} {
  const empty = { environment: {}, allowRead: [], allowWrite: [], allowedDomains: [] };
  try {
    const canonicalWorkspace = resolve(workspace);
    if (realpathSync(canonicalWorkspace) !== canonicalWorkspace) return empty;
    const home = join(canonicalWorkspace, ".notion-home");
    if (source.NOTION_HOME !== home) return empty;
    const info = lstatSync(home);
    if (!info.isDirectory() || info.isSymbolicLink() || !safeOwner(info.uid) ||
        (info.mode & 0o777) !== 0o700 || realpathSync(home) !== home) return empty;
    const executable = nativeNtn(source.PATH);
    if (!executable) return empty;
    const environment: Environment = { NOTION_HOME: home, NOTION_KEYRING: "0" };
    const token = source.NOTION_API_TOKEN;
    if (token && token.trim() === token && !/[\0\r\n]/.test(token)) environment.NOTION_API_TOKEN = token;
    const workers = join(home, "workers.json");
    if (source.NOTION_WORKERS_CONFIG_FILE === workers) {
      try {
        const file = lstatSync(workers);
        if (file.isFile() && !file.isSymbolicLink() && safeOwner(file.uid) &&
            (file.mode & 0o022) === 0 && realpathSync(workers) === workers) {
          environment.NOTION_WORKERS_CONFIG_FILE = workers;
        }
      } catch { /* Optional workers configuration is omitted if invalid. */ }
    }
    return { environment, allowRead: [home, executable], allowWrite: [home], allowedDomains: [...NOTION_HTTPS_DOMAINS] };
  } catch { return empty; }
}

export function notionBashEnvironment(candidate: Environment, workspace: string, source: Environment): Environment {
  return { ...stripNotionEnvironment(candidate), ...notionProjection(workspace, { ...source, PATH: candidate.PATH }).environment };
}

export function explicitPositiveInteger(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  if (!/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new Error(`Invalid explicit ${name}: expected a positive safe integer`);
  }
  return Number(value);
}

export function explicitEffort(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (value === "auto" || value === "unset") return undefined;
  if (!["low", "medium", "high", "xhigh", "max"].includes(value)) {
    throw new Error("Invalid explicit CLAUDE_CODE_EFFORT_LEVEL");
  }
  return value;
}

const compactInput = Symbol("ink compact current input");
function compactRecord(value: unknown): Record<PropertyKey, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<PropertyKey, unknown> : undefined;
}

// The original local-command userMessage already contains the current marker
// and processed materials. Carry a copy in memory without changing history,
// its last UUID, tool permissions, or any external request/control channel.
export function withCompactInputContext<T extends object>(context: T, input: unknown): T {
  const user = compactRecord(input), message = compactRecord(user?.message);
  if (user?.type !== "user" || !Array.isArray(message?.content)) return context;
  const prefix = message.content.slice(0, -1);
  const markers = prefix.filter(value => {
    const block = compactRecord(value);
    return block?.type === "text" && typeof block.text === "string"
      && /^\[Ink image materials: [^\]\r\n]+\]$/.test(block.text);
  });
  if (markers.length !== 1) return context;
  return { ...context, [compactInput]: prefix };
}

export function bindCompactSummaryRequest<T>(request: T, context: unknown): T {
  const prefix = compactRecord(context)?.[compactInput];
  const original = compactRecord(request), message = compactRecord(original?.message);
  if (!Array.isArray(prefix) || !message) return request;
  const content = typeof message.content === "string"
    ? [{ type: "text", text: message.content }]
    : Array.isArray(message.content) ? message.content : undefined;
  if (!content) return request;
  return { ...original, message: { ...message, content: [...prefix, ...content] } } as T;
}

// Only the original compact summarizer calls this projection. Images remain
// in the canonical messages/transcript and Dream's files and history.
export function nativeImageCompactMessage<T>(message: T): T {
  const original = compactRecord(message), assistant = compactRecord(original?.message);
  if (original?.type !== "assistant" || !Array.isArray(assistant?.content)) return message;
  let changed = false;
  const content = assistant.content.map(value => {
    const block = compactRecord(value);
    const result = block?.type === "image_generation_tool_result";
    const call = block?.type === "server_tool_use" && block.name === "image_generation";
    if (!result && !call) return value;
    changed = true;
    const identity: Record<string, string> = {};
    const id = result ? block!.tool_use_id : block!.id;
    if (typeof id === "string") identity.call_id = id;
    for (const key of ["gateway_request_id", "response_id"]) {
      if (typeof block![key] === "string") identity[key] = block![key] as string;
    }
    return { type: "text", text: `[Image generation ${result ? "result; image data omitted from summary" : "call"}: ${JSON.stringify(identity)}]` };
  });
  return changed ? { ...original, message: { ...assistant, content } } as T : message;
}

export function compactCompletionOutput(messages: unknown, previousMessages: unknown): { content: string; uuid: string } | undefined {
  const existingIds = new Set(Array.isArray(previousMessages) ? previousMessages.flatMap(value => {
    const uuid = compactRecord(value)?.uuid;
    return typeof uuid === "string" ? [uuid] : [];
  }) : []);
  if (!Array.isArray(messages) || !messages.some(value => {
    const message = compactRecord(value);
    return message?.type === "system" && message.subtype === "compact_boundary"
      && typeof message.uuid === "string" && !existingIds.has(message.uuid);
  })) return undefined;
  const outputs = messages.flatMap(value => {
    const user = compactRecord(value), message = compactRecord(user?.message);
    const content = message?.content;
    const start = "<local-command-stdout>", end = "</local-command-stdout>";
    return user?.type === "user" && typeof user.uuid === "string" && user.uuid.length > 0 && !existingIds.has(user.uuid)
      && typeof content === "string" && content.startsWith(start) && content.endsWith(end)
      && content.slice(start.length, -end.length).trim()
      ? [{ content, uuid: user.uuid }] : [];
  });
  return outputs.length === 1 ? outputs[0] : undefined;
}
