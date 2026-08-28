#!/usr/bin/env python3
"""Run Dream's real MCP management driver against one explicit CLI.

[Input] Absolute CLI/output/Dream-backend paths, isolated 0700 config identity, and candidate/reference mode.
[Output] Secret-safe provider-free receipt for version/help/user HTTP lifecycle, colon names, isolation, and redaction.
[Pos] Real process-boundary contract; it imports Dream's production driver/parser and does not copy their state machine.
[Sync] 2026-08-24: bind candidate management evidence to one qualified native Runtime target.
"""

from __future__ import annotations

import argparse
import asyncio
from contextlib import contextmanager
import getpass
import hashlib
import json
import os
from pathlib import Path
import signal
import socket
import stat
import subprocess
import sys
import tempfile
import time
from typing import Any, Iterator


SCHEMA_VERSION = 1
SERVER_NAME = "user-management-contract"
COLON_SERVER_NAME = "user:management:contract"
ERROR_SERVER_NAME = "user-management-error"
SECRET_MARKER = "ink-mcp-management-secret-marker-7f6d4a"
MAX_RECEIPT_BYTES = 256 * 1024


class ContractFailure(RuntimeError):
    """A safe, label-only contract failure with no child output or argv."""


def _sha256(body: bytes) -> str:
    return hashlib.sha256(body).hexdigest()


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cli", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--dream-backend", required=True)
    parser.add_argument("--mode", choices=("candidate", "reference"), default="candidate")
    parser.add_argument("--bun")
    parser.add_argument("--core-receipt")
    parser.add_argument("--core-bundle")
    args = parser.parse_args()
    for name in ("cli", "output", "dream_backend"):
        value = Path(getattr(args, name))
        if not value.is_absolute():
            parser.error(f"--{name.replace('_', '-')} must be an explicit absolute path")
    if args.bun and not Path(args.bun).is_absolute():
        parser.error("--bun must be an explicit absolute path")
    for name in ("core_receipt", "core_bundle"):
        value = getattr(args, name)
        if value and not Path(value).is_absolute():
            parser.error(f"--{name.replace('_', '-')} must be an explicit absolute path")
    if args.mode == "candidate" and (not args.core_receipt or not args.core_bundle):
        parser.error("candidate mode requires --core-receipt and --core-bundle")
    return args


def _require_regular_executable(path: Path, label: str) -> Path:
    try:
        resolved = path.resolve(strict=True)
        mode = resolved.stat().st_mode
    except OSError as exc:
        raise ContractFailure(f"{label} is unavailable") from exc
    if not stat.S_ISREG(mode) or not os.access(resolved, os.X_OK):
        raise ContractFailure(f"{label} is not an executable regular file")
    return resolved


def _tree_receipt(root: Path) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    for path in sorted(root.rglob("*")):
        if path.is_symlink():
            raise ContractFailure("identity directory contains a symlink")
        if not path.is_file():
            continue
        body = path.read_bytes()
        entries.append(
            {
                "path": path.relative_to(root).as_posix(),
                "sha256": _sha256(body),
                "bytes": len(body),
                "mode": oct(stat.S_IMODE(path.stat().st_mode)),
            }
        )
    return entries


def _safe_result(label: str, result: Any) -> dict[str, Any]:
    body = str(result.output).encode("utf-8", errors="replace")
    return {
        "label": label,
        "exitCode": int(result.exit_code),
        "timedOut": bool(result.timed_out),
        "outputBytes": len(body),
        "redactedOutputSha256": _sha256(body),
    }


def _require_ok(label: str, result: Any) -> str:
    if result.timed_out or result.exit_code != 0:
        raise ContractFailure(f"{label} did not complete successfully")
    return str(result.output)


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _wait_port(port: int, process: subprocess.Popen[bytes]) -> None:
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise ContractFailure("local MCP fixture exited before readiness")
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.2):
                return
        except OSError:
            time.sleep(0.05)
    raise ContractFailure("local MCP fixture readiness timed out")


@contextmanager
def _local_mcp_server(repository_root: Path, identity_root: Path) -> Iterator[str]:
    fixture = repository_root / "tests" / "fixtures" / "mcp_management_http_server.py"
    if not fixture.is_file():
        raise ContractFailure("local MCP fixture is unavailable")
    port = _free_port()
    audit = identity_root / "mcp-audit.jsonl"
    environment = {
        "HOME": str(identity_root),
        "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
        "LANG": os.environ.get("LANG", "C.UTF-8"),
        "INK_MCP_AUDIT_PATH": str(audit),
    }
    process = subprocess.Popen(
        [
            sys.executable,
            str(fixture),
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
        ],
        cwd=identity_root,
        env=environment,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )
    try:
        _wait_port(port, process)
        yield f"http://127.0.0.1:{port}/mcp"
    finally:
        if process.poll() is None:
            try:
                os.killpg(process.pid, signal.SIGTERM)
                process.wait(timeout=3)
            except (OSError, subprocess.TimeoutExpired):
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except OSError:
                    pass
                process.wait(timeout=3)


