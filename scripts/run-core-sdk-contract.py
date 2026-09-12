#!/usr/bin/env python3
"""Run the unmodified Python SDK against a real Claude Runtime executable.

[Input] A Claude CLI path and the source-only Ink SDK available on sys.path.
[Output] A JSON receipt for stream-json, permission, tool, interrupt, and resume.
[Pos] Provider-free process-boundary contract gate for a locally built core.
[Sync] 2026-08-30: make the official nested-Docker comparator skip only its
                   unpatchable embedded Unix-socket filter and retain bounded Bash diagnostics.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import shlex
import subprocess
import tempfile
import time
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Event, Thread
from typing import Any

from claude_agent_sdk import (
    AgentDefinition,
    AssistantMessage,
    ClaudeAgentOptions,
    ClaudeSDKClient,
    HookMatcher,
    PermissionResultAllow,
    ResultMessage,
    StreamEvent,
    SystemMessage,
    ToolPermissionContext,
    ToolUseBlock,
)


@dataclass
class ProviderState:
    """Observable facts from the deterministic local Anthropic endpoint."""

    requests: list[dict[str, Any]] = field(default_factory=list)
    tool_result_seen: bool = False
    bash_result_content: str = ""
    skill_result_seen: bool = False
    plugin_skill_result_seen: bool = False
    agent_result_seen: bool = False
    agent_prompt_seen: bool = False
    agent_result_content: str = ""
    bash_command: str = ""
    slow_stream_started: Event = field(default_factory=Event)


def _sse(event: str, payload: dict[str, Any]) -> bytes:
    encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    return f"event: {event}\ndata: {encoded}\n\n".encode()


def _message_events(
    *,
    request_number: int,
    tool_name: str | None,
    tool_id: str | None,
    tool_input: dict[str, Any] | None,
    slow: bool,
) -> bytes:
    message_id = f"msg_contract_{request_number}"
    events = [
        _sse(
            "message_start",
            {
                "type": "message_start",
                "message": {
                    "id": message_id,
                    "type": "message",
                    "role": "assistant",
                    "content": [],
                    "model": "claude-contract-local",
                    "stop_reason": None,
                    "stop_sequence": None,
                    "usage": {"input_tokens": 1, "output_tokens": 0},
                },
            },
        )
    ]
    if tool_name and tool_id and tool_input is not None:
        events.extend(
            [
                _sse(
                    "content_block_start",
                    {
                        "type": "content_block_start",
                        "index": 0,
                        "content_block": {
                            "type": "tool_use",
                            "id": tool_id,
                            "name": tool_name,
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
                            "partial_json": json.dumps(tool_input),
                        },
                    },
                ),
                _sse(
                    "content_block_stop",
                    {"type": "content_block_stop", "index": 0},
                ),
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
        )
        return b"".join(events)

    events.append(
        _sse(
            "content_block_start",
            {
                "type": "content_block_start",
                "index": 0,
                "content_block": {"type": "text", "text": ""},
            },
        )
    )
    if slow:
        events.append(
            _sse(
                "content_block_delta",
                {
                    "type": "content_block_delta",
                    "index": 0,
                    "delta": {"type": "text_delta", "text": "interrupt-started"},
                },
            )
        )
        return b"".join(events)
    for text in ("runtime ", "协议✅"):
        events.append(
            _sse(
                "content_block_delta",
                {
                    "type": "content_block_delta",
                    "index": 0,
                    "delta": {"type": "text_delta", "text": text},
                },
            )
        )
    events.extend(
        [
            _sse(
                "content_block_stop",
                {"type": "content_block_stop", "index": 0},
            ),
            _sse(
                "message_delta",
                {
                    "type": "message_delta",
                    "delta": {"stop_reason": "end_turn", "stop_sequence": None},
                    "usage": {"output_tokens": 2},
                },
            ),
            _sse("message_stop", {"type": "message_stop"}),
        ]
    )
    return b"".join(events)


def _latest_user_text(payload: dict[str, Any]) -> str:
    messages = payload.get("messages")
    if not isinstance(messages, list):
        return ""
    for message in reversed(messages):
        if not isinstance(message, dict) or message.get("role") != "user":
            continue
        content = message.get("content")
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            return " ".join(
                item.get("text", "")
                for item in content
                if isinstance(item, dict) and item.get("type") == "text"
            )
    return ""


def _has_tool_result(payload: dict[str, Any]) -> bool:
    messages = payload.get("messages")
    return any(
        isinstance(item, dict) and item.get("type") == "tool_result"
        for message in messages if isinstance(messages, list) and isinstance(message, dict)
        for item in (
            message.get("content") if isinstance(message.get("content"), list) else []
        )
    )


def _tool_result_ids(payload: dict[str, Any]) -> set[str]:
    messages = payload.get("messages")
    return {
        item["tool_use_id"]
        for message in messages
        if isinstance(messages, list) and isinstance(message, dict)
        for item in (
            message.get("content") if isinstance(message.get("content"), list) else []
        )
        if isinstance(item, dict)
        and item.get("type") == "tool_result"
        and isinstance(item.get("tool_use_id"), str)
    }


def _tool_result_content(payload: dict[str, Any], tool_use_id: str) -> str:
    messages = payload.get("messages")
    for message in messages if isinstance(messages, list) else []:
        if not isinstance(message, dict):
            continue
        content = message.get("content")
        for item in content if isinstance(content, list) else []:
            if (
                isinstance(item, dict)
                and item.get("type") == "tool_result"
                and item.get("tool_use_id") == tool_use_id
            ):
                return str(item.get("content", ""))[:2000]
    return ""


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
                self.send_response(200)
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(encoded)))
                self.end_headers()
                self.wfile.write(encoded)
                return
            try:
                payload = json.loads(body)
            except json.JSONDecodeError:
                payload = {}
            if not isinstance(payload, dict):
                payload = {}
            state.requests.append(payload)
            result_ids = _tool_result_ids(payload)
            state.tool_result_seen = (
                state.tool_result_seen or "toolu_runtime_contract" in result_ids
            )
            if "toolu_runtime_contract" in result_ids:
                state.bash_result_content = _tool_result_content(
                    payload, "toolu_runtime_contract"
                )
            state.skill_result_seen = (
                state.skill_result_seen or "toolu_runtime_skill" in result_ids
            )
            state.plugin_skill_result_seen = (
                state.plugin_skill_result_seen
                or "toolu_runtime_plugin_skill" in result_ids
            )
            latest = _latest_user_text(payload)
            if "SUBAGENT_CONTRACT" in latest:
                state.agent_prompt_seen = True
                encoded = _message_events(
                    request_number=len(state.requests),
                    tool_name=None,
                    tool_id=None,
                    tool_input=None,
                    slow=False,
                )
                self.send_response(200)
                self.send_header("content-type", "text/event-stream")
                self.send_header("content-length", str(len(encoded)))
                self.end_headers()
                self.wfile.write(encoded)
                return
            state.agent_result_seen = (
                state.agent_result_seen or "toolu_runtime_agent" in result_ids
            )
            if "toolu_runtime_agent" in result_ids:
                state.agent_result_content = _tool_result_content(
                    payload, "toolu_runtime_agent"
                )
            slow = "WAIT_FOR_INTERRUPT" in latest
            tools = payload.get("tools")
            tool_names = {
                tool["name"]
                for tool in tools
                if isinstance(tools, list) and isinstance(tool, dict)
                if isinstance(tool.get("name"), str)
            }
            if "toolu_runtime_contract" not in result_ids and not state.tool_result_seen:
                tool_name, tool_id, tool_input = (
                    "Bash",
                    "toolu_runtime_contract",
                    {"command": state.bash_command},
                )
            elif not state.skill_result_seen and "Skill" in tool_names:
                tool_name, tool_id, tool_input = (
                    "Skill",
                    "toolu_runtime_skill",
                    {"skill": "runtime-contract", "args": "provider-free"},
                )
            elif not state.plugin_skill_result_seen and "Skill" in tool_names:
                tool_name, tool_id, tool_input = (
                    "Skill",
                    "toolu_runtime_plugin_skill",
                    {
                        "skill": "runtime-contract-plugin:plugin-contract",
                        "args": "provider-free",
                    },
                )
            elif not state.agent_result_seen and "Agent" in tool_names:
                tool_name, tool_id, tool_input = (
                    "Agent",
                    "toolu_runtime_agent",
                    {
                        "description": "Run deterministic subagent contract",
                        "prompt": "SUBAGENT_CONTRACT return the exact marker subagent-ok.",
                        "subagent_type": "contract-agent",
                    },
                )
            else:
                tool_name = tool_id = tool_input = None
            encoded = _message_events(
                request_number=len(state.requests),
                tool_name=tool_name,
                tool_id=tool_id,
                tool_input=tool_input,
                slow=slow,
            )
            self.send_response(200)
            self.send_header("content-type", "text/event-stream")
            if slow:
                self.send_header("cache-control", "no-cache")
                self.end_headers()
                self.wfile.write(encoded)
                self.wfile.flush()
                state.slow_stream_started.set()
                time.sleep(3)
                return
            self.send_header("content-length", str(len(encoded)))
            self.end_headers()
            # Deliberately split a UTF-8 sequence across writes when present.
            split = encoded.find("协".encode()) + 1
            if split > 0:
                self.wfile.write(encoded[:split])
                self.wfile.flush()
                self.wfile.write(encoded[split:])
            else:
                self.wfile.write(encoded)

    return Handler


@contextmanager
def local_provider(bash_command: str) -> Iterator[tuple[ProviderState, str]]:
    state = ProviderState(bash_command=bash_command)
    server = ThreadingHTTPServer(("127.0.0.1", 0), _handler(state))
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield state, f"http://127.0.0.1:{server.server_port}"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def _safe_env(base_url: str, config_dir: Path, tmpdir: Path) -> dict[str, str]:
    env = {
        key: value
        for key, value in os.environ.items()
        if key not in {"ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CONFIG_DIR"}
    }
    env.update(
        {
            "ANTHROPIC_BASE_URL": base_url,
            "ANTHROPIC_AUTH_TOKEN": "runtime-contract-token-not-a-secret",
            "CLAUDE_CONFIG_DIR": str(config_dir),
            "CLAUDE_CODE_TMPDIR": str(tmpdir),
            "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
            "DISABLE_AUTOUPDATER": "1",
        }
    )
    return env


async def _collect(client: ClaudeSDKClient) -> list[Any]:
    return [message async for message in client.receive_response()]


async def run_contract(cli: Path, dream_compat: bool = False) -> dict[str, Any]:
    if not cli.is_absolute() or not cli.is_file():
        raise ValueError("--cli must be an existing absolute file")

    with tempfile.TemporaryDirectory(prefix="ink-core-sdk-contract-") as root_text:
        root = Path(root_text).resolve()
        workspace = root / "workspace"
        config_dir = root / ".claude-home"
        tmpdir = workspace / ".claude-tmp"
        workspace.mkdir()
        config_dir.mkdir(mode=0o700)
        tmpdir.mkdir(mode=0o700)
        permission_calls: list[dict[str, Any]] = []
        hook_calls: list[dict[str, Any]] = []
        stderr_lines: list[str] = []

        credential_file = config_dir / ".credentials.json"
        credential_file.write_text("{}\n")

        skill_dir = workspace / ".claude" / "skills" / "runtime-contract"
        skill_dir.mkdir(parents=True)
        (skill_dir / "SKILL.md").write_text(
            "---\nname: runtime-contract\ndescription: Provider-free Runtime skill contract.\n"
            "---\nReturn the exact marker runtime-skill-contract.\n"
        )
        plugin_root = root / "runtime-contract-plugin"
        plugin_manifest = plugin_root / ".claude-plugin" / "plugin.json"
        plugin_manifest.parent.mkdir(parents=True)
        plugin_manifest.write_text(
            json.dumps(
                {
                    "name": "runtime-contract-plugin",
                    "version": "1.0.0",
                    "description": "Provider-free local plugin contract.",
                }
            )
            + "\n"
        )
        plugin_skill = plugin_root / "skills" / "plugin-contract" / "SKILL.md"
        plugin_skill.parent.mkdir(parents=True)
        plugin_skill.write_text(
            "---\nname: plugin-contract\ndescription: Local plugin skill contract.\n"
            "---\nReturn the exact marker runtime-plugin-skill-contract.\n"
        )
        sandbox_boundary = workspace / "sandbox-boundary.txt"
        bash_command = (
            "printf 'runtime-contract-ok\\n' > sdk-contract.txt; "
            f"if cat {shlex.quote(str(credential_file))} >/dev/null 2>&1; then "
            "printf 'credential-readable\\n' > sandbox-boundary.txt; exit 91; "
            "else printf 'credential-denied\\n' > sandbox-boundary.txt; fi; "
            "cat sdk-contract.txt"
        )
        dream_environment: dict[str, str] = {}
        command_hooks: dict[str, Any] = {}
        if dream_compat:
            native_bin = root / "native-bin"
            native_bin.mkdir()
            native_ntn = native_bin / "ntn"
            subprocess.run(
                ["cc", str(Path(__file__).resolve().parents[1] / "tests/fixtures/notion_env_native.c"), "-o", str(native_ntn)],
                check=True, capture_output=True, text=True, timeout=30,
            )
            native_ntn.chmod(0o755)
            notion_home = workspace / ".notion-home"
            notion_home.mkdir(mode=0o700)
            workers = notion_home / "workers.json"
            workers.write_text("{}\n")
            workers.chmod(0o600)
            dream_environment = {
                "PATH": str(native_bin) + os.pathsep + os.environ.get("PATH", ""),
                "NOTION_HOME": str(notion_home),
                "NOTION_API_TOKEN": "notion-process-fixture-not-a-secret",
                "NOTION_KEYRING": "1",
                "NOTION_WORKERS_CONFIG_FILE": str(workers),
                "INK_CLAUDE_CODE_MODEL_MAX_OUTPUT_TOKENS": "1000",
                "CLAUDE_CODE_MAX_CONTEXT_TOKENS": "128000",
                "CLAUDE_CODE_EFFORT_LEVEL": "xhigh",
            }
            bash_command = "ntn > notion-bash.json; " + bash_command
            command_hooks = {"hooks": {"SessionStart": [{"hooks": [{"type": "command", "command": "ntn > " + shlex.quote(str(workspace / "notion-hook.json"))}]}]}}
        settings_path = workspace / ".claude" / "settings.json"
        reference_allows_unix_sockets = (
            os.environ.get("INK_CORE_REFERENCE_ALLOW_ALL_UNIX_SOCKETS") == "1"
        )
        settings_path.write_text(
            json.dumps(
                {
                    **command_hooks,
                    "sandbox": {
                        "enabled": True,
                        "failIfUnavailable": True,
                        "autoAllowBashIfSandboxed": False,
                        "allowUnsandboxedCommands": False,
                        "filesystem": {
                            "denyRead": [str(credential_file)],
                            "allowRead": [str(workspace)],
                            "allowWrite": [str(workspace), str(tmpdir)],
                            "denyWrite": [str(credential_file), str(settings_path)],
                        },
                        "credentials": {
                            "files": [{"path": str(credential_file), "mode": "deny"}]
                        },
                        **(
                            {"network": {"allowAllUnixSockets": True}}
                            if reference_allows_unix_sockets
                            else {}
                        ),
                    }
                }
            )
            + "\n"
        )

        async def allow_tool(
            tool_name: str,
            input_data: dict[str, Any],
            context: ToolPermissionContext,
        ) -> PermissionResultAllow:
            permission_calls.append(
                {
                    "tool": tool_name,
                    "has_tool_use_id": bool(context.tool_use_id),
                    "input_keys": sorted(input_data),
                }
            )
            return PermissionResultAllow()

        async def pre_tool_hook(
            hook_input: dict[str, Any],
            tool_use_id: str | None,
            _context: dict[str, Any],
        ) -> dict[str, Any]:
            hook_calls.append(
                {
                    "hookEventName": hook_input.get("hook_event_name"),
                    "toolName": hook_input.get("tool_name"),
                    "hasToolUseId": bool(tool_use_id),
                }
            )
            return {}

        with local_provider(bash_command) as (provider, base_url):
            common = {
                "cli_path": str(cli),
                "cwd": str(workspace),
                "env": {**_safe_env(base_url, config_dir, tmpdir), **dream_environment},
                "model": "claude-contract-local",
                "can_use_tool": allow_tool,
                "permission_mode": "default",
                "include_partial_messages": True,
                "max_turns": 7,
                "setting_sources": ["project"],
                "skills": [
                    "runtime-contract",
                    "runtime-contract-plugin:plugin-contract",
                ],
                "plugins": [{"type": "local", "path": str(plugin_root)}],
                "agents": {
                    "contract-agent": AgentDefinition(
                        description="Provider-free subagent contract.",
                        prompt="Return the exact marker subagent-ok.",
                        tools=[],
                        maxTurns=1,
                    )
                },
                "hooks": {
                    "PreToolUse": [
                        HookMatcher(matcher="Bash", hooks=[pre_tool_hook])
                    ]
                },
                "stderr": stderr_lines.append,
            }
            options = ClaudeAgentOptions(**common)
            first_messages: list[Any]
            second_messages: list[Any]
            interrupted_messages: list[Any] = []
            async with ClaudeSDKClient(options) as client:
                await client.query("Run the deterministic SDK contract tool.")
                first_messages = await asyncio.wait_for(_collect(client), timeout=30)
                if not provider.requests:
                    result_shapes = [
                        {
                            "type": type(message).__name__,
                            "is_error": getattr(message, "is_error", None),
                            "subtype": getattr(message, "subtype", None),
                            "result": str(getattr(message, "result", ""))[:1000],
                            "errors": getattr(message, "errors", None),
                            "stop_reason": getattr(message, "stop_reason", None),
                            "num_turns": getattr(message, "num_turns", None),
                        }
                        for message in first_messages
                    ]
                    raise AssertionError(
                        "first SDK query did not reach the provider; "
                        f"messages={result_shapes!r}; "
                        f"stderr={''.join(stderr_lines[-20:])[-4000:]!r}"
                    )
                server_info = await client.get_server_info()
                await client.query("Return the deterministic Unicode response.")
                second_messages = await asyncio.wait_for(_collect(client), timeout=30)

                await client.query("WAIT_FOR_INTERRUPT")
                collector = asyncio.create_task(_collect(client))
                started = await asyncio.to_thread(provider.slow_stream_started.wait, 10)
                if not started:
                    collector.cancel()
                    await asyncio.gather(collector, return_exceptions=True)
                    raise AssertionError(
                        "provider did not start the interrupt stream; "
                        f"request_count={len(provider.requests)}"
                    )
                interrupt_started = time.monotonic()
                await client.interrupt()
                try:
                    interrupted_messages = await asyncio.wait_for(collector, timeout=15)
                except TimeoutError:
                    collector.cancel()
                    await asyncio.gather(collector, return_exceptions=True)
                    raise AssertionError("interrupt did not terminate the active response") from None
                interrupt_elapsed = time.monotonic() - interrupt_started
                if interrupt_elapsed >= 2.5:
                    raise AssertionError("interrupt did not beat the provider's 3 second delay")

            results = [
                message
                for message in first_messages + second_messages
                if isinstance(message, ResultMessage)
            ]
            if len(results) != 2 or any(result.is_error for result in results):
                raise AssertionError("new-session responses did not end successfully")
            session_id = results[0].session_id
            if not session_id or any(result.session_id != session_id for result in results):
                raise AssertionError("session ID was not stable across turns")
            output_file = workspace / "sdk-contract.txt"
            if not output_file.is_file():
                raise AssertionError(
                    "Bash tool did not create the workspace receipt; "
                    f"tool_result={provider.bash_result_content[-2000:]!r}; "
                    f"stderr={''.join(stderr_lines[-20:])[-4000:]!r}"
                )
            if output_file.read_text() != "runtime-contract-ok\n":
                raise AssertionError("Bash tool did not execute in the workspace")
            if sandbox_boundary.read_text() != "credential-denied\n":
                raise AssertionError("sandboxed Bash could read the credential file")
            if not provider.tool_result_seen:
                raise AssertionError("tool_result did not return to the provider")
            if not provider.skill_result_seen:
                raise AssertionError("Skill tool result did not return to the provider")
            if not provider.plugin_skill_result_seen:
                raise AssertionError("local plugin Skill result did not return to the provider")
            if not provider.agent_result_seen or not provider.agent_prompt_seen:
                raise AssertionError(
                    "programmatic subagent did not complete its real model turn; "
                    f"result_seen={provider.agent_result_seen!r} "
                    f"prompt_seen={provider.agent_prompt_seen!r} "
                    f"result_content={provider.agent_result_content!r} "
                    f"request_count={len(provider.requests)}"
                )
            if not permission_calls or permission_calls[0]["tool"] != "Bash":
                raise AssertionError("can_use_tool was not called for Bash")
            if not hook_calls or hook_calls[0]["toolName"] != "Bash":
                raise AssertionError("PreToolUse hook was not called for Bash")

            resume_options = ClaudeAgentOptions(**common, resume=session_id)
            async with ClaudeSDKClient(resume_options) as resumed:
                await resumed.query("Confirm resumed context.")
                resume_messages = await asyncio.wait_for(_collect(resumed), timeout=30)
            resume_results = [
                message for message in resume_messages if isinstance(message, ResultMessage)
            ]
            if len(resume_results) != 1 or resume_results[0].is_error:
                raise AssertionError("resume response did not end successfully")
            if resume_results[0].session_id != session_id:
                raise AssertionError("resume changed the Claude session ID")

            transcripts = list(config_dir.rglob(f"{session_id}.jsonl"))
            if len(transcripts) != 1 or transcripts[0].stat().st_size == 0:
                raise AssertionError("one non-empty session transcript was not written")
            if (tmpdir.stat().st_mode & 0o777) != 0o700:
                raise AssertionError("CLAUDE_CODE_TMPDIR mode changed from 0700")

            all_messages = first_messages + second_messages + resume_messages
            text = "".join(
                block.text
                for message in all_messages
                if isinstance(message, AssistantMessage)
                for block in message.content
                if hasattr(block, "text")
            )
            interrupt_results = [
                message for message in interrupted_messages if isinstance(message, ResultMessage)
            ]
            dream_facts = None
            if dream_compat:
                bash_facts = json.loads((workspace / "notion-bash.json").read_text())
                hook_facts = json.loads((workspace / "notion-hook.json").read_text())
                if bash_facts != {"home": True, "token": True, "workers": True, "keyringDisabled": True}:
                    raise AssertionError(f"Notion native Bash projection failed: {bash_facts}")
                if any(hook_facts.values()):
                    raise AssertionError("Notion credentials reached a generic command hook")
                request = provider.requests[0]
                if request.get("max_tokens") != 1000 or request.get("output_config", {}).get("effort") != "xhigh":
                    raise AssertionError("Explicit Dream max-output/effort did not reach the provider request")
                dream_facts = {"notionNativeBash": True, "notionHookExcluded": True, "explicitMaxOutput": 1000, "explicitEffort": "xhigh", "modelId": "claude-contract-local", "contextCarrier": 128000}
            return {
                **({"dreamCompatibility": dream_facts} if dream_facts is not None else {}),
                "contractVersion": 1,
                "cliVersion": _cli_version(cli),
                "initialize": {
                    "systemInitSeen": any(
                        isinstance(message, SystemMessage) and message.subtype == "init"
                        for message in first_messages
                    ),
                    "serverInfoIsObject": isinstance(server_info, dict),
                },
                "stream": {
                    "partialSeen": any(
                        isinstance(message, StreamEvent) for message in all_messages
                    ),
                    "unicodeComplete": "runtime 协议✅" in text,
                },
                "tools": {
                    "toolUseSeen": any(
                        isinstance(message, AssistantMessage)
                        and any(isinstance(block, ToolUseBlock) for block in message.content)
                        for message in first_messages
                    ),
                    "permissionCallback": permission_calls[0],
                    "toolResultReturned": provider.tool_result_seen,
                    "workspaceWrite": True,
                },
                "extensions": {
                    "localPluginSkillInvoked": provider.plugin_skill_result_seen,
                    "projectSkillInvoked": provider.skill_result_seen,
                    "subagentInvoked": provider.agent_result_seen,
                    "preToolUseHook": hook_calls[0],
                },
                "session": {
                    "stableAcrossTurns": True,
                    "resumeStable": True,
                    "transcriptWritten": True,
                },
                "interrupt": {
                    "completedWithinProviderDelay": True,
                    "resultSeen": bool(interrupt_results),
                    "terminalReason": (
                        interrupt_results[-1].terminal_reason if interrupt_results else None
                    ),
                },
                "runtime": {
                    "sandboxCredentialReadDenied": True,
                    "tmpdirMode": "0700",
                },
                "provider": {"requestCount": len(provider.requests)},
                "sandboxSetup": {
                    "unixSocketRestriction": (
                        "disabled-for-official-docker-comparator"
                        if reference_allows_unix_sockets
                        else "runtime-default"
                    )
                },
            }


def _cli_version(cli: Path) -> str:
    import subprocess

    result = subprocess.run(
        [str(cli), "--version"],
        check=True,
        capture_output=True,
        text=True,
        timeout=15,
    )
    return (result.stdout or result.stderr).strip()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cli", type=Path, required=True)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--dream-compat", action="store_true")
    args = parser.parse_args()
    receipt = asyncio.run(run_contract(args.cli.resolve(), args.dream_compat))
    encoded = json.dumps(receipt, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    if args.output:
        args.output.write_text(encoded)
    print(encoded, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
