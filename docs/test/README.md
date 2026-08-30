<!-- [Input] Core build receipts, paired SDK/CLI fixtures, MCP compatibility tests, official comparator, and real Dream topology. -->
<!-- [Output] Define three ordered test layers, commands, interpretation, and non-claims. -->
<!-- [Pos] Test execution and compatibility-claim guide. -->
<!-- [Sync] 2026-08-24: record passing real Comfy OAuth/inventory acceptance and final exact-Node verification. -->
<!-- [Sync] 2026-08-30: add the Runtime 0.1.4 Notion sandbox, generated-capability, and real Dream acceptance lanes. -->
<!-- [Sync] 2026-08-30: run the authorized Runtime 0.1.4 formal five-package qualification lane. -->
<!-- [Sync] 2026-08-30: add 2.1.88 Linux seccomp asset and BPF-first passthrough evidence. -->

# Test guide

Runtime compatibility is an interface contract. A Dream business test is the third layer, not a substitute for exhaustive protocol comparison.

## Runtime 0.1.4 Notion sandbox evidence

The focused provider-free lanes are:

```sh
node --test --test-concurrency=1 \
  tests/cleanroom-notion-sandbox.test.mjs \
  tests/cleanroom-production-sandbox.test.mjs \
  tests/cleanroom-dream-bootstrap.test.mjs

node --test --test-concurrency=1 tests/cleanroom-npm-packaging.test.mjs
```

They cover source-level exact/foreign/missing/symlink cases, native-file validation, installed `ntn 0.15.1` under the real OS sandbox, a compiled Runtime and fake Messages SSE, new and resumed Runtime startup recomputation, MCP/provider-helper exclusion, and five generated capability manifests. Assertions and fixtures print only `set`/`unset` or success states; token bytes are forbidden in captured requests, frames, and stderr.

The npm lane now runs the formal five-package test. It binds the authorized version-specific Dream receipt, verifies all four native formats, reproduces and inspects the five tarballs, clean-installs the selector and host package, exercises both aliases, and enforces zero source maps. The checked policies require `productionEligible=true`, `publicationAllowed=true`, `redistributionAllowed=true`, and `npmPublishAllowed=true`; the public workflow still requires a successful main-branch qualification run for the exact publishing SHA.

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
- Linux targets contain the checksum-bound Docker-style `apply-seccomp` passthrough and architecture-matched `unix-block.bpf`, while Darwin contains neither;
- the deployment passthrough drops only the 2.1.88 leading BPF argument and rejects a missing command;
- deterministic bundle/checksum succeeds.

Current Linux x64 result: passed for source digest `470ca57d6390e2f9df5e2bb0a6f32b8b62c64f262ae3d02a31349488a08c228e` and bundle SHA-256 `a5827e0e6a1f5c3f09f5c4ceca66122893e531d3f31a644811273bae89487e9a`. The verifier binds asset source identity, digest, mode, and chunk-adjacent path; the packaged passthrough digest is `bd2923ee44c624e03bac9efb57c84d72419726783ac7557acb708e431c16d74d`. Source provenance remains `2.1.88` and CLI compatibility remains `2.1.241` as separate fields.

## Layer 2: interface-level differential

The Linux x64 SDK/Bash differential runs in a Docker container with bubblewrap namespace privileges. Official `2.1.241` is only the protocol comparator; because its embedded helper cannot be replaced in nested Docker, the reference lane alone sets `sandbox.network.allowAllUnixSockets=true`. The candidate lane does not receive that flag and exercises the restored on-disk 2.1.88 helper. Both lanes retain bubblewrap filesystem isolation, create the workspace receipt, and deny the credential read. The receipt records this setup as an allowed comparator-only difference.

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

INK_MCP_OAUTH_FIXTURE_PYTHON=/absolute/path/to/pinned/venv/bin/python \
INK_MCP_OAUTH_FIXTURE_ROOT=/absolute/path/to/python-sdk/examples/servers/simple-auth \
  bun run test:core-oauth
