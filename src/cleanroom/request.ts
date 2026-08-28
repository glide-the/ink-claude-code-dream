// [Input] Runtime model, explicitly owned effort/output overrides, optional server-owned model capability, and Messages payload parts.
// [Output] One validated immutable request-parameter snapshot and the final Anthropic Messages wire object.
// [Pos] Authoritative clean-room Messages request boundary shared by every provider turn.
// [Sync] 2026-08-28: let authenticated opaque-model capability replace the unknown 32k fallback without model-ID hardcoding.

export const EFFORT_LEVELS = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export type EffortLevel = (typeof EFFORT_LEVELS)[number];

const PERSISTED_EFFORT_LEVELS = ["low", "medium", "high", "xhigh"] as const;

export interface ModelOutputTokenCapability {
  default: number;
  upperLimit: number;
}

export interface MessageRequestParameters {
  effort: EffortLevel | undefined;
  maxTokens: number;
}

interface ResolveMessageRequestParametersInput {
  cliEffort: EffortLevel | undefined;
  environment: Readonly<Record<string, string | undefined>>;
  model: string;
  settingsEffort: EffortLevel | undefined;
}

interface BuildMessageRequestInput {
  messages: unknown;
  model: string;
  outputConfig?: Readonly<Record<string, unknown>>;
  parameters: MessageRequestParameters;
  system?: string;
  tools: unknown;
}

const DEFAULT_OUTPUT_TOKENS = 32_000;
const DEFAULT_OUTPUT_TOKENS_UPPER_LIMIT = 64_000;
export const MODEL_MAX_OUTPUT_TOKENS_ENV_NAME =
  "INK_CLAUDE_CODE_MODEL_MAX_OUTPUT_TOKENS";

function isEffortLevel(value: string): value is EffortLevel {
  return (EFFORT_LEVELS as readonly string[]).includes(value);
}

export function parseEffortLevel(
  raw: unknown,
  source = "effort",
): EffortLevel | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  if (typeof raw !== "string") {
    throw new Error(`${source} must be one of: ${EFFORT_LEVELS.join(", ")}`);
  }
  const normalized = raw.toLowerCase();
  if (!isEffortLevel(normalized)) {
    throw new Error(`${source} must be one of: ${EFFORT_LEVELS.join(", ")}`);
  }
  return normalized;
}

export function parsePersistedEffortLevel(raw: unknown): EffortLevel | undefined {
  if (typeof raw !== "string") return undefined;
  const normalized = raw.toLowerCase();
  return (PERSISTED_EFFORT_LEVELS as readonly string[]).includes(normalized)
    ? normalized as EffortLevel
    : undefined;
}

function effortFromEnvironment(
  raw: string | undefined,
): EffortLevel | null | undefined {
  if (raw === undefined || raw === "") return undefined;
  const normalized = raw.toLowerCase();
  if (normalized === "unset" || normalized === "auto") return null;
  return isEffortLevel(normalized) ? normalized : undefined;
}

export function getModelOutputTokenCapability(
  model: string,
): ModelOutputTokenCapability {
  const normalized = model.toLowerCase().replaceAll(".", "-").replaceAll("_", "-");

  if (
    normalized.includes("fable-5") ||
    normalized.includes("mythos-5") ||
    normalized.includes("opus-5") ||
    normalized.includes("sonnet-5") ||
    normalized.includes("opus-4-8") ||
    normalized.includes("opus-4-7") ||
    normalized.includes("opus-4-6")
  ) {
    return { default: 64_000, upperLimit: 128_000 };
  }
  if (normalized.includes("sonnet-4-6")) {
    return { default: 32_000, upperLimit: 128_000 };
  }
  if (
    normalized.includes("opus-4-5") ||
    normalized.includes("sonnet-4") ||
    normalized.includes("haiku-4")
  ) {
    return { default: 32_000, upperLimit: 64_000 };
  }
  if (normalized.includes("opus-4-1") || normalized.includes("opus-4")) {
    return { default: 32_000, upperLimit: 32_000 };
  }
  if (normalized.includes("3-7-sonnet")) {
    return { default: 32_000, upperLimit: 64_000 };
  }
  if (normalized.includes("claude-3-opus")) {
    return { default: 4_096, upperLimit: 4_096 };
  }
  if (normalized.includes("claude-3-sonnet")) {
    return { default: 8_192, upperLimit: 8_192 };
  }
  if (normalized.includes("claude-3-haiku")) {
    return { default: 4_096, upperLimit: 4_096 };
  }
  if (normalized.includes("3-5-sonnet") || normalized.includes("3-5-haiku")) {
    return { default: 8_192, upperLimit: 8_192 };
  }
  return {
    default: DEFAULT_OUTPUT_TOKENS,
    upperLimit: DEFAULT_OUTPUT_TOKENS_UPPER_LIMIT,
  };
}

