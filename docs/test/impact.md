<!-- [Input] Local core builder/profile/resolution changes, separate MCP compatibility layer, and unchanged Dream/SDK interface. -->
<!-- [Output] Record the tested impact, protected capabilities, completed technical/business scope, external blockers, and rollback point. -->
<!-- [Pos] Impact and qualification-scope receipt for the minimal Runtime work. -->
<!-- [Sync] 2026-08-24: record fail-closed local installation, startup recovery, and refreshed package identity. -->
<!-- [Sync] 2026-09-13: preserve historical qualification while correcting the checked research-source and 0.1.7 boundary. -->

# Test impact record

Recorded after minimal-core technical qualification on 2026-08-24.

## Changed files and modules

- repository-authored, source-bound Bun `1.4.0` core builder/verifier;
- 89-feature capability profile and recovered-package resolution map;
- local ignored `dist/core-local` receipt/metafile/gap output;
- core-prune contract tests;
- independent MCP `2.1.238`/`2.1.239` headers/reconnect/redaction policies and patch manifest;
- source-bound headless OAuth repair and official MCP SDK `2.0.0` pipe/PTY contract;
- architecture, build, test, and repository documentation.

The authorized `restored-src` input is read-only to this repository. Dream production code, Python SDK protocol/state implementation, schemas, databases, user data, and the official CLI are not modified by this work.

## Potentially affected capabilities

The build can break any import or side effect in the recovered source. Highest-risk protected contracts are JSONL/control, session/transcript/resume, permission/tool confirmation, Workspace/files, sandbox/TMPDIR, MCP discovery/OAuth/Resources/reconnect, plugin/Slash Skill/hook, ordinary Agent/Task, authentication, and gateway/provider behavior.

Selected removal targets are CCR/Remote Control, swarm/team UI, interactive REPL, IDE UI/auto-connect, updater command/UI, and feedback/reporting UI. Telemetry, shared diagnostics, and shared updater logic are deferred until the graph proves a safe boundary.

## Test scope and order

1. static source/digest/profile/resolution/DCE/metafile validation;
2. official-vs-custom SDK/Runtime protocol differential;
3. real Dream/Admin/Gateway/PostgreSQL business acceptance.

Layers 1 and 2 are complete for bundle SHA-256 `a300fe7fb3da453e45b2f2cd7721bef1963aa991498c26a2826fef8b381161f5` and source digest `470ca57d6390e2f9df5e2bb0a6f32b8b62c64f262ae3d02a31349488a08c228e`: 1,989 inputs, 48 outputs, zero gaps, DCE pass, and digest-bound SDK real-process, stdio/HTTP MCP tools/resources, management lifecycle, and aggregate qualification exits 0. Source provenance `2.1.88` and qualified CLI compatibility `2.1.241` are separate release facts. The 62-file/61-checksum package has artifact-tree SHA-256 `b674fb04734cde23c3821ae7796f3125e96e110392f6be353c30e1e7f59b0f5b`, reproduces byte-identically twice, and records `productionEligible=true`, `publicationAllowed=false`, and `redistributionAllowed=false`. The Dream manifest gate and backend suite passed (1,954 passed, 24 skipped, 607 subtests).

The official MCP Python SDK `2.0.0` fixture at commit `6f69a3758ebf2ee55ce050f58b470ce11af71133` passed the complete OAuth CLI contract 3/3. It covers Commander no-browser behavior, a consistent port-3118 callback, separate pipe/PTY input contracts, explicit PTY stdin pause on cleanup, provider-instance DCR client-information memoization, token-save/`credentials_present` postconditions, fixed error classification, and bounded secret-free receipts. A fake `security` sentinel proves an explicit actor selector never invokes the user's macOS keychain, and `waitForExit` now handles already-exited children. The standard aggregate repository suite serializes test files because they share build artifacts and process-level fixtures; this does not reduce any individual process/protocol assertion.

The prior candidate's real Comfy run reached `token_save_completed` but then `credentials_missing`: keychain primary storage shadowed the actor plaintext fallback. The final patch makes a valid explicit `CLAUDE_SECURESTORAGE_CONFIG_DIR` authoritative and uses only its `0700` directory's `0600` `.credentials.json`; no selector preserves official keychain behavior.

Layer 3 passed for both the custom-core Dream main journey and the final real Comfy lane. Public configure/auth/callback produced a connected operation; a fresh SDK/Runtime inventory returned HTTP 200, `comfyui-cloud` `0.40.1`, and 41 tools. The complete 16-stage safe receipt ended with `credentials_present` → `flow_resolved` → `success_stdout_flushed`, with no `flow_failed`; storage modes were `0700`/`0600`. Resources and Prompts were `not_reported`.

No Comfy tool was invoked because read-only metadata did not also prove zero cost, and a normal Agent turn would consume model tokens. The three-gate charging policy correctly refused execution; this is not a functional failure. Public cancel/logout/remove and post-logout/final-list checks passed, the alias disappeared, the Chrome tab closed, sensitive QA material moved to Trash, and the QA backend stopped. Admin 3000 and PostgreSQL 54329 were left untouched. Authenticated Admin UI evidence remains unverified only because no administrator browser session was available.

The final exact-Node command `PATH=/Users/dmeck/.nvm/versions/node/v24.13.0/bin:$PATH bun run verify` exited 0: Node 44 passed / 2 external OAuth-fixture skips, MCP compatibility 46 passed / 6 authorized-source fixture skips, SDK contract, acceptance, release verification, and reproducibility passed. Archive SHA-256 is `64c919d1f11b2770497a080c4cdeb8587925f45d928912459b31647e1b68eb38`; checksum-inventory SHA-256 is `61e12c7c1828c05fb6e70535abb36ff1fbe924aaba2d78787b9ce8e832b3947c`. Historical official/envelope runs remain comparators, not substitutes for this current result.

The qualified package is now installed under content-addressed user-prefix release/toolchain directories. The PATH launcher follows its symlink to the real release root and chooses the dedicated `ink-claude-code-bun-1.4.0`; ambient Bun remains `1.2.20`. With both Runtime override variables unset, `ink-claude-code-dream --version` returned `2.1.241 (Claude Code)`, the bound MCP management contract exited 0, and Dream FastAPI reached `Application startup complete` before a clean shutdown.

The `0.1.7` correction additionally preserves the exact 1,902-file/35-directory research snapshot in Git, without rewriting upstream files or treating them as MIT. Generated artifacts remain ignored. Historical qualification above is not rebound to `0.1.7`; its release gates remain false. No Anthropic redistribution authorization has been obtained, so restored source and derived artifacts cannot be publicly published or redistributed. Dream changes for this correction are limited to project/release version metadata, its exact Runtime contract, tests, and documentation.

## Rollback point

Delete ignored `dist/core-local/` and point the unchanged SDK CLI path to verified official `2.1.241`. No Dream code, database, transcript format, Workspace layout, or SDK public API rollback is required.
