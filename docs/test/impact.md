<!-- [Input] Compatibility envelope, current Dream SDK distribution, official CLI 2.1.241, and paired provider-free evidence. -->
<!-- [Output] Record the impact surface and explicit differential-test boundaries before executable validation. -->
<!-- [Pos] Pre-test change-impact receipt for the minimal runtime release. -->
<!-- [Sync] 2026-08-24: add paired SDK/raw-boundary differential scope and current installed SDK distribution. -->

# Test impact record

Recorded before the first build/test run on 2026-08-23.

Updated before the `2.1.241`/SDK `0.2.143` clean-room run on 2026-08-23. Rollback point is branch base `26edc45f89a8`; no vendor/reference repository is writable in this task.

Changed surface:

- New Node 22 compatibility envelope executable; it does not replace or rewrite Claude Code stream-json/control framing.
- Runtime-owned release/evidence manifests; neither is an SDK handshake or an SDK-parsed schema.
- New fail-closed `CLAUDE_CODE_TMPDIR` validation for formal launches.
- New process-group signal, optional timeout, crash exit, and cleanup behavior around the official child.
- New Bun-managed deterministic build, split dynamic imports, source maps, checksums, SBOM, platform pins, and immutable release directory.
- Current locked baseline is external official Claude Code `2.1.241` and `ink-claude-dream-agent-sdk==0.2.143`; the earlier official SDK `0.2.140` run remains only in explicit historical receipts.
- Version/help/MCP/auth commands now pass through exactly; only `--runtime-doctor` enforces the deployment pin.
- Legal, external-artifact, entrypoint, Runtime-data, bare-profile, and dependency-license contracts are copied into and verified in the release.
- Explicit `--bare` is never injected; it requires caller opt-in and absolute settings/MCP/plugin carriers, exact workspace/TMPDIR, and session persistence.
- Paired provider-free tests now send the same raw and SDK JSONL request directly to the fake core and through the envelope; current Dream provides `ink-claude-dream-agent-sdk==0.2.143` under the unchanged `claude_agent_sdk` namespace.

Must remain unchanged at the official SDK/CLI boundary:

- argv order and values;
- stdin/stdout/stderr bytes and open stdin for control/MCP callbacks;
- process cwd and non-runtime environment, including Claude config, MCP, plugin, sandbox, and credential selectors;
- all built-in authentication methods and authentication environment; the wrapper must not select, remove, disable, restrict, or log values;
- JSON/JSONL/streaming, permissions, MCP stdio/HTTP/SSE/SDK/OAuth/Resources, plugins/skills/hooks, transcript/resume, and exit semantics.

Provider-free acceptance can prove paired boundary preservation, the installed compatible SDK `cli_path` launch, both MCP regression declarations (`1.27.0`, `1.27.1`), lifecycle cleanup, Runtime manifest validation, lazy envelope imports, and release exclusions. Carrier forwarding does not prove a real model turn, official-core session/resume persistence, MCP tool behavior, sandbox enforcement, Dream database persistence, OAuth/Remote behavior, or current native core internals. Those remain explicitly unclaimed.

The bounded test scope is lint, build, Node unit tests, current Dream SDK-path compatibility, provider-free acceptance, release verification, package, and reproducibility. It may break wrapper startup, management/auth forwarding, strict TMPDIR enforcement, bare opt-in validation, manifest generation, or deterministic hashes; it cannot alter the external official binary or Dream/reference checkouts.
