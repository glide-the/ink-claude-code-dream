<!-- [Input] Digest-bound local-core qualification/package receipts, Dream validation evidence, and historical official/envelope results. -->
<!-- [Output] Record current technical and real-business acceptance without misapplying historical receipts or hiding external blockers. -->
<!-- [Pos] Current minimal-core technical acceptance record plus historical comparator evidence. -->
<!-- [Sync] 2026-08-24: record passing real Comfy OAuth/inventory acceptance, cleanup, and final exact-Node verification. -->

# Acceptance results

> Current minimal-core status (2026-08-24): static/build and interface qualification pass for bundle SHA-256 `a300fe7fb3da453e45b2f2cd7721bef1963aa991498c26a2826fef8b381161f5` built from restored `2.1.88` source digest `470ca57d6390e2f9df5e2bb0a6f32b8b62c64f262ae3d02a31349488a08c228e`. The separate `2.1.238`/`2.1.239` MCP compatibility transforms and source-bound OAuth repair are applied and bound to that artifact. Its Dream-facing CLI compatibility version is independently bound as `2.1.241`; official `2.1.241` remains the comparator/rollback, not the source implementation. Historical business receipts below remain historical; they are not relabeled as a current-core real-business pass.

Final local run date: 2026-08-24.

## Current local-core technical qualification

| Gate | Result | Bound evidence |
| --- | --- | --- |
| core build/verifier | 0 | 1,989 inputs, 48 outputs, zero gaps, DCE pass; exact source and bundle hashes above |
| SDK differential | exit 0 | real-process receipt bound to the same source/bundle hashes |
| MCP differential | exit 0 | stdio/HTTP MCP tools/resources real-process receipt bound to the same source/bundle hashes |
| MCP management | exit 0 | stdio/HTTP lifecycle, colon-containing name, identity isolation, production Dream redaction, and OAuth help/management contract |
| OAuth CLI contract | 3/3 passed | official MCP Python SDK `2.0.0` commit `6f69a3758ebf2ee55ce050f58b470ce11af71133`; source-bound, pipe, and real-PTY lanes |
| aggregate qualification | 0 | `full-runtime-qualification`, with `businessAcceptanceIncluded=false` |
| local package | passed | 62 files, 61 checksum entries; artifact-tree SHA-256 `728e758f7c7f0294d504c67805eb29453636f3f5cbfbcf49fdef9f1a5c018fb3`; two byte-identical passes |
| package policy | passed | `productionEligible=true`, `publicationAllowed=false`, `redistributionAllowed=false`; Dream manifest contract passed |
| Dream backend | 0 | 1,954 passed, 24 skipped, 607 subtests |
| Runtime process/lifecycle suite | 0 | 45 passed; includes JSONL, OAuth pipe/PTY, nonzero exit, SIGTERM, crash, timeout, cancellation, TMPDIR, and SDK skip rejection |
| Dream frontend production build | 0 | TypeScript and Vite production build completed |
| final repository verify | 0 | exact Node `24.13.0`; Node 45/45, MCP compatibility 46 passed / 6 authorized-source fixtures skipped, SDK, acceptance, release, and reproducibility passed |

The standard full repository test command serializes test files with `node --test --test-concurrency=1 tests/*.test.mjs` because they share build artifacts and process-level fixtures. The pipe and PTY lanes remain independent contracts, and individual process/protocol assertions are unchanged.

The complete local OAuth CLI contract keeps Commander `mcp login --no-browser`, advertises and submits the same `http://localhost:3118/callback`, and verifies that headless mode opens no competing callback listener. Both pipe and real-PTY lanes perform DCR, authorization callback validation, token exchange, secure persistence, and credential postcondition checks against the official provider fixture; PTY cleanup explicitly pauses stdin so the process exits deterministically. DCR client information is memoized only for the provider instance lifetime. Token save must succeed and be followed by `credentials_present`.

