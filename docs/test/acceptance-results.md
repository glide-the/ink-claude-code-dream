<!-- [Input] Credential-safe commands and the real local Dream business journey for the 2.1.241/SDK baseline. -->
<!-- [Output] Preserve exit codes, bounded evidence, failure/fix/retest receipts, hashes, and explicit blockers. -->
<!-- [Pos] Current acceptance record; it claims the completed Dream lanes but not remote OAuth/MCP, Linux, or bare equivalence. -->

# Acceptance results

Final local run date: 2026-08-23.

| Command | Exit | Evidence |
| --- | ---: | --- |
| `bun install --frozen-lockfile` | 0 | 9 installs across 35 packages checked; no changes |
| `bun run lint` | 0 | 64 current inventory entries; 8 source JSON contracts parsed; package/legal/vendor/header/toolchain gates passed |
| `bun run build` | 0 | deterministic Node 22 ESM release generated from Bun `1.2.20` lock; build receipt pins Node `24.13.0` archive packer |
| `node scripts/verify-release.mjs` | 0 | 20 files, 19 checksums, all five contracts consumed, external core absent |
| `bun run test` | 0 | 14 passed, 0 failed |
| `bun run test:upstream-sdk` | 0 | current Dream SDK `0.2.140` selected cli_path; one version probe, one main launch, one JSONL message |
| `bun run test:acceptance` | 0 | provider-free `2.1.241` fixture doctor and process boundary passed |
| `INK_ACCEPTANCE_REAL_CLAUDE=/private/tmp/.../claude bun run test:acceptance` | 0 | external official Darwin arm64 `2.1.241` passed the bounded version/doctor probe; tarball SHA-1/integrity matched npm metadata and the extracted binary SHA-256 matched tar content; no auth, prompt, model, or business call |
| direct official `--version` vs envelope `--version` | 0 | both returned `2.1.241 (Claude Code)` |
| `bun run test:mcp-matrix` | 0 | disposable SDK `0.2.143` environments passed MCP `1.27.0` and `1.27.1` initialize/ping/tools/resources/prompts/audio/structuredContent |
| `bun run package` | 0 | verified deterministic tar and SHA sidecar generated |
| `bun run test:reproducible` | 0 | two fixed-epoch, exact-Node-`24.13.0` release/archive builds matched |
| `bun run verify` | 0 | full local lint/test/SDK/acceptance/release/reproducibility chain passed |
| real Dream Playwright journey, direct official `2.1.241` | 0 | 1 passed in 2.3 minutes through the public Deck → Chat → Dream production UI and current local Dream/Admin/Gateway/PostgreSQL |
| real Dream Playwright journey, packaged Runtime envelope → official `2.1.241` | 0 | 1 passed in 2.7 minutes through the same public production path and existing actor/Deck |

The 14 Node tests cover immutable manifest isolation and environment-override resistance; exact argv/JSONL/stderr/cwd/environment forwarding; MCP/auth/help management; built-in authentication environment presence without recording values; version output passthrough and doctor-only pin enforcement; explicit bare profile/no injection/missing-carrier rejection; external absolute artifact path; exact TMPDIR/symlink/mode/workspace; resume/session persistence; SDK skip rejection; crash; timeout; cancellation cleanup; and lazy imports.

Final provider-free timing sample under Node `24.13.0` used a fake executable, not official Claude Code: manifest median 21.12 ms, SDK version-probe median 40.04 ms, and one main-launch median 41.09 ms. The final unmodified Darwin arm64 official `2.1.241` differential sample measured direct `--version` at 59.55 ms median and the envelope at 83.64 ms, a 24.09 ms / 40.5% overhead. These numbers are local harness evidence only and make no production or core-loading improvement claim. The supported release target remains Node `>=22,<25`; deterministic archive packing is separately fixed to Node `24.13.0`.

Final deterministic archive SHA-256: `5c77dee6a36d5f7f7e01e044fa36b529e4d3a4d36f6076532747a269a9f5058d`.

Final checksum-inventory SHA-256: `1bbc0253b48cee8822bd4828506c96bcde4dfd713d06e06ee77d48ff58c30ea1`.

Observed failures and fixes before the final pass:

- Initial lint exited 1 because git inventory included a deleted tracked documentation path; lint now skips worktree-absent entries while checking all current files.
- Initial Node run had 13/14 pass because the bare fixture declared a temporary workspace but launched from repository cwd; the test helper now supplies the declared cwd, proving the production fail-closed check was correct.
- Independent audit found that `INK_CLAUDE_RUNTIME_MANIFEST_PATH` could replace the doctor trust root. Manifest loading is now release-relative and exact-version validated; a forged `2.1.240` manifest/core pair is rejected with expected `2.1.241`.
- Node `26.4.0` archive packing now exits 1 before writing because `node:zlib` output is toolchain-dependent; exact Node `24.13.0` is pinned and its repeat build/archive hashes match.

The real-business harness first exposed stale UI assumptions, a post-refresh panel-state assumption, an accidentally started ordinary Chat after asynchronous Agent selection, one stale in-memory admission lease after that aborted request, and an expected Story Index optimistic-concurrency `409` that the old harness classified as a generic failure. The harness was repaired only in `frontend/e2e/**`; the owned backend was restarted once to clear the in-memory lease, and no database row was mutated manually. Failed and successful Runs remain in the normal business database for Admin review under the real-business protocol.

Both successful lanes prove a new session, first token/SSE, multi-turn continuation, internal stdio MCP tool call/result, thread workspace, transcript persistence, resume, locked-plugin loading, Dream artifact hook output, EP01 artifacts, Story Index recovery, and durable UI re-entry. The local content-free receipts are `output/playwright/runtime-direct-2.1.241-receipt.json` and `output/playwright/runtime-envelope-2.1.241-receipt.json` in the Dream repository; they are not distribution inputs and are not committed here.

Not executed or claimed: a Dream application upgrade from its current SDK `0.2.140` to `0.2.143`; real remote HTTP MCP/OAuth/logout/Resources/5xx reconnect because the selected actor has no configured remote MCP server; production sandbox behavior because the accepted Deck did not prove sandbox enablement; Linux dynamic-library deployment; or bare-mode performance/business equivalence. No credential, transcript body, workspace body, complete environment, vendor executable, deployment, package publication, tag, or merge entered this repository.
