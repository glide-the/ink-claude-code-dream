<!-- [Input] Clean-room Runtime tooling, authorized external restored source, capability profile, compatibility policies, and verification evidence. -->
<!-- [Output] Explain the qualified local minimal-core workflow, remaining business gate, legacy envelope, and safe Git/release boundary. -->
<!-- [Pos] Operator-facing entry point for ink-claude-code-dream. -->
<!-- [Sync] 2026-08-24: record the zero-gap qualified core, applied MCP patch, local package, and separate business/publication gates. -->

# ink-claude-code-dream

This private repository builds a locally packaged, IM-focused Claude Runtime named `ink-claude-code-dream`. Its primary path uses the user-authorized Claude Code `2.1.88` restored source as an external local input and Bun `1.4.0` compile-time feature DCE. Generated core and package files go only to Git-ignored `dist/core-local/` and `dist/core-package-local/`; Git stores the repository-authored, source-bound transformation builder, capability profile, resolution map, tests, manifests, and documentation. This is technical provenance, not a license conclusion.

Current technical status: **built, verified, and locally production-eligible under the repository's artifact contract**. The exact core has bundle SHA-256 `6904d3cd7954ead347cc5f5dd65f1313cfa78e0a080514e9efc874e51ff88893` and source digest `470ca57d6390e2f9df5e2bb0a6f32b8b62c64f262ae3d02a31349488a08c228e`. Its sanitized graph has 1,989 inputs, 48 outputs, zero resolution gaps, and passing DCE assertions. Source provenance remains `2.1.88`; the separately qualified Dream-facing CLI compatibility version is `2.1.241`. Digest-bound SDK, MCP protocol, and MCP management differentials passed, and `full-runtime-qualification` exited 0. The local package contains 62 files, has tree SHA-256 `90e205c41a4fcda5c4ba72a2cd84b6f82e8a7fd1b0b7055b50ea4ef7cd7f5a78`, and reproduced byte-identically twice.

This is a technical artifact decision, not a publication or deployment grant: `productionEligible=true`, while `publicationAllowed=false` and `redistributionAllowed=false`. The Dream manifest gate and backend suite passed (1,954 passed, 24 skipped, 607 subtests), and the current custom-core real Dream main journey passed. A complete real OAuth/Resources read is externally blocked by the existing MCP endpoint returning 404; authenticated Admin UI evidence is pending an administrator session.

The existing Node supervisor/envelope and its `dist/release/` receipts remain a historical process-boundary and rollback baseline. Its green tests do not prove the minimal core.

## Capability boundary

Keep: headless SDK JSON/JSONL, streaming/control/cancel, session/transcript/resume, tool use/result and permission confirmation, Workspace/cwd/files, sandbox and exact `CLAUDE_CODE_TMPDIR`, MCP stdio/HTTP/OAuth/Resources/inventory, plugins, Slash Skills, hooks, ordinary Agent/Task subagents, authentication, and gateway/provider behavior.

Remove after graph proof: CCR/Remote Control bridge, swarm/team/teammate collaboration UI, interactive Ink REPL, IDE auto-connect/UI surface, updater command/UI, and feedback/reporting command/UI.

Defer: telemetry, shared diagnostics, and shared `autoUpdater.ts` logic. A name that looks unrelated is not deletion evidence.

## Local core build

The exact external source root must be absolute, normalized, and not a symlink:

```sh
bun install --frozen-lockfile

INK_AUTHORIZED_CORE_SOURCE_ROOT=/absolute/path/to/claude-code-sourcemap/restored-src \
  bun run build:core-local

INK_AUTHORIZED_CORE_SOURCE_ROOT=/absolute/path/to/claude-code-sourcemap/restored-src \
  bun run verify:core-local
```

Both commands now complete with a zero-gap receipt for the exact source digest above. A later source, profile, transformation, or bundle hash drift must fail closed and requires fresh qualification; a DCE receipt by itself is never sufficient.

## Separate MCP compatibility layer

`compat/mcp-auth/` records repository-authored, source-bound policies/tests for the Claude Code `2.1.238` and `2.1.239` MCP deltas: trusted `headersHelper` scope/cwd and credential filtering, plus bounded transient-5xx reconnect with non-retryable 401/403 and redacted errors.

The separate patch is source-bound and applied to the qualified headless artifact; all six required transform IDs are present. Restored OAuth/DCR/PKCE/token/revoke behavior remains the base implementation, while the newer patch covers the narrowly evidenced deltas without creating a second MCP or Agent state machine. MCP protocol and management receipts are bound to the same bundle/source hashes as the SDK differential.

```sh
bun run test:mcp-auth-compat
```

## SDK and Dream integration

Dream installs `ink-claude-dream-agent-sdk==0.2.143` while keeping the upstream `claude_agent_sdk` import namespace and launcher. Official and custom Runtimes are selected through the existing absolute CLI-path injection point. No Dream business implementation is required to switch between them.

Runtime acceptance has three ordered layers:

1. static build/metafile evidence;
2. SDK/CLI protocol-level differential against official `2.1.241`;
3. real Dream/Admin/Gateway/PostgreSQL business acceptance.

The interface differential is the primary compatibility gate; UI/business coverage cannot prove every Runtime contract by itself.

## Repository and publication boundary

Local use of the restored tree is explicitly authorized for this task. That authorization does not establish public redistribution rights. Do not commit or publish restored source, derived core output, vendor maps/binaries, credentials, complete environment data, transcripts, Workspace content, or materialized plugins.

The official CLI `2.1.241` remains the current behavior comparator and direct rollback target. It is not the source of this core: the implementation is restored `2.1.88` plus the separate `2.1.238`/`2.1.239` MCP compatibility patch. The custom package business path passed its main real journey; completing real OAuth/Resources against a working endpoint and authorizing publication/deployment remain separate decisions.

See the [canonical design](docs/design/claude-code-runtime-minimalization.md), [build guide](docs/build/README.md), and [test guide](docs/test/README.md).