The preceding candidate's real Comfy run reached `token_save_completed` and then `credentials_missing`. The macOS keychain was still the primary store, while actor plaintext storage was only a fallback, so the keychain result shadowed the actor file. The final patch makes a valid explicit `CLAUDE_SECURESTORAGE_CONFIG_DIR` authoritative: credentials use only that actor-owned `0700` directory's `0600` `.credentials.json`, `CLAUDE_CONFIG_DIR` remains configuration-only, and the user's keychain is never accessed. With no selector, official keychain behavior is unchanged; an invalid selector fails closed.

The official OAuth test places a fake `security` sentinel on the actor-selector path and fails if macOS `security` is invoked. It also repairs the `waitForExit` listener race for processes that already exited. These tests pass, and the final real Comfy rerun for bundle `a300fe7fb3da453e45b2f2cd7721bef1963aa991498c26a2826fef8b381161f5` independently passed through Dream's public production endpoints.

The OAuth failure path maps provider, OAuth, validation, parse, network, timeout, missing-client-information, missing-secret, unsupported-auth, missing-verifier, missing-redirect, save, and missing-credential conditions into fixed safe stages. The receipt is actor-local, overwritten per login, capped at 16 unique allowlisted stages and 4,096 bytes, and mode-locked to `0700`/`0600`. It records only schema, sequence, timestamp, and stage; server identity, URLs, callback/query values, OAuth parameters, credentials, environment values, and error details are excluded. Both the local fixture contract and final real Comfy acceptance pass.

## Current custom-core real-business acceptance

The normal local Dream, Admin, Gateway, and Admin-managed PostgreSQL topology was exercised through public production entrypoints with the existing account `dmeck123@suoxya.com` and the existing enabled Deck `剧本创作团队`. Dream resolved `ink-claude-dream-agent-sdk==0.2.143` with the official distribution absent, and resolved the packaged `ink-claude-code-dream` from its default `PATH` contract. The CLI reported the qualified compatibility version `2.1.241`; the manifest continued to record source provenance `2.1.88`.

| Evidence | Result |
| --- | --- |
| headed Playwright Dream journey | exit 0; `1 passed (2.0m)` |
| Run | `run_0fd5bc49e4b24e7d829efbe7ac675d80`; confirmed; no error |
| Thread / Claude session | `4c9754ac-78e7-5680-b062-58f376d63480` / `5089a8bf-35e0-4e76-ae2c-fb65638462bd` |
| stream and resume | three user plus three assistant turns persisted; the post-rebuild third turn retained the same Thread and Claude session; UI re-entry showed the stopped Thread with zero diagnostics |
| Gateway and ledger | post-rebuild request `req_1a3186ffc2c94ccfa791232bc19e01da` settled/succeeded/streaming/HTTP 200; first token 4,715 ms; total 6,881 ms; reserve/capture/release present. The initial five requests also settled/succeeded with non-empty first-token evidence and complete ledger triplets |
| Workspace/runtime boundary | thread workspace present; `.claude-tmp` normalized under it, mode `0700`, non-symlink, exact sandbox write allowance; sandbox enabled and unsandboxed commands disabled; transcript UUID matched the stable Claude session; six run-private artifact files |
| Admin-owned data | Story `aeceb725-6b2b-564d-a032-a46a468de5fc` in the same real PostgreSQL, linked to the Run, artifact available/indexed; review state unchanged |
| unchanged facts | existing Deck/entity content hashes unchanged; only the new Run/Thread/Story/Gateway/ledger records were added and retained for review |

The journey initially exposed a real interface bug: the custom core reported its source version `2.1.88`, so Dream correctly rejected headless MCP management. The release contract now separates `sourceVersionEvidence=2.1.88` from `cliCompatibilityVersion=2.1.241`; all digest-bound differentials and package receipts were regenerated, the Dream endpoint moved from 503 to 200, and the real journey then passed.

### Final real Comfy OAuth and inventory acceptance

The existing actor `dmeck123@suoxya.com` configured alias `comfy-secstore-qa-0824-02` entirely through public production endpoints. No database bypass or credential injection was used.

