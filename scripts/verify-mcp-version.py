"""[Input] Isolated environment containing public claude-agent-sdk 0.2.144 and one expected mcp release.
[Output] Exercise real in-memory MCP initialize/ping/tools/resources/prompts/audio/structuredContent forwarding.
[Pos] Network-free matrix payload; the runner creates disposable environments and never changes Dream/SDK repos.
"""

from __future__ import annotations

from importlib.metadata import version as package_version
import json
import sys
from typing import Any

import anyio
import mcp.types
from mcp.server import Server

from claude_agent_sdk._internal._mcp_compat import MCP_MAJOR
from claude_agent_sdk._internal.sdk_mcp_bridge import SdkMcpBridge


INITIALIZE = {
    "protocolVersion": "2025-06-18",
    "capabilities": {},
    "clientInfo": {"name": "ink-runtime-matrix", "version": "0.1.2"},
}


def server() -> Server:
    instance = Server("ink-matrix", version="0.1.2")
    tools = [
        mcp.types.Tool.model_validate(
            {
                "name": "raw",
                "description": "matrix tool",
                "inputSchema": {"type": "object", "properties": {"n": {"type": "integer"}}},
            }
        )
    ]
    resources = [
        mcp.types.Resource.model_validate({"uri": "memo://readme", "name": "readme"})
    ]
    prompts = [mcp.types.Prompt.model_validate({"name": "hello", "description": "hello"})]

    @instance.list_tools()
    async def list_tools() -> list[mcp.types.Tool]:
        return tools

    @instance.call_tool()
    async def call_tool(
        name: str, arguments: dict[str, Any]
    ) -> mcp.types.CallToolResult:
        return mcp.types.CallToolResult.model_validate(
            {
                "content": [
                    {"type": "text", "text": "verbatim"},
                    {"type": "audio", "data": "UklGRg==", "mimeType": "audio/wav"},
                ],
                "structuredContent": {"tool": name, "arguments": arguments},
                "isError": False,
            }
        )

    @instance.list_resources()
    async def list_resources() -> list[mcp.types.Resource]:
        return resources

    @instance.list_prompts()
    async def list_prompts() -> list[mcp.types.Prompt]:
        return prompts

    return instance


async def exercise(expected: str) -> dict[str, object]:
    actual_sdk = package_version("claude-agent-sdk")
    actual_mcp = package_version("mcp")
    if actual_sdk != "0.2.144" or actual_mcp != expected or MCP_MAJOR != 1:
        raise AssertionError(
            f"unexpected matrix environment sdk={actual_sdk} mcp={actual_mcp} major={MCP_MAJOR}"
        )
    bridge = SdkMcpBridge("srv", server())
    next_id = 0

    async def request(method: str, params: dict[str, Any] | None = None):
        nonlocal next_id
        message: dict[str, Any] = {
            "jsonrpc": "2.0",
            "id": next_id,
            "method": method,
        }
        next_id += 1
        if params is not None:
            message["params"] = params
        response = await bridge.handle(message)
        if response is None or "error" in response:
            raise AssertionError(f"{method} failed: {response!r}")
        return response["result"]

    try:
        initialized = await request("initialize", INITIALIZE)
        await bridge.handle({"jsonrpc": "2.0", "method": "notifications/initialized"})
        ping = await request("ping")
        tools = await request("tools/list", {})
        called = await request("tools/call", {"name": "raw", "arguments": {"n": 7}})
        resources = await request("resources/list", {})
        prompts = await request("prompts/list", {})
    finally:
        await bridge.aclose()

    assert initialized["protocolVersion"] == INITIALIZE["protocolVersion"]
    assert ping == {}
    assert [item["name"] for item in tools["tools"]] == ["raw"]
    assert called["content"][1] == {
        "type": "audio",
        "data": "UklGRg==",
        "mimeType": "audio/wav",
    }
    assert called["structuredContent"] == {"tool": "raw", "arguments": {"n": 7}}
    assert [item["uri"] for item in resources["resources"]] == ["memo://readme"]
    assert [item["name"] for item in prompts["prompts"]] == ["hello"]
    return {
        "ok": True,
        "sdkVersion": actual_sdk,
        "mcpVersion": actual_mcp,
        "protocolVersion": initialized["protocolVersion"],
        "methods": ["initialize", "ping", "tools/list", "tools/call", "resources/list", "prompts/list"],
        "audio": True,
        "structuredContent": True,
    }


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: verify-mcp-version.py <expected-mcp-version>")
    print(json.dumps(anyio.run(exercise, sys.argv[1]), sort_keys=True))
