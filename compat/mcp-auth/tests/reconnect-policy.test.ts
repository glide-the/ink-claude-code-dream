// [Input] Authentication, rate-limit, 5xx, timeout, and deterministic retry scenarios.
// [Output] Assertions that reconnect classification and bounded backoff match the compatibility contract.
// [Pos] Bun unit tests for clean-room MCP reconnect policy helpers.

import { describe, expect, test } from "bun:test";

import {
  ReconnectRetryExhaustedError,
  classifyReconnectFailure,
  computeReconnectBackoffMs,
  runWithReconnectRetry,
} from "../src/reconnect-policy.ts";

const policy = {
  maxAttempts: 3,
  initialDelayMs: 10,
  maxDelayMs: 20,
  multiplier: 2,
};

describe("reconnect failure classification", () => {
  test.each([401, 403])("%s is not retried", async (status) => {
    let attempts = 0;
    const original = Object.assign(new Error(`HTTP ${status}`), { status });

    await expect(runWithReconnectRetry(async () => {
      attempts += 1;
      throw original;
    }, { policy, sleep: async () => {} })).rejects.toBe(original);
    expect(attempts).toBe(1);
    expect(classifyReconnectFailure(original)).toMatchObject({
      kind: "authentication",
      retryable: false,
      httpStatus: status,
    });
  });

  test.each([
    [429, "rate-limit"],
    [500, "server"],
    [502, "server"],
    [503, "server"],
  ] as const)("%s is retried as %s", async (status, kind) => {
    let attempts = 0;
    const delays: number[] = [];

    const result = await runWithReconnectRetry(async () => {
      attempts += 1;
      if (attempts < 3) throw { response: { status }, message: `HTTP ${status}` };
      return "connected";
    }, {
      policy,
      sleep: async (delay) => { delays.push(delay); },
    });

    expect(result).toBe("connected");
    expect(attempts).toBe(3);
    expect(delays).toEqual([10, 20]);
    expect(classifyReconnectFailure({ status })).toMatchObject({ kind, retryable: true });
  });

  test.each([500, 502, 503])(
    "numeric error.code %s is classified as a retryable HTTP server failure",
    (code) => {
      expect(classifyReconnectFailure(Object.assign(new Error("remote MCP failed"), {
        code,
      }))).toEqual({
        kind: "server",
        retryable: true,
        httpStatus: code,
        code: String(code),
      });
    },
  );

  test("timeout is retried", async () => {
    let attempts = 0;
    const result = await runWithReconnectRetry(async () => {
      attempts += 1;
      if (attempts === 1) {
        throw Object.assign(new Error("connection timed out"), { code: "ETIMEDOUT" });
      }
      return "connected";
    }, { policy, sleep: async () => {} });

    expect(result).toBe("connected");
    expect(attempts).toBe(2);
  });

  test("retry budget is bounded and terminal error text is redacted", async () => {
    const secret = "token-do-not-log";
    let attempts = 0;

    try {
      await runWithReconnectRetry(async () => {
        attempts += 1;
        throw Object.assign(new Error(`access_token=${secret}`), { statusCode: 503 });
      }, { policy, sleep: async () => {} });
      throw new Error("expected retry exhaustion");
    } catch (error) {
      expect(error).toBeInstanceOf(ReconnectRetryExhaustedError);
      expect(String(error)).not.toContain(secret);
      expect((error as ReconnectRetryExhaustedError).attempts).toBe(3);
    }
    expect(attempts).toBe(3);
  });

  test("backoff caps at the configured maximum", () => {
    expect(computeReconnectBackoffMs(1, policy)).toBe(10);
    expect(computeReconnectBackoffMs(2, policy)).toBe(20);
    expect(computeReconnectBackoffMs(3, policy)).toBe(20);
  });
});

describe("SDK setMcpServers reconcile retry contract", () => {
  test("503, 503, connected succeeds through the bounded wrapper", async () => {
    const outcomes = [503, 503, "connected"] as const;
    const attempts: number[] = [];
    const result = await runWithReconnectRetry(async (attempt) => {
      attempts.push(attempt);
      const outcome = outcomes[attempt - 1];
      if (typeof outcome === "number") {
        throw Object.assign(new Error("Streamable HTTP connection failed"), {
          code: outcome,
        });
      }
      return outcome;
    }, { policy, sleep: async () => {} });

    expect(result).toBe("connected");
    expect(attempts).toEqual([1, 2, 3]);
  });

  test.each([401, 400])("numeric code %s is terminal for reconcile", async (code) => {
    let attempts = 0;
    const failure = Object.assign(new Error(`HTTP ${code}`), { code });
    await expect(runWithReconnectRetry(async () => {
      attempts += 1;
      throw failure;
    }, { policy, sleep: async () => {} })).rejects.toBe(failure);
    expect(attempts).toBe(1);
  });

  test("repeated 503 is bounded and preserves the final classification", async () => {
    let attempts = 0;
    await expect(runWithReconnectRetry(async () => {
      attempts += 1;
      throw Object.assign(new Error("temporary remote MCP failure"), { code: 503 });
    }, { policy, sleep: async () => {} })).rejects.toMatchObject({
      attempts: 3,
      classification: {
        kind: "server",
        retryable: true,
        httpStatus: 503,
        code: "503",
      },
    });
    expect(attempts).toBe(3);
  });
});
