// [Input] Potentially sensitive text, headers, and environment mappings supplied by compatibility callers.
// [Output] Redacted copies and a conservative credential-environment name classifier.
// [Pos] Shared log-safety primitive for MCP compatibility policies; it never stores or transforms credentials for use.

const SENSITIVE_HEADER_NAME = /(?:^|[-_])(?:authorization|cookie|token|secret|api[-_]?key)(?:$|[-_])/i;
const SENSITIVE_ENV_NAME = /(?:^|_)(?:TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|APIKEY|PRIVATE_KEY|ACCESS_KEY|AUTH|AUTHORIZATION|CREDENTIAL|COOKIE)(?:_|$)/i;

const QUERY_SECRET = /([?&](?:access_token|refresh_token|id_token|token|code|state|code_verifier|code_challenge|client_secret|api_key)=)[^&#\s]*/gi;
const ASSIGNMENT_SECRET = /\b((?:access[_-]?token|refresh[_-]?token|id[_-]?token|token|authorization|client[_-]?secret|api[_-]?key|password|passwd)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^,;\s}]+)/gi;
const BEARER_SECRET = /\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi;

export const REDACTED = "[REDACTED]";

export function isCredentialEnvironmentName(name: string): boolean {
  return SENSITIVE_ENV_NAME.test(name);
}
export function redactSensitiveText(value: unknown): string {
  return String(value)
    .replace(QUERY_SECRET, `$1${REDACTED}`)
    .replace(ASSIGNMENT_SECRET, `$1${REDACTED}`)
    .replace(BEARER_SECRET, `$1${REDACTED}`);
}

export function redactHeaders(
  headers: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [
      name,
      SENSITIVE_HEADER_NAME.test(name) ? REDACTED : redactHeaderValue(value),
    ]),
  );
}

export function redactEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(environment)
      .filter((entry): entry is [string, string] => entry[1] !== undefined)
      .map(([name, value]) => [
        name,
        isCredentialEnvironmentName(name) ? REDACTED : redactSensitiveText(value),
      ]),
  );
}

function redactHeaderValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactSensitiveText);
  }
  if (typeof value === "string") {
    return redactSensitiveText(value);
  }
  return value;
}
