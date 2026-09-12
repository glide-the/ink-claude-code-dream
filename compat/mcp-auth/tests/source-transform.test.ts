// [Input] Authorized restored-source text, executable transform definitions, and artifact reachability profiles.
// [Output] Parser, ordering, exact-marker, virtual-import, composition, and headless-scope assertions.
// [Pos] Bun in-memory source-transform verification; it never writes to or executes restored source.

import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  applyMcpCompatibilityTransforms,
  getMcpCompatibilityTransformsForArtifact,
  MCP_COMPATIBILITY_TRANSFORMS,
  MCP_COMPATIBILITY_VIRTUAL_MODULE_IDS,
  MCP_COMPATIBILITY_VIRTUAL_MODULE_RESOLUTIONS,
  resolveMcpCompatibilityVirtualModule,
} from "../src/patch-spec.ts";

// Read canonical implementation modules, never an environment-selected second src.
const authorizedSourceRoot = resolve(import.meta.dir, "../../..");
const externalSourceTest = test;

describe("executable source transformer", () => {
  externalSourceTest("transforms every reviewed target and parses the resulting TS/TSX", async () => {
    const targetPaths = [...new Set(MCP_COMPATIBILITY_TRANSFORMS.map(transform => transform.targetPath))];
    for (const path of targetPaths) {
      const source = await readFile(resolve(authorizedSourceRoot!, path), "utf8");
      const result = applyMcpCompatibilityTransforms(path, source);
      const expectedIds = MCP_COMPATIBILITY_TRANSFORMS
        .filter(transform => transform.targetPath === path)
        .map(transform => transform.id);
      expect(result.appliedIds, path).toEqual(expectedIds);
      expect(result.assertions.every(assertion =>
        assertion.actualOccurrenceCount === assertion.occurrenceCount
      ), path).toBe(true);

      const transpiler = new Bun.Transpiler({
        loader: path.endsWith(".tsx") ? "tsx" : "ts",
        target: "bun",
      });
      expect(() => transpiler.transformSync(result.contents), path).not.toThrow();
    }
  });

  externalSourceTest("applies same-file client and print transforms in declared order", async () => {
    for (const path of ["src/services/mcp/client.ts", "src/cli/print.ts"]) {
      const source = await readFile(resolve(authorizedSourceRoot!, path), "utf8");
      const result = applyMcpCompatibilityTransforms(path, source);
      expect(result.appliedIds).toEqual(
        MCP_COMPATIBILITY_TRANSFORMS
          .filter(transform => transform.targetPath === path)
          .map(transform => transform.id),
      );
    }

    const client = applyMcpCompatibilityTransforms(
      "src/services/mcp/client.ts",
      await readFile(resolve(authorizedSourceRoot!, "src/services/mcp/client.ts"), "utf8"),
    ).contents;
    expect(client).toContain("connectWithInitializeOrdering(() => client.connect(transport))");
    expect(client).toContain("connectToServer.cache.delete(getServerCacheKey(name, serverRef))");
    expect(client).not.toContain("const connectPromise = client.connect(transport)");

    const print = applyMcpCompatibilityTransforms(
      "src/cli/print.ts",
      await readFile(resolve(authorizedSourceRoot!, "src/cli/print.ts"), "utf8"),
    ).contents;
    expect(print).toContain("sendControlResponseError(message, redactSensitiveText(errorMessage))");
    expect(print).not.toContain("const client = await connectToServer(name, scopedConfig)");
  });

  externalSourceTest("removes reviewed old markers and preserves guards before connection", async () => {
    const transformed = new Map<string, string>();
    for (const path of [
      "src/services/mcp/headersHelper.ts",
      "src/services/mcp/client.ts",
      "src/cli/print.ts",
      "src/services/mcp/useManageMCPConnections.ts",
      "src/cli/handlers/mcp.tsx",
    ]) {
      const source = await readFile(resolve(authorizedSourceRoot!, path), "utf8");
      transformed.set(path, applyMcpCompatibilityTransforms(path, source).contents);
    }

    const headers = transformed.get("src/services/mcp/headersHelper.ts")!;
    expect(headers).toContain("buildHeadersHelperLaunchPolicy({");
    expect(headers).toContain("cwd: launchPolicy.cwd");
    expect(headers).toContain("env: launchPolicy.env");
    expect(headers).not.toContain("...process.env,");
    expect(headers).not.toContain("// Security check for project/local settings");

    const client = transformed.get("src/services/mcp/client.ts")!;
    expect(client.indexOf("connectWithInitializeOrdering(() => client.connect(transport))"))
      .toBeLessThan(client.indexOf("client.getServerCapabilities()"));
    expect(client).toContain("connectToServer.cache.delete(getServerCacheKey(name, serverRef))");
    expect(client).not.toContain("const client = await connectToServer(name, config)");

    const handler = transformed.get("src/cli/handlers/mcp.tsx")!;
    expect(handler.indexOf("if (isMcpServerDisabled(name)) return '⊘ Disabled';"))
      .toBeLessThan(handler.indexOf("connectToServer(name, server)"));

    const manager = transformed.get("src/services/mcp/useManageMCPConnections.ts")!;
    expect(manager).toContain("computeReconnectBackoffMs(attempt");
    expect(manager).not.toContain("INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1)");
  });

  externalSourceTest("headless profile applies only reachable headers/client/print transforms", async () => {
    const headless = getMcpCompatibilityTransformsForArtifact("headless");
    const headlessIds = headless.map(transform => transform.id);
    expect(new Set(headless.map(transform => transform.targetPath))).toEqual(new Set([
      "src/services/mcp/headersHelper.ts",
      "src/services/mcp/client.ts",
      "src/cli/print.ts",
    ]));
    expect(headless.every(transform => transform.artifactReachability === "headless")).toBe(true);

    for (const path of [
      "src/services/mcp/headersHelper.ts",
      "src/services/mcp/client.ts",
      "src/cli/print.ts",
      "src/services/mcp/useManageMCPConnections.ts",
      "src/cli/handlers/mcp.tsx",
    ]) {
      const source = await readFile(resolve(authorizedSourceRoot!, path), "utf8");
      const result = applyMcpCompatibilityTransforms(path, source, { transformIds: headlessIds });
      if (path.includes("useManageMCPConnections") || path.includes("handlers/mcp")) {
        expect(result.appliedIds, path).toEqual([]);
        expect(result.contents, path).toBe(source);
      } else {
        expect(result.appliedIds.length, path).toBeGreaterThan(0);
      }
    }
  });

  externalSourceTest("fails closed on source drift before any replacement", async () => {
    const path = "src/services/mcp/headersHelper.ts";
    const source = await readFile(resolve(authorizedSourceRoot!, path), "utf8");
    expect(() => applyMcpCompatibilityTransforms(path, `${source}\n`)).toThrow("sha256 mismatch");
  });

  test("wires stable virtual module ids to the clean-room helper files", async () => {
    expect(MCP_COMPATIBILITY_VIRTUAL_MODULE_IDS).toEqual({
      headersPolicy: "ink:mcp-auth/headers-helper-policy",
      reconnectPolicy: "ink:mcp-auth/reconnect-policy",
      redaction: "ink:mcp-auth/redaction",
    });
    expect(resolveMcpCompatibilityVirtualModule("ink:not-registered")).toBeUndefined();
    for (const [id, path] of Object.entries(MCP_COMPATIBILITY_VIRTUAL_MODULE_RESOLUTIONS)) {
      expect(resolveMcpCompatibilityVirtualModule(id), id).toBe(path);
      expect(path.startsWith(resolve(import.meta.dir, "../src")), id).toBe(true);
      expect(await readFile(path, "utf8"), id).toContain("export function");
    }
  });
});
