<!-- [Input] Credential-safe paired differential commands, official release evidence, and prior real local Dream receipts. -->
<!-- [Output] Preserve exit codes, bounded evidence, release/legal rechecks, failure/fix/retest receipts, and blockers. -->
<!-- [Pos] Current acceptance record; it claims the completed Dream and OAuth HTTP MCP lanes but not Linux or bare equivalence. -->
<!-- [Sync] 2026-08-24: add paired protocol differential, current SDK distribution, upstream/legal recheck, and non-claims. -->

# Acceptance results

Final local run date: 2026-08-24.

Current feasibility-release rerun under Node `24.13.0`: lint reported 73 repository files and 9 JSON contracts; 19 Node tests passed; current Dream `ink-claude-dream-agent-sdk==0.2.143` passed the paired direct-fake/envelope JSONL contract; provider-free acceptance passed; release verification reported 22 files and 21 checksums. Exact Node `24.13.0` reproduced archive SHA-256 `84aefad620639503614cdc93e1b1f0af8fdf60c23ed9bf352a1d0a6475c99784` and checksum-inventory SHA-256 `6619beb4e63b0b6ba9687d725de580efa2ef50a89043f9ad701ad64c1a31e2cd` twice. The immutable release-manifest SHA-256 is `e4e9a7ab19ca52166e156ef22a85418a25eb73e6a8fbfd2748d2d7aab1bb3935`.

These receipts validate only the feasibility artifact. They do not overturn `corePruned=false`, `productionEligible=false`, or the license/build-graph blockers.

## 2026-08-24 protocol and upstream recheck

The current Dream virtual environment contains `ink-claude-dream-agent-sdk==0.2.143`, which preserves the `claude_agent_sdk` import namespace; the earlier `claude-agent-sdk==0.2.140` row below remains a historical receipt. The current provider-free SDK harness sends the same JSONL payload through `SubprocessCLITransport` directly to the deterministic fake core and through the envelope. The raw paired test separately compares argv, stdin/stdout/stderr bytes, cwd, session/resume flags, MCP/plugin/tool/sandbox/workspace/auth carriers, nonzero exit, and declared SIGTERM supervision. These tests exercise carrier transparency only. They do not execute an official model turn, MCP tool/provider, OAuth refresh, Remote Control, official transcript/resume persistence, or official sandbox enforcement.

The official Darwin arm64 `2.1.241` artifact still passes the bounded direct/envelope `--help` equivalence and `--version` comparison. On this rerun, help bytes and exit matched; version median was 330.19 ms direct and 466.48 ms through the envelope, a 136.29 ms / 41.3% overhead. This sample is machine-local performance evidence, not a core loading reduction; `coreLoadingReduction=0` remains fixed.

The same-date release recheck found npm wrapper/native latest still at `2.1.241`; official GitHub `main` and `v2.1.241` both resolve to `45bdfa96ca415da92e62b6ca85a1d6e29adf3c44`, with no current core source/build/Bun graph. Official legal guidance still requires the binary to remain unmodified and run as published, and warns against using “Claude Code” as part of a customer's own product or feature name. The package remains `private: true`; its user-selected name is unchanged, but any external distribution requires legal and brand review. No new evidence permits core pruning or redistribution.

| Command | Exit | Evidence |
| --- | ---: | --- |
| `bun install --frozen-lockfile` | 0 | 9 installs across 35 packages checked; no changes |
| `bun run lint` | 0 | 69 current repository files; 9 source JSON contracts parsed; package/legal/vendor/header/toolchain gates passed |
| `bun run build` | 0 | deterministic Node 22 ESM release generated from Bun `1.2.20` lock; build receipt pins Node `24.13.0` archive packer |
| `node scripts/verify-release.mjs` | 0 | 22 files, 21 checksums, all Runtime contracts consumed, external core absent |
| `bun run test` | 0 | 19 passed, 0 failed; includes 3 paired process differentials and the built-entrypoint secure-storage marker gate |
| `bun run test:upstream-sdk` | 0 | current Dream `ink-claude-dream-agent-sdk==0.2.143` selected cli_path; direct fake and envelope each performed one version probe, one main launch, and one identical JSONL message |
| `bun run test:acceptance` | 0 | provider-free `2.1.241` fixture doctor and process boundary passed |
| `INK_ACCEPTANCE_REAL_CLAUDE=/private/tmp/.../claude bun run test:acceptance` | 0 | external official Darwin arm64 `2.1.241` passed the bounded version/doctor probe; tarball SHA-1/integrity matched npm metadata and the extracted binary SHA-256 matched tar content; no auth, prompt, model, or business call |
| direct official `--version` vs envelope `--version` | 0 | both returned `2.1.241 (Claude Code)` |
| `bun run test:mcp-matrix` | 0 | disposable SDK `0.2.143` environments passed MCP `1.27.0` and `1.27.1` initialize/ping/tools/resources/prompts/audio/structuredContent |
| `bun run package` | 0 | verified deterministic tar and SHA sidecar generated |
| `bun run test:reproducible` | 0 | two fixed-epoch, exact-Node-`24.13.0` release/archive builds matched |
| `bun run verify` | 0 | full local lint/test/SDK/acceptance/release/reproducibility chain passed |
| real Dream Playwright journey, direct official `2.1.241` | 0 | 1 passed in 2.3 minutes through the public Deck → Chat → Dream production UI and current local Dream/Admin/Gateway/PostgreSQL |
| real Dream Playwright journey, packaged Runtime envelope → official `2.1.241` | 0 | 1 passed in 2.7 minutes through the same public production path and existing actor/Deck |
| Dream backend MCP parser/driver/service/inventory/credential/keychain/router suites | 0 | 39 passed in 6.22 seconds |
| provider-free Dream MCP Resources browser regression | 0 | 1 passed in 5.0 seconds |
| real OAuth HTTP MCP Chat journey, packaged envelope → official `2.1.241` | 0 | 1 passed in 1.2 minutes: public DCR/PKCE connection, visible confirmation, persisted tool result, refresh/resume, and second persisted tool result |
| public MCP logout/remove and final list | 0 | disposable external server absent after cleanup; no credential or server identifier retained in the release |

