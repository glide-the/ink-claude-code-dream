// [Input] Optional ANTHROPIC_CUSTOM_HEADERS environment value.
// [Output] A validated string-to-string header map for the Anthropic SDK.
// [Pos] Provider credential/header adapter; values are never logged or emitted to JSONL.
// [Sync] 2026-08-24: support Claude Code newline headers and JSON object fixtures.

function validateHeader(name: string, value: string): void {
  if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) {
    throw new Error("ANTHROPIC_CUSTOM_HEADERS contains an invalid header name");
  }
  if (/[^\t\x20-\x7e\x80-\xff]/.test(value)) {
    throw new Error("ANTHROPIC_CUSTOM_HEADERS contains an invalid header value");
  }
}

export function parseCustomHeaders(raw: string | undefined): Record<string, string> {
  if (!raw?.trim()) return {};

  const headers: Record<string, string> = Object.create(null) as Record<string, string>;
  if (raw.trimStart().startsWith("{")) {
    const decoded: unknown = JSON.parse(raw);
    if (!decoded || Array.isArray(decoded) || typeof decoded !== "object") {
      throw new Error("ANTHROPIC_CUSTOM_HEADERS JSON must be an object");
    }
    for (const [name, value] of Object.entries(decoded)) {
      if (typeof value !== "string") {
        throw new Error("ANTHROPIC_CUSTOM_HEADERS values must be strings");
      }
      validateHeader(name, value);
      headers[name] = value;
    }
    return headers;
  }

  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const separator = line.indexOf(":");
    if (separator <= 0) {
      throw new Error("ANTHROPIC_CUSTOM_HEADERS lines must use 'name: value'");
    }
    const name = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    validateHeader(name, value);
    headers[name] = value;
  }
  return headers;
}
