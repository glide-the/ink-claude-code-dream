#!/usr/bin/env python3
"""Exercise stdio/HTTP MCP tools and resources through a real Runtime.

[Input] A Claude CLI, an MCP-capable Python, and one selected MCP transport.
[Output] A JSON receipt covering handshake order, inventory, tools, resources, and toggle.
[Pos] Provider-free MCP process-boundary gate for the custom Runtime artifact.
[Sync] 2026-08-24: add real stdio/HTTP and colon-name MCP contract coverage.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
from collections.abc import Iterator
from contextlib import contextmanager, nullcontext
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from typing import Any

from claude_agent_sdk import (
    ClaudeAgentOptions,
    ClaudeSDKClient,
    PermissionResultAllow,
    ResultMessage,
    ToolPermissionContext,
)

SERVER_NAME = os.environ.get("INK_MCP_SERVER_NAME", "scope:contract")
RESOURCE_URI = "contract://runtime/resource"


@dataclass
class ProviderState:
    requests: list[dict[str, Any]] = field(default_factory=list)
    advertised_tools: set[str] = field(default_factory=set)
    forced_remote_tool_id: str | None = None


def _sse(event: str, payload: dict[str, Any]) -> bytes:
    encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    return f"event: {event}\ndata: {encoded}\n\n".encode()


def _tool_ids(payload: dict[str, Any]) -> set[str]:
    messages = payload.get("messages")
    return {
        item["id"]
        for message in messages if isinstance(messages, list) and isinstance(message, dict)
        for item in (
            message.get("content") if isinstance(message.get("content"), list) else []
        )
        if isinstance(item, dict)
        and item.get("type") == "tool_use"
        and isinstance(item.get("id"), str)
    }


def _tool_names(payload: dict[str, Any]) -> set[str]:
    tools = payload.get("tools")
    return {
        tool["name"]
        for tool in tools if isinstance(tools, list) and isinstance(tool, dict)
        if isinstance(tool.get("name"), str)
    }


def _tool_response(request_number: int, name: str, tool_id: str, data: dict[str, Any]) -> bytes:
    events = [
        _sse(
            "message_start",
            {
                "type": "message_start",
                "message": {
                    "id": f"msg_mcp_contract_{request_number}",
                    "type": "message",
                    "role": "assistant",
                    "content": [],
                    "model": "claude-contract-local",
                    "stop_reason": None,
                    "stop_sequence": None,
                    "usage": {"input_tokens": 1, "output_tokens": 0},
                },
            },
        ),
        _sse(
            "content_block_start",
            {
                "type": "content_block_start",
                "index": 0,
                "content_block": {
                    "type": "tool_use",
                    "id": tool_id,
                    "name": name,
                    "input": {},
                },
            },
        ),
        _sse(
            "content_block_delta",
            {
                "type": "content_block_delta",
                "index": 0,
                "delta": {
                    "type": "input_json_delta",
                    "partial_json": json.dumps(data, separators=(",", ":")),
                },
            },
        ),
        _sse("content_block_stop", {"type": "content_block_stop", "index": 0}),
        _sse(
            "message_delta",
            {
                "type": "message_delta",
                "delta": {"stop_reason": "tool_use", "stop_sequence": None},
                "usage": {"output_tokens": 1},
            },
        ),
        _sse("message_stop", {"type": "message_stop"}),
    ]
    return b"".join(events)


def _text_response(request_number: int) -> bytes:
    return b"".join(
        [
            _sse(
                "message_start",
                {
                    "type": "message_start",
                    "message": {
                        "id": f"msg_mcp_contract_{request_number}",
                        "type": "message",
                        "role": "assistant",
                        "content": [],
                        "model": "claude-contract-local",
                        "stop_reason": None,
                        "stop_sequence": None,
                        "usage": {"input_tokens": 1, "output_tokens": 0},
                    },
                },
            ),
            _sse(
                "content_block_start",
                {
                    "type": "content_block_start",
                    "index": 0,
                    "content_block": {"type": "text", "text": ""},
                },
            ),
            _sse(
                "content_block_delta",
                {
                    "type": "content_block_delta",
                    "index": 0,
                    "delta": {"type": "text_delta", "text": "mcp contract complete"},
                },
            ),
            _sse("content_block_stop", {"type": "content_block_stop", "index": 0}),
            _sse(
                "message_delta",
                {
                    "type": "message_delta",
                    "delta": {"stop_reason": "end_turn", "stop_sequence": None},
                    "usage": {"output_tokens": 1},
                },
            ),
            _sse("message_stop", {"type": "message_stop"}),
        ]
    )


def _handler(state: ProviderState) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, _format: str, *_args: object) -> None:
            return

        def do_POST(self) -> None:
            size = int(self.headers.get("content-length", "0"))
            body = self.rfile.read(size)
            if self.path.endswith("/count_tokens"):
                encoded = b'{"input_tokens":1}'
                content_type = "application/json"
            else:
                try:
                    payload = json.loads(body)
                except json.JSONDecodeError:
                    payload = {}
                if not isinstance(payload, dict):
                    payload = {}
                state.requests.append(payload)
                names = _tool_names(payload)
                state.advertised_tools.update(names)
                ids = _tool_ids(payload)
                remote = next((name for name in names if name.endswith("__contract_echo")), None)
                if remote is None:
                    encoded = _text_response(len(state.requests))
                elif (
                    state.forced_remote_tool_id is not None
                    and state.forced_remote_tool_id not in ids
                ):
                    encoded = _tool_response(
                        len(state.requests),
                        remote,
                        state.forced_remote_tool_id,
                        {"value": state.forced_remote_tool_id},
                    )
                elif state.forced_remote_tool_id is not None:
                    state.forced_remote_tool_id = None
                    encoded = _text_response(len(state.requests))
                elif "toolu_mcp_echo" not in ids:
                    encoded = _tool_response(
                        len(state.requests), remote, "toolu_mcp_echo", {"value": "协议✅"}
                    )
                elif "toolu_mcp_list" not in ids:
                    if "ListMcpResourcesTool" not in names:
                        raise AssertionError("ListMcpResourcesTool was not advertised")
                    encoded = _tool_response(
                        len(state.requests),
                        "ListMcpResourcesTool",
                        "toolu_mcp_list",
                        {"server": SERVER_NAME},
                    )
                elif "toolu_mcp_read" not in ids:
                    if "ReadMcpResourceTool" not in names:
                        raise AssertionError("ReadMcpResourceTool was not advertised")
                    encoded = _tool_response(
                        len(state.requests),
                        "ReadMcpResourceTool",
                        "toolu_mcp_read",
                        {"server": SERVER_NAME, "uri": RESOURCE_URI},
                    )
                else:
                    encoded = _text_response(len(state.requests))
                content_type = "text/event-stream"
            self.send_response(200)
            self.send_header("content-type", content_type)
            self.send_header("content-length", str(len(encoded)))
            self.end_headers()
            self.wfile.write(encoded)

    return Handler


@contextmanager
def local_provider() -> Iterator[tuple[ProviderState, str]]:
    state = ProviderState()
    server = ThreadingHTTPServer(("127.0.0.1", 0), _handler(state))
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield state, f"http://127.0.0.1:{server.server_port}"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _wait_port(port: int, process: subprocess.Popen[str]) -> None:
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        if process.poll() is not None:
            stdout, stderr = process.communicate()
            raise RuntimeError(f"HTTP MCP exited early\nstdout={stdout}\nstderr={stderr}")
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.2):
                return
        except OSError:
            time.sleep(0.05)
    raise TimeoutError("HTTP MCP did not bind its port")


def _write_failure_control(
    path: Path, *, status: int, remaining: int, failure_count: int = 0
) -> None:
    path.write_text(
        json.dumps(
            {
                "status": status,
                "remaining": remaining,
                "failureCount": failure_count,
            },
            separators=(",", ":"),
        )
        + "\n"
    )


@contextmanager
def http_mcp(python: Path, fixture: Path, audit: Path) -> Iterator[tuple[str, Path]]:
    port = _free_port()
    control = audit.with_name("mcp-http-failure-control.json")
    _write_failure_control(control, status=503, remaining=0)
    env = {
        **os.environ,
        "INK_MCP_AUDIT_PATH": str(audit),
        "INK_MCP_FAILURE_CONTROL": str(control),
    }
    process = subprocess.Popen(
        [str(python), str(fixture), "--transport", "http", "--port", str(port)],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        env=env,
    )
    try:
        _wait_port(port, process)
        yield f"http://127.0.0.1:{port}/mcp", control
    finally:
        process.terminate()
        try:
            process.communicate(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
            process.communicate(timeout=5)


def _runtime_env(base_url: str, config: Path, tmpdir: Path) -> dict[str, str]:
    env = {
        key: value
        for key, value in os.environ.items()
        if key not in {"ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CONFIG_DIR"}
    }
    env.update(
        {
            "ANTHROPIC_BASE_URL": base_url,
            "ANTHROPIC_AUTH_TOKEN": "mcp-contract-token-not-a-secret",
            "CLAUDE_CONFIG_DIR": str(config),
            "CLAUDE_CODE_TMPDIR": str(tmpdir),
            "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
            "DISABLE_AUTOUPDATER": "1",
        }
    )
    return env


def _audit_methods(path: Path) -> list[str]:
    return [json.loads(line)["method"] for line in path.read_text().splitlines() if line]


async def _wait_mcp_status(
    client: ClaudeSDKClient, expected: str, timeout: float = 20
) -> dict[str, Any]:
    deadline = time.monotonic() + timeout
    last: dict[str, Any] = {"mcpServers": []}
    while time.monotonic() < deadline:
        last = await client.get_mcp_status()
        matching = [
            server
            for server in last.get("mcpServers", [])
            if server.get("name") == SERVER_NAME
        ]
        if len(matching) == 1 and matching[0].get("status") == expected:
            return last
        if len(matching) == 1 and matching[0].get("status") in {"failed", "needs-auth"}:
            raise AssertionError(f"MCP entered terminal status while waiting: {matching[0]}")
        await asyncio.sleep(0.05)
    raise TimeoutError(f"MCP did not reach {expected}: {last}")


async def _wait_failure_count(path: Path, expected: int, timeout: float = 30) -> dict[str, Any]:
    deadline = time.monotonic() + timeout
    last: dict[str, Any] = {}
    while time.monotonic() < deadline:
        last = json.loads(path.read_text())
        if int(last.get("failureCount", 0)) >= expected:
            return last
        await asyncio.sleep(0.05)
    raise TimeoutError(f"HTTP MCP failure count did not reach {expected}: {last}")


async def run_contract(cli: Path, python: Path, transport: str, dream_compat: bool = False) -> dict[str, Any]:
    repo_root = Path(__file__).resolve().parents[1]
    fixture = repo_root / "tests" / "fixtures" / "mcp_contract_server.py"
    with tempfile.TemporaryDirectory(prefix=f"ink-core-mcp-{transport}-") as root_text:
        root = Path(root_text)
        workspace = root / "workspace"
        config = root / ".claude-home"
        tmpdir = workspace / ".claude-tmp"
        audit = root / "mcp-audit.jsonl"
        workspace.mkdir()
        config.mkdir(mode=0o700)
        tmpdir.mkdir(mode=0o700)
        audit.touch(mode=0o600)

        if transport == "stdio":
            mcp_config: dict[str, Any] = {
                "type": "stdio",
                "command": str(python),
                "args": [str(fixture), "--transport", "stdio"],
                "env": {"INK_MCP_AUDIT_PATH": str(audit), **({"NOTION_API_TOKEN": "mcp-overlay-fixture-not-a-secret"} if dream_compat else {})},
            }
            http_context = nullcontext(None)
        else:
            http_context = http_mcp(python, fixture, audit)

        with http_context as http_fixture:
            if transport == "http":
                if http_fixture is None:
                    raise AssertionError("HTTP MCP fixture did not start")
                http_url, failure_control = http_fixture
                mcp_config = {"type": "http", "url": http_url}
            else:
                failure_control = None
            permission_tools: list[str] = []
            runtime_stderr: list[str] = []
            http_recovery: dict[str, Any] = {"applicable": False}

            def capture_runtime_stderr(line: str) -> None:
                runtime_stderr.append(line)
                sys.stderr.write(line)

            async def allow_tool(
                tool_name: str,
                _input: dict[str, Any],
                _context: ToolPermissionContext,
            ) -> PermissionResultAllow:
                permission_tools.append(tool_name)
                return PermissionResultAllow()

            with local_provider() as (provider, base_url):
                options = ClaudeAgentOptions(
                    cli_path=str(cli),
                    cwd=str(workspace),
                    env={**_runtime_env(base_url, config, tmpdir), **({"NOTION_HOME": str(workspace / ".notion-home"), "NOTION_API_TOKEN": "mcp-parent-fixture-not-a-secret", "NOTION_KEYRING": "1", "NOTION_WORKERS_CONFIG_FILE": str(workspace / ".notion-home/workers.json")} if dream_compat else {})},
                    model="claude-contract-local",
                    can_use_tool=allow_tool,
                    permission_mode="default",
                    include_partial_messages=True,
                    max_turns=8,
                    setting_sources=[],
                    tools=[
                        f"mcp__{SERVER_NAME}__contract_echo",
                        "ListMcpResourcesTool",
                        "ReadMcpResourceTool",
                    ],
                    mcp_servers={SERVER_NAME: mcp_config},
                    stderr=capture_runtime_stderr,
                )
                async with ClaudeSDKClient(options) as client:
                    try:
                        status_before = await _wait_mcp_status(client, "connected")
                    except Exception as error:
                        raise AssertionError(
                            f"MCP startup failed: {error}; "
                            f"runtime_stderr={runtime_stderr[-20:]}"
                        ) from error
                    await client.query("Exercise the configured MCP tool and resource.")
                    messages = await asyncio.wait_for(
                        _collect_response(client), timeout=45
                    )
                    await client.toggle_mcp_server(SERVER_NAME, enabled=False)
                    status_disabled = await _wait_mcp_status(client, "disabled")
                    toggle_enable_error: str | None = None
                    try:
                        await client.toggle_mcp_server(SERVER_NAME, enabled=True)
                        status_after = await _wait_mcp_status(client, "connected")
                    except Exception as error:  # noqa: BLE001 - comparator behavior is receipted
                        toggle_enable_error = str(error)
                        status_after = status_disabled
                    if failure_control is not None:
                        _write_failure_control(
                            failure_control, status=503, remaining=1
                        )
                        provider.forced_remote_tool_id = "toolu_mcp_transient_503"
                        transient_error: str | None = None
                        transient_messages: list[Any] = []
                        try:
                            await client.query("Exercise transient MCP recovery.")
                            transient_messages = await asyncio.wait_for(
                                _collect_response(client), timeout=45
                            )
                            transient_control = await _wait_failure_count(
                                failure_control, 1, timeout=30
                            )
                            await _wait_mcp_status(client, "connected", timeout=30)
                        except Exception as error:  # noqa: BLE001 - differential receipt
                            transient_error = str(error)
                            transient_control = json.loads(failure_control.read_text())
                        if transient_control.get("failureCount") != 1:
                            raise AssertionError(
                                "HTTP MCP did not exercise the transient failure: "
                                f"{transient_control}"
                            )
                        if transient_error is not None:
                            raise AssertionError(
                                f"HTTP MCP did not recover from a 503: {transient_error}"
                            )
                        calls_before_recovery = _audit_methods(audit).count("tools/call")
                        provider.forced_remote_tool_id = "toolu_mcp_after_503"
                        await client.query("Exercise the recovered MCP session.")
                        recovered_messages = await asyncio.wait_for(
                            _collect_response(client), timeout=45
                        )
                        calls_after_recovery = _audit_methods(audit).count("tools/call")
                        if calls_after_recovery != calls_before_recovery + 1:
                            raise AssertionError(
                                "HTTP MCP session did not accept a tool call after a 503"
                            )

                        _write_failure_control(
                            failure_control, status=401, remaining=20
                        )
                        provider.forced_remote_tool_id = "toolu_mcp_auth_401"
                        auth_error: str | None = None
                        auth_messages: list[Any] = []
                        try:
                            await client.query("Exercise terminal MCP authentication failure.")
                            auth_messages = await asyncio.wait_for(
                                _collect_response(client), timeout=45
                            )
                        except Exception as error:  # noqa: BLE001 - comparator behavior
                            auth_error = str(error)
                        await asyncio.sleep(0.5)
                        auth_status_payload = await client.get_mcp_status()
                        matching_auth_status = [
                            server
                            for server in auth_status_payload.get("mcpServers", [])
                            if server.get("name") == SERVER_NAME
                        ]
                        if len(matching_auth_status) != 1:
                            raise AssertionError(
                                "HTTP MCP auth failure lost server inventory identity"
                            )
                        auth_status = matching_auth_status[0]
                        auth_control = json.loads(failure_control.read_text())
                        if int(auth_control.get("failureCount", 0)) < 1:
                            raise AssertionError("HTTP MCP did not exercise the 401 response")
                        surfaced = json.dumps(
                            {"error": auth_error, "status": auth_status},
                            ensure_ascii=False,
                        )
                        if "ink-mcp-test-secret-marker" in surfaced:
                            raise AssertionError("HTTP MCP leaked an authentication marker")
                        _write_failure_control(
                            failure_control, status=503, remaining=0
                        )
                        await asyncio.wait_for(
                            client.reconnect_mcp_server(SERVER_NAME), timeout=30
                        )
                        await _wait_mcp_status(client, "connected", timeout=30)
                        http_recovery = {
                            "applicable": True,
                            "transient503FailureCount": transient_control["failureCount"],
                            "transient503Recovered": True,
                            "transient503ResultSeen": any(
                                isinstance(message, ResultMessage)
                                for message in transient_messages
                            ),
                            "post503ToolCallSucceeded": any(
                                isinstance(message, ResultMessage)
                                and not message.is_error
                                for message in recovered_messages
                            ),
                            "auth401FailureCount": auth_control["failureCount"],
                            "auth401ObservedStatus": auth_status.get("status"),
                            "auth401ReconnectErrorPresent": auth_error is not None,
                            "auth401ErrorWasSanitized": True,
                            "auth401ResultSeen": any(
                                isinstance(message, ResultMessage)
                                for message in auth_messages
                            ),
                            "recoveredAfterAuthFailure": True,
                        }

        results = [message for message in messages if isinstance(message, ResultMessage)]
        if len(results) != 1 or results[0].is_error:
            raise AssertionError("MCP query did not end successfully")
        methods = _audit_methods(audit)
        if not methods or methods[0] != "initialize":
            raise AssertionError(
                f"first MCP method was not initialize: {methods[:3]}; "
                f"status={status_before}; advertised={sorted(provider.advertised_tools)}"
            )
        if "server/discover" in methods[: methods.index("initialize") + 1]:
            raise AssertionError("server/discover ran before initialize")
        for required in ("tools/list", "tools/call", "resources/list", "resources/read"):
            if required not in methods:
                raise AssertionError(
                    f"MCP method was not exercised: {required}; "
                    f"advertised={sorted(provider.advertised_tools)}; methods={methods}"
                )

        def one_status(payload: dict[str, Any]) -> dict[str, Any]:
            servers = payload.get("mcpServers", [])
            matching = [server for server in servers if server.get("name") == SERVER_NAME]
            if len(matching) != 1:
                raise AssertionError("colon-bearing MCP server identity was not preserved")
            return matching[0]

        before = one_status(status_before)
        disabled = one_status(status_disabled)
        after = one_status(status_after)
        if before.get("status") != "connected":
            raise AssertionError(f"MCP server was not initially connected: {before}")
        if toggle_enable_error is None and after.get("status") != "connected":
            raise AssertionError("MCP server did not reconnect after toggle")
        if disabled.get("status") != "disabled":
            raise AssertionError("MCP server did not enter disabled inventory state")

        if dream_compat:
            if transport != "stdio" or any(json.loads(line).get("notionPresent") is not False for line in audit.read_text().splitlines() if line):
                raise AssertionError("Notion parent/explicit server credentials reached stdio MCP")
        return {
            **({"notionStdioExcluded": True} if dream_compat else {}),
            "contractVersion": 1,
            "transport": transport,
            "serverName": SERVER_NAME,
            "initializeFirst": True,
            "methods": methods,
            "inventory": {
                "connectedBefore": True,
                "disabledWithoutIdentityLoss": True,
                "connectedAfter": toggle_enable_error is None,
                "enableError": toggle_enable_error,
                "toolsReported": sorted(
                    tool.get("name", "") for tool in before.get("tools", [])
                ),
            },
            "providerTools": sorted(provider.advertised_tools),
            "permissionTools": permission_tools,
            "toolCall": True,
            "resourcesListRead": True,
            "resultSession": bool(results[0].session_id),
            "httpRecovery": http_recovery,
        }


async def _collect_response(client: ClaudeSDKClient) -> list[Any]:
    return [message async for message in client.receive_response()]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cli", type=Path, required=True)
    parser.add_argument("--python", type=Path, required=True)
    parser.add_argument("--transport", choices=("stdio", "http"), required=True)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--dream-compat", action="store_true")
    args = parser.parse_args()
    receipt = asyncio.run(
        run_contract(args.cli.resolve(), args.python.absolute(), args.transport, args.dream_compat)
    )
    encoded = json.dumps(receipt, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    if args.output:
        args.output.write_text(encoded)
    print(encoded, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
