// [Input] Unknown MCP reconnect failures plus explicit retry/backoff and clock dependencies.
// [Output] Failure classification, deterministic bounded delays, and an optional bounded retry runner.
// [Pos] Clean-room transient reconnect policy for later Runtime composition; it contains no MCP connection state machine.

import { redactSensitiveText } from "./redaction.ts";

export type ReconnectFailureKind =
  | "authentication"
  | "rate-limit"
  | "server"
  | "timeout"
  | "network"
  | "other";

export interface ReconnectFailureClassification {
  kind: ReconnectFailureKind;
  retryable: boolean;
  httpStatus?: number;
  code?: string;
}

export interface ReconnectRetryPolicy {
  /** Total attempts, including the first call. */
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  multiplier: number;
}

export interface RunWithReconnectRetryOptions {
  policy?: ReconnectRetryPolicy;
  sleep?: (delayMs: number) => Promise<void>;
  beforeRetry?: (event: {
    failedAttempt: number;
    nextAttempt: number;
    classification: ReconnectFailureClassification;
  }) => void | Promise<void>;
  onRetry?: (event: {
    failedAttempt: number;
    nextAttempt: number;
    delayMs: number;
    classification: ReconnectFailureClassification;
    safeMessage: string;
  }) => void;
}

export const DEFAULT_RECONNECT_RETRY_POLICY: Readonly<ReconnectRetryPolicy> = {
  maxAttempts: 3,
  initialDelayMs: 250,
  maxDelayMs: 2_000,
  multiplier: 2,
};

const TIMEOUT_CODES = new Set([
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
]);

const TRANSIENT_NETWORK_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "EHOSTUNREACH",
  "ENETDOWN",
  "ENETUNREACH",
  "EPIPE",
]);

export class ReconnectRetryExhaustedError extends Error {
  readonly attempts: number;
  readonly classification: ReconnectFailureClassification;

  constructor(
    attempts: number,
    classification: ReconnectFailureClassification,
    cause: unknown,
  ) {
    super(
      `MCP reconnect retry budget exhausted after ${attempts} attempts: ${safeErrorMessage(cause)}`,
      { cause },
    );
    this.name = "ReconnectRetryExhaustedError";
    this.attempts = attempts;
    this.classification = classification;
  }
}

export function classifyReconnectFailure(
  error: unknown,
): ReconnectFailureClassification {
  const httpStatus = findHttpStatus(error);
  const code = findErrorCode(error);

  if (httpStatus === 401 || httpStatus === 403) {
    return { kind: "authentication", retryable: false, httpStatus, code };
  }
  if (httpStatus === 429) {
    return { kind: "rate-limit", retryable: true, httpStatus, code };
  }
  if (httpStatus !== undefined && httpStatus >= 500 && httpStatus <= 599) {
    return { kind: "server", retryable: true, httpStatus, code };
  }
  if (isTimeoutFailure(error, code)) {
    return { kind: "timeout", retryable: true, httpStatus, code };
  }
  if (code !== undefined && TRANSIENT_NETWORK_CODES.has(code)) {
    return { kind: "network", retryable: true, httpStatus, code };
  }
  return { kind: "other", retryable: false, httpStatus, code };
}

export function computeReconnectBackoffMs(
  failedAttempt: number,
  policy: ReconnectRetryPolicy = DEFAULT_RECONNECT_RETRY_POLICY,
): number {
  validatePolicy(policy);
  if (!Number.isInteger(failedAttempt) || failedAttempt < 1) {
    throw new RangeError("failedAttempt must be a positive integer");
  }
  return Math.min(
    policy.maxDelayMs,
    Math.round(policy.initialDelayMs * policy.multiplier ** (failedAttempt - 1)),
  );
}