The 19 Node tests cover paired raw JSONL/process differentials; immutable manifest isolation and environment-override resistance; exact argv/JSONL/stderr/cwd/environment forwarding; MCP/auth/help management; built-in authentication environment presence without recording values; the macOS secure-storage capability marker; version output passthrough and doctor-only pin enforcement; explicit bare profile/no injection/missing-carrier rejection; external absolute artifact path; exact TMPDIR/symlink/mode/workspace; resume/session carrier preservation; SDK skip rejection; crash; timeout; cancellation cleanup; and lazy imports.

Final provider-free timing sample under Node `24.13.0` used a fake executable, not official Claude Code: manifest median 21.28 ms, SDK version-probe median 40.59 ms, and one main-launch median 40.34 ms. The same-day unmodified Darwin arm64 official `2.1.241` differential sample measured direct `--version` at 330.19 ms median and the envelope at 466.48 ms, a 136.29 ms / 41.3% overhead. These numbers are local harness evidence only and make no production or core-loading improvement claim. The supported release target remains Node `>=22,<25`; deterministic archive packing is separately fixed to Node `24.13.0`.

Final deterministic archive SHA-256: `84aefad620639503614cdc93e1b1f0af8fdf60c23ed9bf352a1d0a6475c99784`.

Final checksum-inventory SHA-256: `6619beb4e63b0b6ba9687d725de580efa2ef50a89043f9ad701ad64c1a31e2cd`.

Observed failures and fixes before the final pass:

- Initial lint exited 1 because git inventory included a deleted tracked documentation path; lint now skips worktree-absent entries while checking all current files.
- Initial Node run had 13/14 pass because the bare fixture declared a temporary workspace but launched from repository cwd; the test helper now supplies the declared cwd, proving the production fail-closed check was correct.
- Independent audit found that `INK_CLAUDE_RUNTIME_MANIFEST_PATH` could replace the doctor trust root. Manifest loading is now release-relative and exact-version validated; a forged `2.1.240` manifest/core pair is rejected with expected `2.1.241`.
- Node `26.4.0` archive packing now exits 1 before writing because `node:zlib` output is toolchain-dependent; exact Node `24.13.0` is pinned and its repeat build/archive hashes match.

The real-business harness first exposed stale UI assumptions, a post-refresh panel-state assumption, an accidentally started ordinary Chat after asynchronous Agent selection, one stale in-memory admission lease after that aborted request, and an expected Story Index optimistic-concurrency `409` that the old harness classified as a generic failure. The harness was repaired only in `frontend/e2e/**`; the owned backend was restarted once to clear the in-memory lease, and no database row was mutated manually. Failed and successful Runs remain in the normal business database for Admin review under the real-business protocol.

Both successful lanes prove a new session, first token/SSE, multi-turn continuation, internal stdio MCP tool call/result, thread workspace, transcript persistence, resume, locked-plugin loading, Dream artifact hook output, EP01 artifacts, Story Index recovery, and durable UI re-entry. The local content-free receipts are `output/playwright/runtime-direct-2.1.241-receipt.json` and `output/playwright/runtime-envelope-2.1.241-receipt.json` in the Dream repository; they are not distribution inputs and are not committed here.

A subsequent real MCP lane used a disposable provider implemented with the
official MCP Python SDK `2.0.0` at tag commit
`6f69a3758ebf2ee55ce050f58b470ce11af71133`. It ran outside Dream and exposed
HTTP OAuth, one read-only tool, and one resource. The existing actor connected
through Dream's public OAuth endpoints, then the public Chat UI performed two
confirmed tool calls across refresh/resume. Both tool results persisted through
the normal Dream/Admin/Gateway/PostgreSQL path. Public logout/remove completed
and a final list proved the temporary server absent. No provider source,
credential, callback, tunnel identifier, transcript, or workspace body entered
the release.

That lane also found a real compatibility requirement: Dream's macOS MCP
identity gate scans the configured CLI entrypoint for
`CLAUDE_SECURESTORAGE_CONFIG_DIR`. The wrapper now advertises the marker and a
unit test asserts it survives bundling. Because the isolated identity removes
`INK_CLAUDE_CODE_EXECUTABLE`, the backend service `PATH` was pinned to the same
official `2.1.241` artifact used by the wrapper.

Not executed or claimed in this rerun: a real Dream business journey after the installed SDK distribution changed to `ink-claude-dream-agent-sdk==0.2.143`; real MCP Resources inventory/read; transient-5xx reconnect; legacy SSE add; a colon-containing user-scope server name; production sandbox behavior; Linux dynamic-library deployment; Remote Control; or bare-mode performance/business equivalence. No credential, transcript body, workspace body, complete environment, vendor executable, deployment, package publication, tag, or merge entered this repository.
