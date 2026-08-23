<!-- [Input] Runtime source, release manifests, Dream evidence, and executable acceptance results. -->
<!-- [Output] Explain what this repository ships, how to build/test it, and why it is not a core optimization. -->
<!-- [Pos] Operator-facing entry point for the Claude Code compatibility envelope. -->
<!-- [Sync] 2026-08-24: align current Dream locked SDK/CLI evidence and retain fail-closed pruning. -->

# ink-claude-code-dream

This private repository builds an installable, discoverable feasibility distribution named `ink-claude-code-dream`. Its extensionless console bin supervises a user-supplied official Claude Code `2.1.241` artifact and adds contracts, a deployment doctor, thread-TMPDIR guard, process-group supervision, checksums, SBOM, license evidence, and deterministic packaging. It does not contain, rebuild, patch, rename, or publish Claude Code.

It is deliberately **not a pruned core and not production eligible**. Both release manifest and verifier fix `corePruned=false`, `productionEligible=false`, and the blocking reasons. Dream must not select this artifact as a claimed optimized default; the verified official executable remains the default and rollback.

This is not the recommended production cold-start or memory optimization. Claude core loading reduction is exactly **0**; the envelope adds a Node process and release-file loading. The final local macOS arm64 measurement made the `--version` path 24.09 ms / 40.5% slower than the official binary. Keep the verified official executable as the production default and rollback target unless the supervision/attestation features justify that cost.

## Existing Dream/SDK integration

Dream currently locks the portable `ink-claude-dream-agent-sdk==0.2.143` distribution and official Claude CLI `2.1.241`. The distribution preserves the `claude_agent_sdk` import namespace and Dream resolves `CLAUDE_CODE_CLI_PATH`, applies it to `ClaudeAgentOptions.cli_path`, and uses the same resolver for MCP Resources/OAuth management. The Runtime does not add an SDK manifest, bridge, fork, or Dream code path:

```sh
export CLAUDE_CODE_CLI_PATH="$PWD/dist/release/ink-claude-code-dream-0.1.0/bin/ink-claude-code-dream"
# Optional only when `claude` on PATH is not the verified official 2.1.241 artifact:
export INK_CLAUDE_CODE_EXECUTABLE=/path/to/verified/official/claude

"$CLAUDE_CODE_CLI_PATH" --runtime-doctor
```

On macOS, Dream's MCP identity manager inspects the selected CLI entrypoint for
the official secure-storage selector marker and intentionally removes
`INK_CLAUDE_CODE_EXECUTABLE` from its isolated management identity. The
envelope retains that static marker, and the same verified official `2.1.241`
directory must therefore be first on the Dream service `PATH` as well as being
the envelope's formal child. This is a deployment identity contract, not a
credential implementation in the wrapper.

The wrapper transparently forwards SDK headless stream-json, MCP management, built-in authentication commands, version, and help. Thread launches require Dream's server-owned `CLAUDE_CODE_TMPDIR`; management commands do not. Authentication environment and built-in methods are never selected, removed, disabled, or restricted by the wrapper.

Official `--bare` is disabled by default and is never injected. An experimental call must explicitly pass `--bare`, set `INK_CLAUDE_BARE_PROFILE=dream-explicit-v1`, and supply the required absolute settings/MCP/plugin carriers; missing carriers fail before child start. This is not a production compatibility claim because official bare mode skips discovery and OAuth/keychain reads.

## Build and verify

```sh
bun install --frozen-lockfile
bun run lint
bun run verify
bun run package
```

The executable is a Node-target bundle; Bun manages dependencies and runs build scripts but is not the production runtime. Archive packing is pinned to Node `24.13.0` so `node:zlib` output is reproducible, while the produced supervisor supports Node `>=22,<25`. See [the design and license/publish decision](docs/design/claude-code-runtime-minimalization.md), [build instructions](docs/build/README.md), and [test evidence](docs/test/README.md).

## Release contents

`dist/release/ink-claude-code-dream-0.1.0/` contains the executable, lazy chunks, external source maps, Runtime-owned artifact/entrypoint/data/bare/license/evidence contracts, platform pins, checksums, CycloneDX SBOM, build metadata, and rollback receipt. The official artifact, vendor/restored source, transcripts, workspace content, materialized plugins, OAuth/auth state, settings, credentials, and secrets are excluded.
