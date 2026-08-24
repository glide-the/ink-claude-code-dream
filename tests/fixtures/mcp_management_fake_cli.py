#!/usr/bin/env python3
"""Deterministic fake CLI for the Runtime-side MCP management harness.

[Input] Claude-compatible MCP management argv plus isolated config/secure-storage env.
[Output] Persistent test-only user server rows, help/version text, and intentionally sensitive diagnostics.
[Pos] Provider-free fixture for the management harness; it does not implement Agent, MCP, OAuth, or Dream state machines.
[Sync] 2026-08-24: initial fake process for colon-name, isolation, and redaction receipt tests.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
import sys


def _config_root() -> Path:
    config = os.environ.get("CLAUDE_CONFIG_DIR")
    secure = os.environ.get("CLAUDE_SECURESTORAGE_CONFIG_DIR")
    if not config or config != secure:
        raise SystemExit("isolated config selectors are missing or different")
    root = Path(config)
    if root.stat().st_mode & 0o777 != 0o700:
        raise SystemExit("isolated config directory mode is not 0700")
    return root


def _state_path() -> Path:
    return _config_root() / "management-fixture.json"


def _read_servers() -> dict[str, str]:
    path = _state_path()
    if not path.exists():
        return {}
    value = json.loads(path.read_text(encoding="utf-8"))
    return {str(name): str(url) for name, url in value.items()}


def _write_servers(servers: dict[str, str]) -> None:
    _state_path().write_text(
        json.dumps(servers, ensure_ascii=False, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def _help(command: str) -> int:
    print(f"Usage: claude mcp {command} [options] <name>")
    if command == "login":
        print("--no-browser  Print the authorization URL")
    if command in {"add", "remove"}:
        print("--scope <scope>  Configuration scope")
    return 0


def main(argv: list[str]) -> int:
    if argv == ["--version"]:
        print("2.1.88 (ink management fixture)")
        return 0
    if len(argv) < 2 or argv[0] != "mcp":
        print("unsupported command")
        return 2
    command = argv[1]
    if argv[2:] == ["--help"] and command in {"login", "logout", "add", "remove"}:
        return _help(command)

    servers = _read_servers()
    if command == "list" and len(argv) == 2:
        if not servers:
            print("No MCP servers configured")
            return 0
        print("Checking MCP server health…")
        for name, url in sorted(servers.items()):
            if "access_token=" in url:
                print(f"{name}: {url} - Failed: access_token=fixture-sensitive-token-value")
            else:
                print(f"{name}: {url} - Connected")
        return 0
    if command == "get" and len(argv) == 3:
        name = argv[2]
        if name not in servers:
            print(f'No MCP server named "{name}"')
            return 1
        print(name)
        print("Scope: User config")
        print(f"URL: {servers[name]}")
        return 0
    if command == "add":
        try:
            transport = argv[argv.index("--transport") + 1]
            scope = argv[argv.index("--scope") + 1]
        except (ValueError, IndexError):
            print("missing transport or scope")
            return 2
        if transport != "http" or scope != "user" or len(argv) < 8:
            print("unsupported add contract")
            return 2
        name, url = argv[-2:]
        servers[name] = url
        _write_servers(servers)
        print(f"Added HTTP MCP server {name} to user config")
        return 0
    if command == "remove":
        try:
            scope = argv[argv.index("--scope") + 1]
        except (ValueError, IndexError):
            print("missing scope")
            return 2
        name = argv[-1]
        if scope != "user" or name not in servers:
            print(f'No MCP server named "{name}" in user scope')
            return 1
        del servers[name]
        _write_servers(servers)
        print(f"Removed MCP server {name} from user config")
        return 0
    print("unsupported MCP command")
    return 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
