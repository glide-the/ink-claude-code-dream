<!-- [Input] Bounded credential-free commands executed for the 2.1.241/SDK 0.2.143 clean-room baseline. -->
<!-- [Output] Preserve exit codes, bounded evidence, failure/fix/retest receipts, hashes, and untested blockers. -->
<!-- [Pos] Current local acceptance record; it does not claim real provider, OAuth, or Dream business E2E. -->

# Acceptance results

Final local run date: 2026-08-23.

| Command | Exit | Evidence |
| --- | ---: | --- |
| `bun install --frozen-lockfile` | 0 | 9 installs across 35 packages checked; no changes |
| `bun run lint` | 0 | 69 current inventory entries; 8 source JSON contracts parsed; package/legal/vendor/header gates passed |
| `bun run build` | 0 | deterministic Node 22 ESM release generated from Bun `1.2.20` lock |
| `node scripts/verify-release.mjs` | 0 | 20 files, 19 checksums, all five contracts consumed, external core absent |
| `bun run test` | 0 | 14 passed, 0 failed |
| `bun run test:upstream-sdk` | 0 | current Dream SDK `0.2.140` selected cli_path; one version probe, one main launch, one JSONL message |
| `bun run test:acceptance` | 0 | provider-free `2.1.241` fixture doctor and process boundary passed |
| `INK_ACCEPTANCE_REAL_CLAUDE=/private/tmp/.../claude bun run test:acceptance` | 0 | external, unmodified official `2.1.241` passed the bounded version/doctor probe; no auth, prompt, model, or business call |
| direct official `--version` vs envelope `--version` | 0 | both returned `2.1.241 (Claude Code)` |
| `bun run package` | 0 | verified deterministic tar and SHA sidecar generated |
| `bun run test:reproducible` | 0 | two fixed-epoch release/archive builds matched |
| `bun run verify` | 0 | full local lint/test/SDK/acceptance/release/reproducibility chain passed |

The 14 Node tests cover manifest isolation; exact argv/JSONL/stderr/cwd/environment forwarding; MCP/auth/help management; built-in authentication environment presence without recording values; version output passthrough and doctor-only pin enforcement; explicit bare profile/no injection/missing-carrier rejection; external absolute artifact path; exact TMPDIR/symlink/mode/workspace; resume/session persistence; SDK skip rejection; crash; timeout; cancellation cleanup; and lazy imports.

Final provider-free timing sample reported by the Bun-launched test process under Node `26.4.0` used a fake executable, not official Claude Code: manifest median 26.32 ms, SDK version-probe median 51.67 ms, and one main-launch median 51.34 ms. These numbers are harness overhead evidence only and make no production or core-loading improvement claim. The supported release target remains the declared Node `>=22,<25` range and requires a matching target-runtime validation before deployment.

Final deterministic archive SHA-256: `8152b0297bbf57410e81733d021e1da653955feb808fbbdc0894c51006906a24`.

Final checksum-inventory SHA-256: `37a6b96cb7f25d336f7bdb1c783e8ab13d361838aa0ef25460b1bc435a912804`.

Observed failures and fixes before the final pass:

- Initial lint exited 1 because git inventory included a deleted tracked documentation path; lint now skips worktree-absent entries while checking all current files.
- Initial Node run had 13/14 pass because the bare fixture declared a temporary workspace but launched from repository cwd; the test helper now supplies the declared cwd, proving the production fail-closed check was correct.

The real official `2.1.241` check was deliberately limited to `--version` and the envelope doctor. Not executed or claimed: SDK `0.2.143` through live Dream, provider/model calls, real SSE/database/transcript persistence, real OAuth/keychain, MCP remote 5xx reconnect, plugin/skill/hook semantics, production sandbox, Linux dynamic-library compatibility, or bare-mode performance/business equivalence. No credentials, user transcript, workspace content, complete environment, deployment, or package publication was touched.