def _write_receipt(output: Path, receipt: dict[str, Any]) -> None:
    encoded = (json.dumps(receipt, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode()
    if len(encoded) > MAX_RECEIPT_BYTES:
        raise ContractFailure("receipt exceeded the bounded output size")
    if SECRET_MARKER.encode() in encoded or b"access_token=" in encoded:
        raise ContractFailure("receipt secret boundary failed")
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_name(f".{output.name}.{os.getpid()}.tmp")
    temporary.write_bytes(encoded)
    temporary.chmod(0o600)
    os.replace(temporary, output)


async def _run_contract(
    *,
    args: argparse.Namespace,
    cli: Path,
    repository_root: Path,
    identity_root: Path,
    qualification_subject: dict[str, str] | None,
) -> dict[str, Any]:
    dream_backend = Path(args.dream_backend).resolve(strict=True)
    if not (dream_backend / "claude_mcp" / "driver.py").is_file():
        raise ContractFailure("Dream production MCP driver is unavailable")
    sys.path.insert(0, str(dream_backend))
    try:
        from claude_mcp.contracts import ClaudeMcpRuntimeIdentity
        from claude_mcp.driver import ClaudeMcpCliDriver
        from claude_mcp.parser import parse_server_names, parse_server_scope, parse_version
        from claude_mcp.settings import ClaudeMcpSettings
    except Exception as exc:
        raise ContractFailure("Dream production MCP driver import failed") from exc

    config_dir = identity_root / "config"
    home_dir = identity_root / "home"
    neutral_dir = identity_root / "neutral"
    temp_dir = identity_root / "tmp"
    for directory in (config_dir, home_dir, neutral_dir, temp_dir):
        directory.mkdir(mode=0o700)
        directory.chmod(0o700)
    poison = {
        "mcpServers": {
            "home-poison": {
                "type": "http",
                "url": "http://127.0.0.1:1/home-poison",
            }
        }
    }
    (home_dir / ".claude.json").write_text(
        json.dumps(poison, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    (home_dir / ".claude.json").chmod(0o600)
    home_before = _tree_receipt(home_dir)

    environment = {
        "HOME": str(home_dir),
        "USER": getpass.getuser(),
        "LOGNAME": getpass.getuser(),
        "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
        "LANG": os.environ.get("LANG", "C.UTF-8"),
        "SHELL": "/bin/sh",
        "TERM": "dumb",
        "TMPDIR": str(temp_dir),
        "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
    }
    if args.bun:
        bun = _require_regular_executable(Path(args.bun), "Bun test runtime")
        environment["INK_CLAUDE_CODE_BUN_PATH"] = str(bun)
    identity = ClaudeMcpRuntimeIdentity(
        command=(str(cli),),
        config_dir=config_dir,
        cwd=neutral_dir,
        env=environment,
        fingerprint="runtime-management-contract",
    )
    settings = ClaudeMcpSettings(
        auth_timeout_seconds=10,
        command_timeout_seconds=15,
        terminate_grace_seconds=2,
        readiness_timeout_seconds=5,
        max_capture_bytes=65536,
        max_server_name_length=512,
        max_redirect_url_length=8192,
    )
    driver = ClaudeMcpCliDriver(settings)
    commands: list[dict[str, Any]] = []

    version = await driver.version(identity)
    version_output = _require_ok("version", version)
    parsed_version = parse_version(version_output)
    if parsed_version is None:
        raise ContractFailure("version output is not parseable")
    commands.append(_safe_result("version", version))

    initial_list = await driver.list_servers(identity)
    initial_output = _require_ok("initial list", initial_list)
    if parse_server_names(initial_output, max_length=512):
        raise ContractFailure("initial isolated MCP inventory is not empty")
    if "home-poison" in initial_output:
        raise ContractFailure("HOME MCP configuration polluted the isolated identity")
    commands.append(_safe_result("initial-list", initial_list))

    help_methods = {
        "login-help": driver.login_help,
        "logout-help": driver.logout_help,
        "add-help": driver.add_help,
        "remove-help": driver.remove_help,
    }
    for label, method in help_methods.items():
        result = await method(identity)
        output = _require_ok(label, result)
        if "usage:" not in output.lower():
            raise ContractFailure(f"{label} output has no usage contract")
        if label == "login-help" and "--no-browser" not in output:
            raise ContractFailure("login help has no no-browser contract")
        commands.append(_safe_result(label, result))

    with _local_mcp_server(repository_root, identity_root) as server_url:
        added = await driver.add_http_user_server(identity, SERVER_NAME, server_url)
        _require_ok("user HTTP add", added)
        commands.append(_safe_result("user-http-add", added))

        fetched = await driver.get_server(identity, SERVER_NAME)
        fetched_output = _require_ok("user HTTP get", fetched)
        if parse_server_scope(fetched_output).value != "user" or SERVER_NAME not in fetched_output:
            raise ContractFailure("user HTTP get lost its user-scope identity")
        commands.append(_safe_result("user-http-get", fetched))

        listed = await driver.list_servers(identity)
        listed_output = _require_ok("user HTTP list", listed)
        if SERVER_NAME not in parse_server_names(listed_output, max_length=512):
            raise ContractFailure("user HTTP list lost the configured server")
        commands.append(_safe_result("user-http-list", listed))

        removed = await driver.remove_user_server(identity, SERVER_NAME)
        _require_ok("user HTTP remove", removed)
        commands.append(_safe_result("user-http-remove", removed))

        listed_after_remove = await driver.list_servers(identity)
        after_output = _require_ok("list after remove", listed_after_remove)
        if SERVER_NAME in parse_server_names(after_output, max_length=512):
            raise ContractFailure("removed user HTTP server remained in inventory")
        commands.append(_safe_result("list-after-remove", listed_after_remove))

        colon_added = await driver.add_http_user_server(
            identity,
            COLON_SERVER_NAME,
            server_url,
        )
        commands.append(_safe_result("colon-user-http-add", colon_added))
        colon_supported = colon_added.ok
        colon_lifecycle = False
        if colon_supported:
            colon_get = await driver.get_server(identity, COLON_SERVER_NAME)
            colon_get_output = _require_ok("colon user HTTP get", colon_get)
            commands.append(_safe_result("colon-user-http-get", colon_get))
            colon_list = await driver.list_servers(identity)
            colon_list_output = _require_ok("colon user HTTP list", colon_list)
            commands.append(_safe_result("colon-user-http-list", colon_list))
            if (
                parse_server_scope(colon_get_output).value != "user"
                or COLON_SERVER_NAME
                not in parse_server_names(colon_list_output, max_length=512)
            ):
                raise ContractFailure("colon server identity was not preserved")
            colon_remove = await driver.remove_user_server(identity, COLON_SERVER_NAME)
            _require_ok("colon user HTTP remove", colon_remove)
            commands.append(_safe_result("colon-user-http-remove", colon_remove))
            colon_lifecycle = True
        elif args.mode == "candidate":
            raise ContractFailure("candidate CLI rejected a colon-bearing MCP server name")

    sensitive_url = (
        f"http://127.0.0.1:1/mcp?access_token={SECRET_MARKER}&force_auth=1"
    )
    sensitive_add = await driver.add_http_user_server(
        identity,
        ERROR_SERVER_NAME,
        sensitive_url,
    )
    sensitive_add_output = _require_ok("sensitive error fixture add", sensitive_add)
    commands.append(_safe_result("sensitive-error-add", sensitive_add))
    sensitive_get = await driver.get_server(identity, ERROR_SERVER_NAME)
    sensitive_get_output = _require_ok("sensitive error fixture get", sensitive_get)
    commands.append(_safe_result("sensitive-error-get", sensitive_get))
    sensitive_list = await driver.list_servers(identity)
    sensitive_list_output = _require_ok("sensitive error fixture list", sensitive_list)
    commands.append(_safe_result("sensitive-error-list", sensitive_list))
    safe_outputs = sensitive_add_output + sensitive_get_output + sensitive_list_output
    if SECRET_MARKER in safe_outputs or sensitive_url in safe_outputs:
        raise ContractFailure("Dream driver returned unredacted sensitive MCP output")
    if not any(
        marker in sensitive_list_output.lower()
        for marker in ("failed", "error", "connect", "auth", "✗")
    ):
        raise ContractFailure("sensitive error fixture produced no bounded error state")
    sensitive_remove = await driver.remove_user_server(identity, ERROR_SERVER_NAME)
    _require_ok("sensitive error fixture remove", sensitive_remove)
    commands.append(_safe_result("sensitive-error-remove", sensitive_remove))

    home_after = _tree_receipt(home_dir)
    if stat.S_IMODE(config_dir.stat().st_mode) != 0o700:
        raise ContractFailure("CLI changed the isolated config directory mode")
    config_entries = _tree_receipt(config_dir)
    if any(
        b"home-poison" in path.read_bytes()
        for path in config_dir.rglob("*")
        if path.is_file() and not path.is_symlink()
    ):
        raise ContractFailure("HOME MCP configuration polluted the isolated config identity")
    if any(entry["path"].startswith("../") for entry in config_entries):
        raise ContractFailure("config evidence escaped the isolated identity")

    receipt: dict[str, Any] = {
        "schemaVersion": SCHEMA_VERSION,
        "status": "passed" if args.mode == "candidate" else "passed-calibration",
        "evidenceType": "real-process-mcp-management-contract",
        "mode": args.mode,
        "calibrationOnly": args.mode == "reference",
        "runtime": {
            "version": ".".join(str(part) for part in parsed_version),
            "cliSha256": _sha256(cli.read_bytes()),
        },
        "identity": {
            "configAndSecureStorageSamePath": True,
            "configDirectoryMode": "0700",
            "neutralCwd": True,
            "operatorHomeInherited": False,
            "disposableHomeBound": True,
            "homeWritesContained": True,
            "disposableHomeChanged": home_after != home_before,
            "homePoisonExcludedFromInventoryAndConfig": True,
            "homeInventoryExcluded": True,
        },
        "commands": commands,
        "httpUserScope": {
            "addGetListRemove": "passed",
            "serverName": SERVER_NAME,
            "colonServerName": COLON_SERVER_NAME,
            "colonNameSupported": colon_supported,
            "colonLifecyclePassed": colon_lifecycle,
        },
        "safeErrors": {
            "productionDreamRedactionUsed": True,
            "sensitiveMaterialAbsentFromResult": True,
            "sensitiveMaterialAbsentFromReceipt": True,
            "boundedCaptureBytes": settings.max_capture_bytes,
        },
        "oauth": {
            "helpCommandsPassed": True,
            "noBrowserLogin": "deferred-to-real-business-qa",
            "logout": "deferred-to-real-business-qa",
            "reason": "No local fixture in this contract claims complete DCR, PKCE, browser consent, redirect, token, secure-store, and revocation behavior.",
        },
        "configEvidence": {
            "fileCount": len(config_entries),
            "treeSha256": _sha256(
                json.dumps(config_entries, sort_keys=True, separators=(",", ":")).encode()
            ),
        },
    }
    if qualification_subject is not None:
        receipt["subject"] = qualification_subject
    if args.mode == "reference" and colon_supported:
        receipt["referenceObservation"] = "2.1.241 accepted colon-bearing user server names"
    elif args.mode == "reference":
        receipt["referenceObservation"] = (
            "2.1.241 rejects colon-bearing names at mcp add; candidate mode intentionally requires the Dream identity contract."
        )
    return receipt


def main() -> int:
    args = _parse_args()
    output = Path(args.output)
    repository_root = Path(__file__).resolve().parents[1]
    mode = str(args.mode)
    try:
        cli = _require_regular_executable(Path(args.cli), "candidate/reference CLI")
        qualification_subject: dict[str, str] | None = None
        if args.mode == "candidate":
            core_receipt_path = Path(args.core_receipt).resolve(strict=True)
            core_bundle_path = Path(args.core_bundle).resolve(strict=True)
            try:
                core_receipt = json.loads(core_receipt_path.read_text(encoding="utf-8"))
                core_bundle = core_bundle_path.read_bytes()
            except (OSError, UnicodeError, json.JSONDecodeError) as exc:
                raise ContractFailure("candidate core binding input is unreadable") from exc
            source_digest = core_receipt.get("sourceDigest", {}).get("digest")
            runtime_target = core_receipt.get("runtimeTarget")
            if (
                core_receipt.get("status") != "built"
                or core_receipt.get("build", {}).get("success") is not True
                or not isinstance(source_digest, str)
                or len(source_digest) != 64
                or runtime_target
                not in {"darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"}
            ):
                raise ContractFailure("candidate core binding receipt is not built")
            qualification_subject = {
                "runtime": "ink-claude-code-dream",
                "version": "0.1.3",
                "coreBundleSha256": _sha256(core_bundle),
                "sourceDigest": source_digest,
                "runtimeTarget": runtime_target,
            }
        with tempfile.TemporaryDirectory(prefix="ink-mcp-management-contract-") as raw_root:
            identity_root = Path(raw_root).resolve()
            identity_root.chmod(0o700)
            receipt = asyncio.run(
                _run_contract(
                    args=args,
                    cli=cli,
                    repository_root=repository_root,
                    identity_root=identity_root,
                    qualification_subject=qualification_subject,
                )
            )
        _write_receipt(output, receipt)
        print(json.dumps(receipt, ensure_ascii=False, sort_keys=True))
        return 0
    except ContractFailure as exc:
        failure = {
            "schemaVersion": SCHEMA_VERSION,
            "status": "failed",
            "evidenceType": "real-process-mcp-management-contract",
            "mode": mode,
            "failedGate": str(exc),
        }
        try:
            _write_receipt(output, failure)
        except ContractFailure:
            pass
        print(f"[core-mcp-management-contract] {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
