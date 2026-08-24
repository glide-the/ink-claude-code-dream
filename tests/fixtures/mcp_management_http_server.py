#!/usr/bin/env python3
"""Minimal streamable-HTTP MCP server for management-command health checks.

[Input] Explicit loopback host/port and the installed MCP Python package.
[Output] A stateless MCP initialize/ping/tool inventory endpoint at `/mcp`.
[Pos] Provider-free transport fixture; it owns no Dream, OAuth, or Agent state.
[Sync] 2026-08-24: initial HTTP health fixture for real CLI management tests.
"""

from __future__ import annotations

import argparse

from mcp.server.fastmcp import FastMCP


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", required=True, type=int)
    args = parser.parse_args()
    if args.host != "127.0.0.1" or not (0 < args.port < 65536):
        parser.error("fixture must use an explicit loopback host and valid port")

    server = FastMCP(
        "ink-mcp-management-contract",
        host=args.host,
        port=args.port,
        streamable_http_path="/mcp",
        json_response=True,
        stateless_http=True,
        log_level="ERROR",
    )

    @server.tool(name="management_contract_ping")
    async def management_contract_ping() -> str:
        """Return one deterministic health value."""

        return "management-contract-ok"

    server.run("streamable-http")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
