// [Input] Optional SDK --settings value as inline JSON or a cwd-relative/absolute file path.
// [Output] One bounded, validated settings object for clean-room Runtime adapters.
// [Pos] Settings trust boundary; settings content is never emitted or persisted by the Runtime.
// [Sync] 2026-08-24: add fail-closed inline/file loading for Dream apiKeyHelper.

import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";

export interface RuntimeSettings {
  apiKeyHelper?: string;
}

const MAX_SETTINGS_BYTES = 1024 * 1024;
const MAX_HELPER_COMMAND_BYTES = 8192;

function fail(): never {
  throw new Error("Runtime settings are invalid or unsafe");
}

function parseSettingsObject(raw: string): RuntimeSettings {
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    fail();
  }
  if (!decoded || Array.isArray(decoded) || typeof decoded !== "object") fail();
  const source = decoded as Record<string, unknown>;
  const helper = source.apiKeyHelper;
  if (helper === undefined) return {};
  if (
    typeof helper !== "string" ||
    helper.length === 0 ||
    Buffer.byteLength(helper, "utf8") > MAX_HELPER_COMMAND_BYTES ||
    /[\0\r\n]/.test(helper)
  ) {
    fail();
  }
  return { apiKeyHelper: helper };
}

async function settingsFile(value: string, cwd: string): Promise<string> {
  if (value.includes("\0")) fail();
  const candidate = path.isAbsolute(value) ? path.normalize(value) : path.resolve(cwd, value);
  let linkInfo;
  let canonical: string;
  try {
    linkInfo = await lstat(candidate);
    canonical = await realpath(candidate);
  } catch {
    fail();
  }
  if (
    linkInfo.isSymbolicLink() ||
    !linkInfo.isFile() ||
    linkInfo.size > MAX_SETTINGS_BYTES ||
    (linkInfo.mode & 0o022) !== 0 ||
    (typeof process.getuid === "function" && linkInfo.uid !== process.getuid())
  ) {
    fail();
  }
  let body: Buffer;
  try {
    body = await readFile(canonical);
  } catch {
    fail();
  }
  if (body.byteLength > MAX_SETTINGS_BYTES || body.includes(0)) fail();
  return body.toString("utf8");
}

export async function loadRuntimeSettings(
  value: string | undefined,
  cwd: string,
): Promise<RuntimeSettings> {
  if (value === undefined) return {};
  const trimmed = value.trim();
  if (!trimmed) fail();
  if (trimmed.startsWith("{")) return parseSettingsObject(trimmed);
  return parseSettingsObject(await settingsFile(trimmed, cwd));
}
