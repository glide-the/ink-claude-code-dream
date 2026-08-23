<!-- [Input] Commands executed on 2026-08-23 and their bounded, credential-free outputs. -->
<!-- [Output] Preserve pass/failure/fix/retest receipts and performance limitations. -->
<!-- [Pos] Human-readable executable acceptance record. -->

# Acceptance results

Final pre-document implementation runs:

- Build/release verification: exit 0; 15 release files, 14 checksum entries, executable confined/executable, SDK unchanged, external core absent.
- Node tests: 12 passed, 0 failed. Covered manifest isolation, opaque JSONL/env/argv, MCP management, exact version diagnostics, TMPDIR, resume/interactive classification, SDK skip rejection, crash, timeout, cancellation cleanup, and dynamic imports.
- Existing SDK/Dream path: exit 0 with SDK `0.2.140`; `CLAUDE_CODE_CLI_PATH` selected the wrapper; upstream transport directly executed its shebang; one version core start and one main core start; one NDJSON message preserved.
- MCP public-package matrix: `1.27.0` and `1.27.1` both passed initialize, ping, tools/list, tools/call, resources/list, prompts/list, audio and structuredContent; the runner validates and removes its own temp root in `finally`.
- Reproducibility: two fixed-epoch builds produced identical archive and inventory digests.

Performance on one macOS arm64 host with official `2.1.235`: direct `--version` median 47.64 ms; envelope direct-shebang median 71.86 ms; delta +24.22 ms / +50.8%. Nine final samples per path after warm-up. Official versus envelope `--help` exit/stdout/stderr digests matched. This result is not generalized to Linux and no RSS improvement is claimed.

Final deterministic archive SHA-256: `a7ca239348d87eed9a45a6d1342df3c48dcc7f3024fe2a1602e3563a9c8cb821`; checksum inventory SHA-256: `154e1e68cd2ee99d6ceffdf0a9941d3063b449fe0ef863778cbca268e6304627`.

Observed failures before retest:

- Default npm registry connection refused; a reachable registry completed Bun install and generated the lock.
- Cross-SDK runner resolved a venv symlink to bare Python; preserving the venv executable fixed missing packages.
- Initial PyPI MCP fetch returned an invalid content type; the single allowed mirror retry succeeded.

No credentials, model call, live OAuth, user MCP configuration, or Dream database was touched.
