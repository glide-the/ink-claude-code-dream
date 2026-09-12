"""[Input] Built CLI wrapper, Dream's existing CLI-path helper, and installed compatible SDK distribution.
[Output] Compare one SDK JSONL request through the direct fake core and wrapper without changing either SDK namespace.
[Pos] Cross-repository read-only acceptance; it never imports an SDK fork or modifies Dream.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
import tempfile
from importlib.metadata import PackageNotFoundError, version as package_version

import anyio


REPOSITORY = Path(__file__).resolve().parents[1]
DREAM_REPOSITORY = Path(
    os.environ.get("INK_DREAM_REPO", REPOSITORY.parent / "ink-dream-memory")
).resolve()
DREAM_BACKEND = DREAM_REPOSITORY / "backend"
WRAPPER = REPOSITORY / "dist/release/ink-claude-code-dream-0.1.5/bin/ink-claude-code-dream"
FAKE_CORE = REPOSITORY / "tests/fixtures/fake-claude.mjs"
EXPECTED_SDK_DISTRIBUTION = "ink-claude-dream-agent-sdk"
EXPECTED_SDK_VERSION = "0.2.145"
CONFLICTING_OFFICIAL_DISTRIBUTION = "claude-agent-sdk"


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


def installed_sdk_distribution() -> tuple[str, str]:
    try:
        installed_version = package_version(EXPECTED_SDK_DISTRIBUTION)
    except PackageNotFoundError as error:
        raise AssertionError(
            f"required SDK distribution {EXPECTED_SDK_DISTRIBUTION} is not installed"
        ) from error
    if installed_version != EXPECTED_SDK_VERSION:
        raise AssertionError(
            f"expected {EXPECTED_SDK_DISTRIBUTION} {EXPECTED_SDK_VERSION}, "
            f"found {installed_version}"
        )
    try:
        conflicting_version = package_version(CONFLICTING_OFFICIAL_DISTRIBUTION)
    except PackageNotFoundError:
        conflicting_version = None
    if conflicting_version is not None:
        raise AssertionError(
            f"conflicting {CONFLICTING_OFFICIAL_DISTRIBUTION} "
            f"{conflicting_version} must not coexist with {EXPECTED_SDK_DISTRIBUTION}"
        )
    return EXPECTED_SDK_DISTRIBUTION, installed_version


async def run_lane(
    *,
    transport_type,
    options_type,
    cli_path: Path,
    workspace: Path,
    claude_tmpdir: Path,
    record: Path,
    version_count: Path,
    payload: str,
    envelope_core: Path | None,
) -> dict[str, object]:
    os.environ["FAKE_VERSION_COUNT"] = str(version_count)
    os.environ["FAKE_CLAUDE_RECORD"] = str(record)
    os.environ.pop("CLAUDE_CODE_CLI_PATH", None)
    if envelope_core is None:
        os.environ.pop("INK_CLAUDE_CODE_EXECUTABLE", None)
    else:
        os.environ["INK_CLAUDE_CODE_EXECUTABLE"] = str(envelope_core)
    lane_environment = {"CLAUDE_CODE_TMPDIR": str(claude_tmpdir)}
    if envelope_core is not None:
        lane_environment["INK_CLAUDE_RUNTIME_WORKSPACE_ROOT"] = str(workspace)
    options = options_type(
        cwd=workspace,
        cli_path=str(cli_path),
        env=lane_environment,
    )
    transport = transport_type(prompt="", options=options)
    await transport.connect()
    try:
        await transport.write(payload)
        await transport.end_input()
        messages = [message async for message in transport.read_messages()]
    finally:
        await transport.close()
    recorded = json.loads(record.read_text(encoding="utf-8"))
    return {
        "args": recorded["args"],
        "stdinBase64": recorded["stdinBase64"],
        "messages": messages,
        "versionProbeCoreStarts": version_count.read_text(encoding="utf-8"),
        "cwd": recorded["cwd"],
        "env": recorded["env"],
    }


async def exercise() -> dict[str, object]:
    sdk_distribution, installed_sdk_version = installed_sdk_distribution()
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
        direct_record = workspace / "direct-record.json"
        envelope_record = workspace / "envelope-record.json"
        direct_version_count = workspace / "direct-version-count"
        envelope_version_count = workspace / "envelope-version-count"
        previous = dict(os.environ)
        os.environ.update(
            {
                "CLAUDE_CODE_CLI_PATH": str(WRAPPER),
            }
        )
        try:
            selected_options = options_type(
                cwd=workspace,
                env={
                    "CLAUDE_CODE_TMPDIR": str(claude_tmpdir),
                    "INK_CLAUDE_RUNTIME_WORKSPACE_ROOT": str(workspace),
                },
            )
            apply_cli_path(selected_options)
            if Path(selected_options.cli_path).resolve() != WRAPPER.resolve():
                raise AssertionError(f"Dream helper selected {selected_options.cli_path!r}")
            if Path(resolve_cli()).resolve() != WRAPPER.resolve():
                raise AssertionError("Dream MCP resolver did not select the wrapper")

            payload = '{"type":"user","message":{"role":"user","content":"sdk-opaque"}}\n'
            direct = await run_lane(
                transport_type=transport_type,
                options_type=options_type,
                cli_path=FAKE_CORE,
                workspace=workspace,
                claude_tmpdir=claude_tmpdir,
                record=direct_record,
                version_count=direct_version_count,
                payload=payload,
                envelope_core=None,
            )
            envelope = await run_lane(
                transport_type=transport_type,
                options_type=options_type,
                cli_path=WRAPPER,
                workspace=workspace,
                claude_tmpdir=claude_tmpdir,
                record=envelope_record,
                version_count=envelope_version_count,
                payload=payload,
                envelope_core=FAKE_CORE,
            )
            if envelope != direct:
                raise AssertionError(
                    "direct fake core and wrapper SDK receipts differ: "
                    f"direct={direct!r} envelope={envelope!r}"
                )
            args = envelope["args"]
            if [args[0], args[1]] != ["--output-format", "stream-json"]:
                raise AssertionError(f"unexpected SDK argv prefix: {args[:4]}")
            if args[-2:] != ["--input-format", "stream-json"]:
                raise AssertionError(f"unexpected SDK argv suffix: {args[-4:]}")
            if envelope["stdinBase64"] != __import__("base64").b64encode(payload.encode()).decode():
                raise AssertionError("SDK/wrapper stdin changed")
            if envelope["messages"] != [json.loads(payload)]:
                raise AssertionError(f"SDK/wrapper NDJSON changed: {envelope['messages']!r}")
            if envelope["versionProbeCoreStarts"] != "v":
                raise AssertionError("SDK probe did not start the core exactly once per lane")
            return {
                "ok": True,
                "sdkDistribution": sdk_distribution,
                "sdkVersion": installed_sdk_version,
                "sdkModified": False,
                "cliPath": str(selected_options.cli_path),
                "sdkArgv": args,
                "messagesPerLane": len(envelope["messages"]),
                "lanes": ["direct-provider-free-fake", "envelope-provider-free-fake"],
                "versionProbeCoreStartsPerLane": 1,
                "mainLaunchCoreStartsPerLane": 1,
            }
        finally:
            os.environ.clear()
            os.environ.update(previous)


if __name__ == "__main__":
    print(json.dumps(anyio.run(exercise), sort_keys=True))
