#!/usr/bin/env python3
"""Deterministic MCP 2.x server for real Claude Runtime contract tests.

[Input] stdio or streamable-http transport plus an optional JSONL audit path.
[Output] One echo tool, one text resource, and ordered inbound-method receipts.
[Pos] Test-only external MCP process; no Dream or Runtime state machine is copied.
[Sync] 2026-08-24: add stdio/HTTP tool, resource, and initialize-order fixture.
"""

from __future__ import annotations

import argparse
import json
import os
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

import uvicorn
from mcp.server import MCPServer
from mcp.server.context import CallNext, HandlerResult, ServerRequestContext


def _audit_path() -> Path | None:
    raw = os.environ.get("INK_MCP_AUDIT_PATH")
    return Path(raw) if raw else None


async def audit_middleware(
    ctx: ServerRequestContext[Any, Any], call_next: CallNext
) -> HandlerResult:
    path = _audit_path()
    if path is not None:
        entry = {
            "method": ctx.method,
            "notification": ctx.request_id is None,
        }
        with path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(entry, separators=(",", ":")) + "\n")
    return await call_next(ctx)


server = MCPServer(
    "ink-runtime-contract",
    version="1.0.0",
    instructions="Deterministic tool and resource contract fixture.",
    middleware=[audit_middleware],
)


@server.tool(name="contract_echo", description="Echo one deterministic value.")
async def contract_echo(value: str) -> str:
    return f"mcp-tool:{value}"


@server.resource(
    "contract://runtime/resource",
    name="runtime-contract-resource",
    description="Deterministic resource used by Runtime compatibility tests.",
    mime_type="text/plain",
)
async def contract_resource() -> str:
    return "mcp-resource:协议✅"


class TransientHttpFailureMiddleware:
    """Inject bounded HTTP failures controlled by a test-owned JSON file."""

    def __init__(self, app: Any, control_path: Path | None) -> None:
        self.app = app
        self.control_path = control_path

    async def __call__(
        self,
        scope: dict[str, Any],
        receive: Callable[[], Awaitable[dict[str, Any]]],
        send: Callable[[dict[str, Any]], Awaitable[None]],
    ) -> None:
        if (
            self.control_path is not None
            and scope.get("type") == "http"
            and scope.get("method") == "POST"
        ):
            control = json.loads(self.control_path.read_text())
            remaining = int(control.get("remaining", 0))
            if remaining > 0:
                status = int(control.get("status", 503))
                control["remaining"] = remaining - 1
                control["failureCount"] = int(control.get("failureCount", 0)) + 1
                self.control_path.write_text(json.dumps(control) + "\n")
                if status == 401:
                    body = b'{"error":"auth","detail":"ink-mcp-test-secret-marker"}'
                else:
                    body = b'{"error":"transient-contract"}'
                await send(
                    {
                        "type": "http.response.start",
                        "status": status,
                        "headers": [
                            (b"content-type", b"application/json"),
                            (b"content-length", str(len(body)).encode()),
                            (b"retry-after", b"0"),
                        ],
                    }
                )
                await send({"type": "http.response.body", "body": body})
                return
        await self.app(scope, receive, send)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--transport", choices=("stdio", "http"), default="stdio")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=0)
    args = parser.parse_args()
    if args.transport == "stdio":
        server.run("stdio")
    else:
        if args.port <= 0:
            parser.error("--port must be positive for HTTP")
        control_raw = os.environ.get("INK_MCP_FAILURE_CONTROL")
        app = server.streamable_http_app(
            host=args.host,
            streamable_http_path="/mcp",
            stateless_http=False,
        )
        wrapped = TransientHttpFailureMiddleware(
            app, Path(control_raw) if control_raw else None
        )
        uvicorn.run(wrapped, host=args.host, port=args.port, log_level="error")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
