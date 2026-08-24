#!/usr/bin/env python3
"""Run a CLI with all three standard streams attached to one real PTY slave.

[Input] A command after `--`, inherited isolated environment, and pipe-backed driver stdin/stdout.
[Output] Proxy master bytes/input and exit with the child status after draining the PTY.
[Pos] Test-only Dream-compatible `pty.openpty` process boundary; it implements no MCP or OAuth behavior.
[Sync] 2026-08-24: reproduce Dream's no-echo PTY lifecycle for Runtime OAuth qualification.
"""

from __future__ import annotations

import argparse
import errno
import os
import pty
import select
import signal
import subprocess
import sys
import termios
import time


def _parse_args() -> list[str]:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = list(args.command)
    if command and command[0] == "--":
        command = command[1:]
    if not command or not os.path.isabs(command[0]):
        parser.error("command must begin with an absolute executable after --")
    return command


def _terminate(child: subprocess.Popen[bytes]) -> None:
    if child.poll() is not None:
        return
    try:
        os.killpg(child.pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    try:
        child.wait(timeout=2)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(child.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        child.wait(timeout=2)


def main() -> int:
    command = _parse_args()
    master_fd, slave_fd = pty.openpty()
    terminal_attributes = termios.tcgetattr(slave_fd)
    terminal_attributes[3] &= ~termios.ECHO
    termios.tcsetattr(slave_fd, termios.TCSANOW, terminal_attributes)
    child = subprocess.Popen(
        command,
        stdin=slave_fd,
        stdout=slave_fd,
        stderr=slave_fd,
        env=os.environ.copy(),
        close_fds=True,
        start_new_session=True,
    )
    os.close(slave_fd)
    stdin_open = True
    master_open = True
    try:
        while master_open or child.poll() is None:
            readers = [master_fd] if master_open else []
            if stdin_open:
                readers.append(sys.stdin.fileno())
            ready, _, _ = select.select(readers, [], [], 0.1)
            if master_open and master_fd in ready:
                try:
                    chunk = os.read(master_fd, 65536)
                except OSError as error:
                    if error.errno != errno.EIO:
                        raise
                    chunk = b""
                if chunk:
                    os.write(sys.stdout.fileno(), chunk)
                else:
                    master_open = False
            if stdin_open and sys.stdin.fileno() in ready:
                chunk = os.read(sys.stdin.fileno(), 65536)
                if chunk:
                    os.write(master_fd, chunk)
                else:
                    stdin_open = False
            if child.poll() is not None and master_open:
                # Give the kernel a bounded opportunity to expose final PTY bytes.
                time.sleep(0.01)
        return int(child.wait())
    finally:
        _terminate(child)
        os.close(master_fd)


if __name__ == "__main__":
    raise SystemExit(main())
