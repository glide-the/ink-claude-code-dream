<!-- [Input] Planned compatibility envelope, Dream read-only runtime evidence, and upstream SDK 0.2.140 cli_path contract. -->
<!-- [Output] Record the impact surface and explicit test boundaries before executable validation. -->
<!-- [Pos] Pre-test change-impact receipt for the minimal runtime release. -->

# Test impact record

Recorded before the first build/test run on 2026-08-23.

Changed surface:

- New Node 22 compatibility envelope executable; it does not replace or rewrite Claude Code stream-json/control framing.
- Runtime-owned release/evidence manifests; neither is an SDK handshake or an SDK-parsed schema.
- New fail-closed `CLAUDE_CODE_TMPDIR` validation for formal launches.
- New process-group signal, optional timeout, crash exit, and cleanup behavior around the official child.
- New Bun-managed deterministic build, split dynamic imports, source maps, checksums, SBOM, platform pins, and immutable release directory.

Must remain unchanged at the official SDK/CLI boundary:

- argv order and values;
- stdin/stdout/stderr bytes and open stdin for control/MCP callbacks;
- process cwd and non-runtime environment, including Claude config, MCP, plugin, sandbox, and credential selectors;
- JSON/JSONL/streaming, permissions, MCP stdio/HTTP/SSE/SDK/OAuth/Resources, plugins/skills/hooks, transcript/resume, and exit semantics.

Provider-free acceptance can prove boundary preservation, the unchanged SDK 0.2.140 `cli_path` launch, both MCP regression declarations (`1.27.0`, `1.27.1`), lifecycle cleanup, Runtime manifest validation, lazy envelope imports, and release exclusions. It cannot prove a real model turn, Dream database persistence, real OAuth, or current native core internals. Those remain explicitly unclaimed.
