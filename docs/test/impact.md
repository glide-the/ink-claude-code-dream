<!-- [Input] Local core builder/profile/resolution changes, separate MCP compatibility layer, and unchanged Dream/SDK interface. -->
<!-- [Output] Record the tested impact, protected capabilities, completed technical/business scope, external blockers, and rollback point. -->
<!-- [Pos] Impact and qualification-scope receipt for the minimal Runtime work. -->
<!-- [Sync] 2026-08-24: record custom-core Dream acceptance and the external OAuth MCP/Admin browser blockers. -->

# Test impact record

Recorded after minimal-core technical qualification on 2026-08-24.

## Changed files and modules

- repository-authored, source-bound Bun `1.4.0` core builder/verifier;
- 89-feature capability profile and recovered-package resolution map;
- local ignored `dist/core-local` receipt/metafile/gap output;
- core-prune contract tests;
- independent MCP `2.1.238`/`2.1.239` headers/reconnect/redaction policies and patch manifest;
- architecture, build, test, and repository documentation.

The authorized `restored-src` input is read-only to this repository. Dream production code, Python SDK protocol/state implementation, schemas, databases, user data, and the official CLI are not modified by this work.

## Potentially affected capabilities

The build can break any import or side effect in the recovered source. Highest-risk protected contracts are JSONL/control, session/transcript/resume, permission/tool confirmation, Workspace/files, sandbox/TMPDIR, MCP discovery/OAuth/Resources/reconnect, plugin/Slash Skill/hook, ordinary Agent/Task, authentication, and gateway/provider behavior.

Selected removal targets are CCR/Remote Control, swarm/team UI, interactive REPL, IDE UI/auto-connect, updater command/UI, and feedback/reporting UI. Telemetry, shared diagnostics, and shared updater logic are deferred until the graph proves a safe boundary.

## Test scope and order

1. static source/digest/profile/resolution/DCE/metafile validation;
2. official-vs-custom SDK/Runtime protocol differential;
3. real Dream/Admin/Gateway/PostgreSQL business acceptance.

Layers 1 and 2 are complete for bundle SHA-256 `6904d3cd7954ead347cc5f5dd65f1313cfa78e0a080514e9efc874e51ff88893` and source digest `470ca57d6390e2f9df5e2bb0a6f32b8b62c64f262ae3d02a31349488a08c228e`: 1,989 inputs, 48 outputs, zero gaps, DCE pass, and digest-bound SDK/MCP/MCP-management/full qualification passes. Source provenance `2.1.88` and qualified CLI compatibility `2.1.241` are separate release facts. The package is reproducible and locally production-eligible under its contract. The Dream manifest gate and backend suite passed (1,954 passed, 24 skipped, 607 subtests).

Layer 3 passed for the current custom-core Dream main journey: the public UI created a real Run, streamed output, persisted three turns, resumed the same Claude session across a Runtime rebuild, and produced real Workspace/TMPDIR/sandbox/transcript/Gateway/ledger/Story evidence in the normal topology. The existing remote MCP URL returned 404 to `initialize`, so a complete real OAuth/Resources read is externally blocked; authenticated Admin UI evidence is also pending an administrator session. Historical official/envelope runs remain comparators, not substitutes for this current result.

## Rollback point

Delete ignored `dist/core-local/` and point the unchanged SDK CLI path to verified official `2.1.241`. No Dream code, database, transcript format, Workspace layout, or SDK public API rollback is required.