| Evidence | Result |
| --- | --- |
| configure/auth | public configure HTTP 201; public auth HTTP 202 |
| consent | Chrome Dev opened the existing Personal Workspace consent surface |
| callback/operation | callback POST HTTP 200; operation `connected`; `error=null` |
| safe receipt | exactly 16 stages; ended `credentials_present` → `flow_resolved` → `success_stdout_flushed`; no `flow_failed` |
| storage boundary | receipt directory/file modes `0700`/`0600`; selector credential was a regular `0600` file under the actor selector directory |
| fresh public inventory | separate fresh SDK/Runtime process returned HTTP 200 and `connected`; server `comfyui-cloud` version `0.40.1`; 41 tools; Resources and Prompts `not_reported` |
| charged execution gate | no tool invoked: some tools were `read_only`, but no zero-cost metadata was present and an ordinary Agent turn would consume model tokens; the three-gate charging policy refused execution |
| public cleanup | cancel HTTP 200; logout HTTP 200; fresh post-logout inventory `needs_auth` with zero tools; remove HTTP 200; final list proved the alias absent |
| local cleanup | Chrome tab closed; receipt and sensitive QA temporary directories moved to Trash; QA backend stopped |
| untouched services | Admin port 3000 and PostgreSQL port 54329 were not stopped or mutated |

The refusal to invoke a tool is the expected financial-safety outcome, not a Runtime, OAuth, inventory, or MCP failure. Authenticated Admin UI evidence remains the one separate acceptance gap: Admin stayed online, but no existing administrator browser session or credential was available, so UI visibility was not bypassed or claimed.

The earlier custom-core main-journey Run and logs remain retained for normal review. QA-owned Dream/Vite services from that journey were stopped after the run; the final Comfy-specific QA backend was also stopped after cleanup.

## Final repository verification

`PATH=/Users/dmeck/.nvm/versions/node/v24.13.0/bin:$PATH bun run verify` exited 0. Node tests passed 45/45; MCP compatibility reported 46 passed and 6 authorized-source fixtures skipped; the SDK contract, acceptance, release verification, and archive reproducibility all passed. The separate explicit-source command `INK_AUTHORIZED_CORE_SOURCE_ROOT=/Users/dmeck/project/claude-code-sourcemap/restored-src bun --cwd compat/mcp-auth test` then ran all source-bound cases: 52 passed, 0 failed, 230 assertions.

Final deterministic archive SHA-256: `64c919d1f11b2770497a080c4cdeb8587925f45d928912459b31647e1b68eb38`.

Final checksum-inventory SHA-256: `61e12c7c1828c05fb6e70535abb36ff1fbe924aaba2d78787b9ce8e832b3947c`.

## Historical official/envelope baseline

The feasibility-release rerun under Node `24.13.0` recorded: lint and 9 JSON-contract checks passed; 19 Node tests passed; Dream `ink-claude-dream-agent-sdk==0.2.143` passed the paired direct-fake/envelope JSONL contract; provider-free acceptance passed; release verification reported 22 files and 21 checksums. Exact Node `24.13.0` reproduced archive SHA-256 `84aefad620639503614cdc93e1b1f0af8fdf60c23ed9bf352a1d0a6475c99784` and checksum-inventory SHA-256 `6619beb4e63b0b6ba9687d725de580efa2ef50a89043f9ad701ad64c1a31e2cd` twice. The immutable release-manifest SHA-256 is `e4e9a7ab19ca52166e156ef22a85418a25eb73e6a8fbfd2748d2d7aab1bb3935`.

The receipts in this historical section validate only the earlier feasibility envelope and official comparator lanes. Current-core technical claims come only from the digest-bound qualification and OAuth CLI sections above.

## 2026-08-24 protocol and upstream recheck

The current Dream virtual environment contains `ink-claude-dream-agent-sdk==0.2.143`, which preserves the `claude_agent_sdk` import namespace. The current provider-free SDK harness sends the same JSONL payload through `SubprocessCLITransport` directly to the deterministic fake core and through the envelope. The raw paired test separately compares argv, stdin/stdout/stderr bytes, cwd, session/resume flags, MCP/plugin/tool/sandbox/workspace/auth carriers, nonzero exit, and declared SIGTERM supervision. These tests exercise carrier transparency only. They do not execute an official model turn, MCP tool/provider, OAuth refresh, Remote Control, official transcript/resume persistence, or official sandbox enforcement.