export async function runWithReconnectRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: RunWithReconnectRetryOptions = {},
): Promise<T> {
  const policy = options.policy ?? DEFAULT_RECONNECT_RETRY_POLICY;
  validatePolicy(policy);
  const sleep = options.sleep ?? defaultSleep;

  for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      const classification = classifyReconnectFailure(error);
      if (!classification.retryable) {
        throw error;
      }
      if (attempt === policy.maxAttempts) {
        throw new ReconnectRetryExhaustedError(attempt, classification, error);
      }

      const delayMs = computeReconnectBackoffMs(attempt, policy);
      options.onRetry?.({
        failedAttempt: attempt,
        nextAttempt: attempt + 1,
        delayMs,
        classification,
        safeMessage: safeErrorMessage(error),
      });
      await options.beforeRetry?.({
        failedAttempt: attempt,
        nextAttempt: attempt + 1,
        classification,
      });
      await sleep(delayMs);
    }
  }

  throw new Error("Unreachable reconnect retry state");
}

/**
 * Stable composition boundary used by the source transformer. Client.connect()
 * owns the MCP initialize handshake; keeping the call inside this awaited
 * boundary prevents later discovery work from being hoisted ahead of it.
 */
export function connectWithInitializeOrdering<T>(
  connect: () => Promise<T>,
): Promise<T> {
  return connect();
}

function validatePolicy(policy: ReconnectRetryPolicy): void {
  if (!Number.isInteger(policy.maxAttempts) || policy.maxAttempts < 1) {
    throw new RangeError("maxAttempts must be a positive integer");
  }
  if (!Number.isFinite(policy.initialDelayMs) || policy.initialDelayMs < 0) {
    throw new RangeError("initialDelayMs must be a non-negative finite number");
  }
  if (!Number.isFinite(policy.maxDelayMs) || policy.maxDelayMs < policy.initialDelayMs) {
    throw new RangeError("maxDelayMs must be finite and at least initialDelayMs");
  }
  if (!Number.isFinite(policy.multiplier) || policy.multiplier < 1) {
    throw new RangeError("multiplier must be a finite number of at least 1");
  }
}

function findHttpStatus(error: unknown, depth = 0): number | undefined {
  if (!isRecord(error) || depth > 3) return undefined;
  // The MCP SDK's StreamableHTTPError uses numeric `code` for the HTTP
  // status. Node network errors use string codes, so only a valid numeric or
  // three-digit string value is promoted to an HTTP status here.
  for (const candidate of [error.status, error.statusCode, error.code]) {
    const parsed = toHttpStatus(candidate);
    if (parsed !== undefined) return parsed;
  }
  const responseStatus = isRecord(error.response)
    ? toHttpStatus(error.response.status)
    : undefined;
  return responseStatus ?? findHttpStatus(error.cause, depth + 1);
}

function findErrorCode(error: unknown, depth = 0): string | undefined {
  if (!isRecord(error) || depth > 3) return undefined;
  if (typeof error.code === "string") return error.code.toUpperCase();
  if (typeof error.code === "number" && Number.isFinite(error.code)) {
    return String(error.code);
  }
  return findErrorCode(error.cause, depth + 1);
}

function isTimeoutFailure(error: unknown, code: string | undefined): boolean {
  if (code !== undefined && TIMEOUT_CODES.has(code)) return true;
  if (!isRecord(error)) return false;
  if (error.name === "TimeoutError") return true;
  return typeof error.message === "string" && /(?:timed?\s*out|timeout)/i.test(error.message);
}

function toHttpStatus(value: unknown): number | undefined {
  const parsed = typeof value === "string" && /^\d{3}$/.test(value)
    ? Number(value)
    : value;
  return typeof parsed === "number" && Number.isInteger(parsed) && parsed >= 100 && parsed <= 599
    ? parsed
    : undefined;
}

function safeErrorMessage(error: unknown): string {
  if (isRecord(error) && typeof error.message === "string") {
    return redactSensitiveText(error.message);
  }
  return redactSensitiveText(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function defaultSleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}