```

The standard full repository suite is `node --test --test-concurrency=1 tests/*.test.mjs` (the `bun run test` package command). Test files share the built artifact and process-level fixtures, so cross-file serialization avoids contention in the 500 ms lifecycle fixture and PTY resources. The individual process/protocol assertions remain unchanged, and the pipe and PTY OAuth lanes stay separate contracts.

The executable OAuth contract pins the official MCP Python SDK `2.0.0` provider at commit `6f69a3758ebf2ee55ce050f58b470ce11af71133` and passes 3/3. It proves Commander `mcp login --no-browser`, identical advertised/submitted `http://localhost:3118/callback`, no competing callback listener, and delayed token exchange in both pipe and Dream-compatible real-PTY lanes; PTY cleanup explicitly pauses stdin so the process exits deterministically. DCR client information is memoized only on the provider instance. The contract requires successful token persistence followed by `credentials_present` and covers fixed failure classifications.

When a valid explicit `CLAUDE_SECURESTORAGE_CONFIG_DIR` is set, the only credential store is that actor-owned `0700` directory's `0600` `.credentials.json`; `CLAUDE_CONFIG_DIR` remains configuration only, and the user's macOS keychain is not accessed. A fake `security` sentinel makes any accidental keychain call fail the actor-selector tests. When no secure selector is set, official keychain behavior is preserved. The helper also fixes the `waitForExit` race in which a child could exit before the listener was registered.

This selector rule was required by real-business evidence from the preceding candidate: it reached `token_save_completed` and then `credentials_missing` because macOS keychain primary storage shadowed the actor plaintext fallback. The new candidate's final real Comfy rerun passed: the 16-stage receipt ended with `credentials_present` → `flow_resolved` → `success_stdout_flushed`, contained no `flow_failed`, and the selector credential was a regular `0600` file under its `0700` directory.

The actor-local stage receipt is overwritten per login, bounded to 16 unique allowlisted stages and 4,096 bytes, and enforces directory/file modes `0700`/`0600`. It records only schema version, sequence, timestamp, and stage; server identity, URLs, callback/query values, OAuth parameters, credentials, error details, and environment values are excluded. The current SDK real-process differential, stdio/HTTP MCP tools/resources differential, management lifecycle, aggregate qualifier, and real Comfy lane all pass and bind the exact hashes above. The older envelope/fake-core suites remain historical carrier baselines rather than additional current-core proof.

## Layer 3: real Dream business acceptance

All three layers now pass for the selected Runtime scope. The real Comfy lane used public production endpoints, connected `comfyui-cloud` `0.40.1`, reported 41 tools, and cleaned up through cancel/logout/remove. Resources and Prompts were `not_reported`. No tool was called because the available metadata did not prove a zero-cost operation: some tools were marked read-only, but an ordinary Agent turn would still consume model tokens, so the three-gate charging policy correctly refused execution. This is a safety decision, not a Runtime or MCP failure. Authenticated Admin UI visibility remains unverified solely because no administrator browser session was available.

The final standard command is `PATH=/Users/dmeck/.nvm/versions/node/v24.13.0/bin:$PATH bun run verify`; it exits 0 with Node 44 passed plus 2 external OAuth-fixture skips, MCP compatibility 46 passed plus 6 authorized-source fixture skips, and the SDK contract, acceptance, release verification, and archive reproducibility passing.

Fault injection and destructive testing must remain isolated; those results are technical validation and cannot be reported as real-business acceptance.

## Interpretation and claim boundary

- Layer 1 proves what Bun included/excluded, not behavior.
- Layer 2 proves Runtime interface parity, not end-user business persistence.
- Layer 3 proves the integrated business journey, not unexercised protocol branches.
- Layers 1 and 2 establish the current technical package's local `productionEligible=true` state; they do not authorize publication, redistribution, deployment, or claim layer 3.
- Old wrapper receipts in `acceptance-results.md` remain historical baselines and do not substitute for a current-core real-business result.
- The restored source is a read-only local input; Git holds only replayable builders/patches/manifests/tests/docs, not restored source or generated artifacts. Without Anthropic redistribution authorization, neither may be publicly published or redistributed.
