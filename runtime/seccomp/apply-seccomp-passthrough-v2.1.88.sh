#!/bin/sh
# [Input] 2.1.88 sandbox-runtime argv: unix-block.bpf followed by the command and its arguments.
# [Output] Execute the command without applying the optional Unix-socket seccomp filter.
# [Pos] Linux local-core vendor helper; not a general sandbox replacement or clean-room npm input.
# [Sync] 2026-08-30: make the Docker-proven passthrough the restored 2.1.88 BPF-first helper.
set -eu

if [ "$#" -lt 2 ]; then
  printf '%s\n' 'apply-seccomp passthrough requires a BPF path and command' >&2
  exit 64
fi

shift
exec "$@"
