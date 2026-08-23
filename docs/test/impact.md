<!-- [Input] Planned compatibility envelope, Dream read-only Runtime evidence, upstream SDK 0.2.143, and Dream-observed SDK 0.2.140 cli_path contract. -->
<!-- [Output] Record the impact surface and explicit test boundaries before executable validation. -->
<!-- [Pos] Pre-test change-impact receipt for the minimal runtime release. -->

# Test impact record

Recorded before the first build/test run on 2026-08-23.

Updated before the `2.1.241`/SDK `0.2.143` clean-room run on 2026-08-23. Rollback point is branch base `26edc45f89a8`; no vendor/reference repository is writable in this task.

Changed surface:

- New Node 22 compatibility envelope executable; it does not replace or rewrite Claude Code stream-json/control framing.
- Runtime-owned release/evidence manifests; neither is an SDK handshake or an SDK-parsed schema.
- New fail-closed `CLAUDE_CODE_TMPDIR` validation for formal launches.
- New process-group signal, optional timeout, crash exit, and cleanup behavior around the official child.
- New Bun-managed deterministic build, split dynamic imports, source maps, checksums, SBOM, platform pins, and immutable release directory.
- Baseline moves to external official Claude Code `2.1.241` and upstream SDK `0.2.143`, while retaining current Dream SDK `0.2.140` as a bounded compatibility observation.
- Version/help/MCP/auth commands now pass through exactly; only `--runtime-doctor` enforces the deployment pin.
- Legal, external-artifact, entrypoint, Runtime-data, bare-profile, and dependency-license contracts are copied into and verified in the release.
- Explicit `--bare` is never injected; it requires caller opt-in and absolute settings/MCP/plugin carriers, exact workspace/TMPDIR, and session persistence.

Must remain unchanged at the official SDK/CLI boundary:

- argv order and values;
- stdin/stdout/stderr bytes and open stdin for control/MCP callbacks;
- process cwd and non-runtime environment, including Claude config, MCP, plugin, sandbox, and credential selectors;
- all built-in authentication methods and authentication environment; the wrapper must not select, remove, disable, restrict, or log values;
- JSON/JSONL/streaming, permissions, MCP stdio/HTTP/SSE/SDK/OAuth/Resources, plugins/skills/hooks, transcript/resume, and exit semantics.

Provider-free acceptance can prove boundary preservation, the unchanged SDK 0.2.140 `cli_path` launch, both MCP regression declarations (`1.27.0`, `1.27.1`), lifecycle cleanup, Runtime manifest validation, lazy envelope imports, and release exclusions. It cannot prove a real model turn, Dream database persistence, real OAuth, or current native core internals. Those remain explicitly unclaimed.

The bounded test scope is lint, build, Node unit tests, current Dream SDK-path compatibility, provider-free acceptance, release verification, package, and reproducibility. It may break wrapper startup, management/auth forwarding, strict TMPDIR enforcement, bare opt-in validation, manifest generation, or deterministic hashes; it cannot alter the external official binary or Dream/reference checkouts.