function modelOutputTokenCapabilityFromEnvironment(
  raw: string | undefined,
): ModelOutputTokenCapability | undefined {
  if (raw === undefined || raw === "") return undefined;
  if (!/^[0-9]+$/.test(raw)) {
    throw new Error(`${MODEL_MAX_OUTPUT_TOKENS_ENV_NAME} must be a positive integer`);
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${MODEL_MAX_OUTPUT_TOKENS_ENV_NAME} must be a positive integer`);
  }
  return { default: parsed, upperLimit: parsed };
}

function projectEffortForModel(
  model: string,
  effort: EffortLevel | undefined,
): EffortLevel | undefined {
  if (effort === undefined) return undefined;
  const normalized = model.toLowerCase().replaceAll(".", "-").replaceAll("_", "-");
  const supportsXhigh =
    normalized.includes("fable-5") ||
    normalized.includes("mythos-5") ||
    normalized.includes("opus-5") ||
    normalized.includes("sonnet-5") ||
    normalized.includes("opus-4-8") ||
    normalized.includes("opus-4-7");
  if (supportsXhigh) return effort;

  const supportsStandardEffort =
    normalized.includes("opus-4-6") ||
    normalized.includes("sonnet-4-6");
  if (supportsStandardEffort) return effort === "xhigh" ? "high" : effort;

  if (normalized.includes("opus-4-5")) {
    return effort === "max" || effort === "xhigh" ? "high" : effort;
  }

  if (
    normalized.includes("haiku") ||
    normalized.includes("sonnet") ||
    normalized.includes("opus") ||
    normalized.includes("fable") ||
    normalized.includes("mythos")
  ) {
    return undefined;
  }

  // First-party-compatible gateways often use opaque model aliases. Preserve
  // an explicit caller-owned value when no known capability family applies.
  return effort;
}

function boundedMaxTokens(
  raw: string | undefined,
  capability: ModelOutputTokenCapability,
): number {
  if (!raw) return capability.default;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return capability.default;
  if (parsed > capability.upperLimit) return capability.upperLimit;
  return Number.isSafeInteger(parsed) ? parsed : capability.default;
}

export function resolveMessageRequestParameters(
  input: ResolveMessageRequestParametersInput,
): MessageRequestParameters {
  const environmentEffort = effortFromEnvironment(
    input.environment.CLAUDE_CODE_EFFORT_LEVEL,
  );
  const configuredEffort = environmentEffort === null
    ? undefined
    : environmentEffort ?? input.cliEffort ?? input.settingsEffort;
  const capability = modelOutputTokenCapabilityFromEnvironment(
    input.environment[MODEL_MAX_OUTPUT_TOKENS_ENV_NAME],
  ) ?? getModelOutputTokenCapability(input.model);
  return Object.freeze({
    effort: projectEffortForModel(input.model, configuredEffort),
    maxTokens: boundedMaxTokens(
      input.environment.CLAUDE_CODE_MAX_OUTPUT_TOKENS,
      capability,
    ),
  });
}

export function buildMessageRequest(
  input: BuildMessageRequestInput,
): Record<string, unknown> {
  const outputConfig = { ...(input.outputConfig ?? {}) };
  if (input.parameters.effort !== undefined && !("effort" in outputConfig)) {
    outputConfig.effort = input.parameters.effort;
  }
  return {
    model: input.model,
    max_tokens: input.parameters.maxTokens,
    messages: input.messages,
    stream: true,
    tools: input.tools,
    ...(input.system ? { system: input.system } : {}),
    ...(Object.keys(outputConfig).length > 0 ? { output_config: outputConfig } : {}),
  };
}
