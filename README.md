<!-- [Input] Runtime source, release manifests, Dream evidence, and executable acceptance results. -->
<!-- [Output] Explain what this repository ships, how to build/test it, and why it is not a core optimization. -->
<!-- [Pos] Operator-facing entry point for the Claude Code compatibility envelope. -->

# Ink Claude Code Runtime envelope

This repository ships a transparent Node 22 CLI envelope around the externally installed, pinned Claude Code `2.1.235`. It adds a Runtime-owned manifest, deployment doctor, thread-TMPDIR guard, process-group supervision, checksums, SBOM, and deterministic packaging. It does not contain or rebuild Claude Code.

This is not the recommended production cold-start or memory optimization. Claude core loading reduction is exactly **0**; the envelope adds a Node process and release-file loading. The final local macOS arm64 measurement made the `--version` path 24.22 ms / 50.8% slower than the official binary. Keep the verified official executable as the production default and rollback target unless the supervision/attestation features justify that cost.

## Existing Dream/SDK integration

Python `claude-agent-sdk==0.2.140` remains unchanged. Dream already resolves `CLAUDE_CODE_CLI_PATH`, applies it to `ClaudeAgentOptions.cli_path`, and uses the same resolver for MCP Resources/OAuth management. No SDK manifest, bridge, fork, or Dream code change is required:

```sh
export CLAUDE_CODE_CLI_PATH="$PWD/dist/release/ink-claude-runtime-0.1.0/bin/ink-claude-runtime.mjs"
# Optional only when `claude` on PATH is not the official 2.1.235 core:
export INK_CLAUDE_CODE_EXECUTABLE=/path/to/verified/official/claude

"$CLAUDE_CODE_CLI_PATH" --runtime-doctor
```

The wrapper transparently forwards SDK headless stream-json and `mcp add/get/list/login/logout/remove/help/version`. Thread launches require Dream's server-owned `CLAUDE_CODE_TMPDIR`; MCP management, `-v`/`--version`, and top-level help do not.

## Build and verify

```sh
bun install --frozen-lockfile
bun run verify
bun run release:pack
```

The executable is a Node-target bundle; Bun manages dependencies and runs build scripts but is not the production runtime. See [the design](docs/design/minimal-im-runtime.md), [build instructions](docs/build/README.md), and [test evidence](docs/test/README.md).

## Release contents

`dist/release/ink-claude-runtime-0.1.0/` contains the executable, lazy chunks, external source maps, Runtime-owned release/evidence manifests, platform pins, checksums, CycloneDX SBOM, build metadata, and rollback receipt. The official core, transcripts, workspace content, materialized plugins, OAuth state, settings, credentials, and secrets are excluded.