The official Darwin arm64 `2.1.241` artifact still passes the bounded direct/envelope `--help` equivalence and `--version` comparison. On this rerun, help bytes and exit matched; version median was 330.19 ms direct and 466.48 ms through the envelope, a 136.29 ms / 41.3% overhead. This sample is machine-local performance evidence, not a core loading reduction; `coreLoadingReduction=0` remains fixed.

The same-date release recheck found npm wrapper/native latest still at `2.1.241`; official GitHub `main` and `v2.1.241` both resolve to `45bdfa96ca415da92e62b6ca85a1d6e29adf3c44`, with no public current core source/build/Bun graph. The user subsequently authorized the local `2.1.88` restored tree as a reference/build input. That changes the local implementation path but does not retroactively validate this envelope run or grant public redistribution rights; derived core output remains Git-ignored and local-only.

| Command | Exit | Evidence |
| --- | ---: | --- |
| `bun install --frozen-lockfile` | 0 | 9 installs across 35 packages checked; no changes |
| `bun run lint` | 0 | repository headers plus 9 source JSON contracts parsed; package/legal/vendor/header/toolchain gates passed at that historical revision |
| `bun run build` | 0 | deterministic Node 22 ESM release generated from Bun `1.2.20` lock; build receipt pins Node `24.13.0` archive packer |
| `node scripts/verify-release.mjs` | 0 | 22 files, 21 checksums, all Runtime contracts consumed, external core absent |
| `bun run test` | 0 | 19 passed, 0 failed; includes 3 paired process differentials and the built-entrypoint secure-storage marker gate |
| `bun run test:upstream-sdk` | 0 | current Dream `ink-claude-dream-agent-sdk==0.2.143` selected cli_path; direct fake and envelope each performed one version probe, one main launch, and one identical JSONL message |
| `bun run test:acceptance` | 0 | provider-free `2.1.241` fixture doctor and process boundary passed |
| `INK_ACCEPTANCE_REAL_CLAUDE=/private/tmp/.../claude bun run test:acceptance` | 0 | external official Darwin arm64 `2.1.241` passed the bounded version/doctor probe; tarball SHA-1/integrity matched npm metadata and the extracted binary SHA-256 matched tar content; no auth, prompt, model, or business call |
| direct official `--version` vs envelope `--version` | 0 | both returned `2.1.241 (Claude Code)` |
| `bun run test:mcp-matrix` | 0 | disposable SDK `0.2.143` environments passed Python MCP package `1.27.0` and `1.27.1` initialize/ping/tools/resources/prompts/audio/structuredContent; this version axis is unrelated to Claude Code `2.1.238`/`2.1.239` patch wiring |
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

Historical envelope deterministic archive SHA-256: `84aefad620639503614cdc93e1b1f0af8fdf60c23ed9bf352a1d0a6475c99784`.

Historical envelope checksum-inventory SHA-256: `6619beb4e63b0b6ba9687d725de580efa2ef50a89043f9ad701ad64c1a31e2cd`.

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

Not executed or claimed in that historical rerun: a real Dream business journey after the installed SDK distribution changed to `ink-claude-dream-agent-sdk==0.2.143`; explicit Slash Skill execution; ordinary Agent/Task projection; real MCP Resources inventory/read; transient-5xx reconnect; legacy SSE add; a colon-containing user-scope server name; production sandbox behavior; Linux dynamic-library deployment; Remote Control; or bare-mode performance/business equivalence. The current sections above now provide independent custom-core technical, complete local OAuth CLI/provider-fixture, main-journey, and passing real Comfy evidence. No credential, transcript body, workspace body, complete environment, deployment, package publication, tag, or merge entered this repository.

## Repository and license receipt

The restored `2.1.88` source is a read-only local input. This repository commits only replayable repository-authored build tooling, patches, manifests, tests, and documentation; it does not commit the restored source or generated artifact. No Anthropic redistribution authorization has been obtained. Therefore neither restored source nor derived artifact may be publicly published or redistributed, matching `publicationAllowed=false` and `redistributionAllowed=false`.
