// [Input] SDK initialize hooks configuration, event name, and bounded matcher subject.
// [Output] Validated immutable hook entries and deterministic callback-id selection.
// [Pos] Pure clean-room hook configuration/matching logic; callback execution lives elsewhere.
// [Sync] 2026-08-24: add restricted regex matching and stable de-duplicated callback selection.

export interface HookMatcher {
  callbackIds: readonly string[];
  matcher: string | undefined;
  timeoutMs: number | undefined;
}

export type HookConfiguration = Readonly<Record<string, readonly HookMatcher[]>>;

const EVENT_PATTERN = /^[A-Za-z][A-Za-z0-9]{0,63}$/;
const CALLBACK_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validateMatcher(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (
    typeof value !== "string" ||
    value.length > 256 ||
    value !== value.normalize("NFC") ||
    /[\0\r\n]/.test(value) ||
    /\\[1-9]|\(\?[<!=]/.test(value)
  ) {
    throw new Error("hook matcher is invalid or uses unsupported regex features");
  }
  try {
    new RegExp(value, "u");
  } catch {
    throw new Error("hook matcher is not a valid regular expression");
  }
  return value;
}

export function normalizeHookConfiguration(raw: unknown): HookConfiguration {
  if (raw === undefined || raw === null) return Object.freeze({});
  if (!isObject(raw)) throw new Error("initialize hooks must be an object or null");
  const events = Object.entries(raw);
  if (events.length > 32) throw new Error("initialize hooks exceeds the event limit");
  const normalized: Record<string, readonly HookMatcher[]> = Object.create(null) as Record<
    string,
    readonly HookMatcher[]
  >;
  for (const [event, value] of events) {
    if (!EVENT_PATTERN.test(event)) throw new Error(`invalid hook event name: ${event}`);
    if (!Array.isArray(value) || value.length > 64) {
      throw new Error(`hook event ${event} must contain at most 64 matchers`);
    }
    normalized[event] = Object.freeze(
      value.map((entry, index): HookMatcher => {
        if (!isObject(entry)) throw new Error(`hook ${event}[${index}] must be an object`);
        const keys = Object.keys(entry);
        if (keys.some((key) => !["matcher", "hookCallbackIds", "timeout"].includes(key))) {
          throw new Error(`hook ${event}[${index}] contains an unsupported key`);
        }
        if (!Array.isArray(entry.hookCallbackIds) || entry.hookCallbackIds.length > 64) {
          throw new Error(`hook ${event}[${index}] requires hookCallbackIds`);
        }
        const callbackIds = entry.hookCallbackIds.map((id) => {
          if (typeof id !== "string" || !CALLBACK_PATTERN.test(id)) {
            throw new Error(`hook ${event}[${index}] contains an invalid callback id`);
          }
          return id;
        });
        const timeout = entry.timeout;
        if (
          timeout !== undefined &&
          (typeof timeout !== "number" || !Number.isSafeInteger(timeout) || timeout <= 0 || timeout > 3_600)
        ) {
          throw new Error(`hook ${event}[${index}] timeout must be 1-3600 seconds`);
        }
        return Object.freeze({
          callbackIds: Object.freeze(callbackIds),
          matcher: validateMatcher(entry.matcher),
          timeoutMs: timeout === undefined ? undefined : timeout * 1_000,
        });
      }),
    );
  }
  return Object.freeze(normalized);
}

export function hookMatcherMatches(matcher: string | undefined, subject: string): boolean {
  if (
    typeof subject !== "string" ||
    subject.length > 256 ||
    subject !== subject.normalize("NFC") ||
    /[\0\r\n]/.test(subject)
  ) {
    throw new Error("hook matcher subject is invalid");
  }
  if (matcher === undefined) return true;
  return new RegExp(matcher, "u").test(subject);
}

export function selectHookCallbackIds(
  configuration: HookConfiguration,
  event: string,
  subject: string,
): string[] {
  if (!EVENT_PATTERN.test(event)) throw new Error("invalid hook event name");
  const selected: string[] = [];
  const seen = new Set<string>();
  for (const entry of configuration[event] ?? []) {
    if (!hookMatcherMatches(entry.matcher, subject)) continue;
    for (const callbackId of entry.callbackIds) {
      if (seen.has(callbackId)) continue;
      seen.add(callbackId);
      selected.push(callbackId);
    }
  }
  return selected;
}
