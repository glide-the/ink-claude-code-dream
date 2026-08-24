// [Input] Built-in resource-tool inputs and a connected clean-room MCP registry.
// [Output] Claude-compatible tool definitions and text tool results for MCP resources.
// [Pos] Adapter boundary for ListMcpResourcesTool and ReadMcpResourceTool.
// [Sync] 2026-08-24: add provider-free resource list/read built-in adapters.

import { McpRegistry } from "./registry.ts";
import type { ModelToolDefinition } from "./types.ts";

interface TextToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

function textResult(value: unknown): TextToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

export class ListMcpResourcesTool {
  private readonly registry: McpRegistry;

  readonly definition: ModelToolDefinition = {
    name: "ListMcpResourcesTool",
    description: "List resources exposed by connected MCP servers.",
    input_schema: {
      type: "object",
      properties: {
        server: { type: "string", description: "Exact MCP server name; omit for all." },
      },
      additionalProperties: false,
    },
  };

  constructor(registry: McpRegistry) {
    this.registry = registry;
  }

  call(input: { server?: string } = {}): Promise<TextToolResult> {
    return Promise.resolve(textResult({ resources: this.registry.listResources(input.server) }));
  }

  execute(input: { server?: string } = {}): Promise<TextToolResult> {
    return this.call(input);
  }
}

export class ReadMcpResourceTool {
  private readonly registry: McpRegistry;

  readonly definition: ModelToolDefinition = {
    name: "ReadMcpResourceTool",
    description: "Read a resource from one connected MCP server.",
    input_schema: {
      type: "object",
      properties: {
        server: { type: "string", description: "Exact MCP server name." },
        uri: { type: "string", description: "Resource URI returned by ListMcpResourcesTool." },
      },
      required: ["server", "uri"],
      additionalProperties: false,
    },
  };

  constructor(registry: McpRegistry) {
    this.registry = registry;
  }

  async call(input: { server: string; uri: string }): Promise<TextToolResult> {
    if (!input || typeof input.server !== "string" || typeof input.uri !== "string") {
      throw new Error("ReadMcpResourceTool requires string server and uri fields");
    }
    return textResult(await this.registry.readResource(input.server, input.uri));
  }

  execute(input: { server: string; uri: string }): Promise<TextToolResult> {
    return this.call(input);
  }
}
