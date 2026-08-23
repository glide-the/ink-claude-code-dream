<!-- [Input] Core build receipts, paired SDK/CLI fixtures, MCP compatibility tests, official comparator, and real Dream topology. -->
<!-- [Output] Define three ordered test layers, commands, interpretation, and non-claims. -->
<!-- [Pos] Test execution and compatibility-claim guide. -->
<!-- [Sync] 2026-08-24: record completed static/interface gates and keep current-core real business QA explicit. -->

# Test guide

Runtime compatibility is an interface contract. A Dream business test is the third layer, not a substitute for exhaustive protocol comparison.

## Layer 1: static and build evidence

```sh
node --test tests/core-prune-contract.test.mjs

INK_AUTHORIZED_CORE_SOURCE_ROOT=/absolute/path/to/claude-code-sourcemap/restored-src \
  bun run verify:core-local
```

Required result before moving on:

- source digest and Bun/profile pins match;
- all 89 features have dispositions;
- `resolution-gaps.json` has zero edge and unique gaps;
- selected CCR/daemon/background/template/BYOC/self-hosted inputs are absent;
- streaming/control/resume/tools/permissions/Workspace/sandbox/TMPDIR/MCP/extensions/auth inputs are present;
- deterministic bundle/checksum succeeds.

Current result: passed for source digest `470ca57d6390e2f9df5e2bb0a6f32b8b62c64f262ae3d02a31349488a08c228e` and bundle SHA-256 `6904d3cd7954ead347cc5f5dd65f1313cfa78e0a080514e9efc874e51ff88893`. The graph has 1,989 inputs, 48 outputs, zero gaps, and passing DCE assertions. The receipt independently binds source provenance `2.1.88` and CLI compatibility `2.1.241`.

## Layer 2: interface-level differential

Send identical inputs through the custom SDK to:

1. verified official Claude CLI `2.1.241`;
2. the local minimal Runtime.

Compare at least:

| Contract | Required comparison |
| --- | --- |
| process | argv order, cwd, selected environment carriers, stdin lifetime, stdout/stderr bytes/DTOs, exit/signal/timeout |
| stream | init/session ID, partials, content blocks, result/error, SSE projection |
| control | permission callback, tool confirmation, cancel, logout |
| persistence | transcript write, multi-turn, resume, workspace/plugin metadata restore |
| tools | built-in/file/MCP tool use and result, safe error DTOs |
| workspace | exact cwd, file tools, sandbox enforcement, `CLAUDE_CODE_TMPDIR` 0700/no-symlink boundary |
| MCP | stdio, HTTP, OAuth, Resources, inventory, plugin scope, colon-containing name, transient-5xx reconnect |
| extensions | plugin, Slash Skill, hooks, ordinary Agent/Task subagents |
| auth/provider | built-in auth/gateway behavior without logging credentials |

Any intentional delta must be documented with evidence and an explicit rollback. Exit code 0 or a matching final message alone is insufficient.

The existing commands remain useful for the legacy envelope and provider-free carrier baseline:

```sh
bun run test
bun run test:upstream-sdk
bun run test:acceptance
INK_ACCEPTANCE_REAL_CLAUDE=/path/to/official/claude bun run test:official-difference
bun run test:mcp-matrix
bun run test:mcp-auth-compat
```

The current real-process SDK differential, MCP differential, MCP management receipt, and aggregate qualification all pass and bind the exact hashes above. OAuth help/management behavior is covered; a complete real OAuth browser login is deliberately outside that technical receipt. The older envelope/fake-core suites remain historical carrier baselines rather than additional current-core proof.

## Layer 3: real Dream business acceptance

Layers 1 and 2 now pass. If real-business acceptance is selected, use the normal local Dream, Admin, Gateway, and current PostgreSQL through public production entrypoints. Use the specified existing account and Deck. Verify new session, first token, multi-turn, resume, SSE, tool use/result, Workspace files, sandbox, transcript, MCP stdio/HTTP/OAuth/Resources, plugin/Slash Skill/hook, Agent/Task, cancel, timeout, Runtime abnormal exit, persistence, token settlement, and Admin visibility.

Fault injection and destructive testing must remain isolated; those results are technical validation and cannot be reported as real-business acceptance.

## Interpretation and claim boundary

- Layer 1 proves what Bun included/excluded, not behavior.
- Layer 2 proves Runtime interface parity, not end-user business persistence.
- Layer 3 proves the integrated business journey, not unexercised protocol branches.
- Layers 1 and 2 establish the current technical package's local `productionEligible=true` state; they do not authorize publication, redistribution, deployment, or claim layer 3.
- Old wrapper receipts in `acceptance-results.md` remain historical baselines and do not substitute for a current-core real-business result.
