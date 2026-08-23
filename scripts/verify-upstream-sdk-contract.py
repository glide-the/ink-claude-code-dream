"""[Input] Built CLI wrapper, Dream's existing CLI-path helper, and Dream-observed SDK 0.2.140.
[Output] Prove unchanged apply_cli_path_to_options + SubprocessCLITransport launch the wrapper and preserve NDJSON.
[Pos] Cross-repository read-only acceptance; it never imports an SDK fork or modifies Dream.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
import tempfile
from importlib.metadata import version as package_version

import anyio


REPOSITORY = Path(__file__).resolve().parents[1]
DREAM_REPOSITORY = Path(
    os.environ.get("INK_DREAM_REPO", REPOSITORY.parent / "ink-dream-memory")
).resolve()
DREAM_BACKEND = DREAM_REPOSITORY / "backend"
WRAPPER = REPOSITORY / "dist/release/ink-claude-code-dream-0.1.0/bin/ink-claude-code-dream"
FAKE_CORE = REPOSITORY / "tests/fixtures/fake-claude.mjs"


def import_production_interfaces():
    import sys

    sys.path.insert(0, str(DREAM_BACKEND))
    from claude_agent_sdk._internal.transport.subprocess_cli import (  # noqa: PLC0415
        SubprocessCLITransport,
    )
    from claude_agent_sdk.types import ClaudeAgentOptions  # noqa: PLC0415
    from libs.claude_agent_kit.server.sdk_env import (  # noqa: PLC0415
        apply_cli_path_to_options,
        resolve_claude_cli_path,
    )

    return (
        SubprocessCLITransport,
        ClaudeAgentOptions,
        apply_cli_path_to_options,
        resolve_claude_cli_path,
    )


async def exercise() -> dict[str, object]:
    installed_sdk_version = package_version("claude-agent-sdk")
    if installed_sdk_version != "0.2.140":
        raise AssertionError(
            f"expected Dream-observed claude-agent-sdk 0.2.140, found {installed_sdk_version}"
        )
    (
        transport_type,
        options_type,
        apply_cli_path,
        resolve_cli,
    ) = import_production_interfaces()
    with tempfile.TemporaryDirectory(prefix="ink-upstream-sdk-") as raw_workspace:
        workspace = Path(raw_workspace).resolve()
        claude_tmpdir = workspace / ".claude-tmp"
        claude_tmpdir.mkdir(mode=0o700)
        record = workspace / "record.json"
        version_count = workspace / "version-count"
        previous = dict(os.environ)
        os.environ.update(
            {
                "CLAUDE_CODE_CLI_PATH": str(WRAPPER),
                "INK_CLAUDE_CODE_EXECUTABLE": str(FAKE_CORE),
                "FAKE_VERSION_COUNT": str(version_count),
                "FAKE_CLAUDE_RECORD": str(record),
            }
        )
        try:
            options = options_type(
                cwd=workspace,
                env={
                    "CLAUDE_CODE_TMPDIR": str(claude_tmpdir),
                    "INK_CLAUDE_RUNTIME_WORKSPACE_ROOT": str(workspace),
                },
            )
            apply_cli_path(options)
            if Path(options.cli_path).resolve() != WRAPPER.resolve():
                raise AssertionError(f"Dream helper selected {options.cli_path!r}")
            if Path(resolve_cli()).resolve() != WRAPPER.resolve():
                raise AssertionError("Dream MCP resolver did not select the wrapper")

            transport = transport_type(prompt="", options=options)
            payload = '{"type":"user","message":{"role":"user","content":"sdk-opaque"}}\n'
            await transport.connect()
            await transport.write(payload)
            await transport.end_input()
            messages = [message async for message in transport.read_messages()]
            await transport.close()

            recorded = json.loads(record.read_text(encoding="utf-8"))
            args = recorded["args"]
            if [args[0], args[1]] != ["--output-format", "stream-json"]:
                raise AssertionError(f"unexpected SDK argv prefix: {args[:4]}")
            if args[-2:] != ["--input-format", "stream-json"]:
                raise AssertionError(f"unexpected SDK argv suffix: {args[-4:]}")
            if recorded["stdinBase64"] != __import__("base64").b64encode(payload.encode()).decode():
                raise AssertionError("SDK/wrapper stdin changed")
            if messages != [json.loads(payload)]:
                raise AssertionError(f"SDK/wrapper NDJSON changed: {messages!r}")
            if version_count.read_text(encoding="utf-8") != "v":
                raise AssertionError("upstream SDK probe did not start the core exactly once")
            return {
                "ok": True,
                "sdkVersion": installed_sdk_version,
                "sdkModified": False,
                "cliPath": str(options.cli_path),
                "sdkArgv": args,
                "messages": len(messages),
                "versionProbeCoreStarts": 1,
                "mainLaunchCoreStarts": 1,
            }
        finally:
            os.environ.clear()
            os.environ.update(previous)


if __name__ == "__main__":
    print(json.dumps(anyio.run(exercise), sort_keys=True))
