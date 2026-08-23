<!-- [Input] Provider-free paired fixtures, installed Dream SDK, optional official core, and MCP matrix runner. -->
<!-- [Output] Explain repeatable differential tests, environment overrides, claims, and non-claims. -->
<!-- [Pos] Test execution and interpretation guide. -->
<!-- [Sync] 2026-08-24: add direct-fake/envelope SDK and raw process-boundary differential guidance. -->

# Test guide

Run the deterministic local suite:

```sh
bun run test
bun run test:upstream-sdk
bun run test:acceptance
node scripts/verify-release.mjs
bun run test:reproducible
```

The SDK test defaults to a sibling `ink-dream-memory` checkout and its `backend/.venv`. Override without editing files:

```sh
INK_DREAM_REPO=/path/to/ink-dream-memory \
INK_DREAM_PYTHON=/path/to/venv/bin/python \
bun run test:upstream-sdk
```

Default verification requires `ink-claude-dream-agent-sdk==0.2.143` as the only installed distribution providing the `claude_agent_sdk` namespace and fails if the official `claude-agent-sdk` distribution coexists. The earlier official `0.2.140` observation is historical evidence only and is not an accepted release-verify fallback. The harness sends one identical JSONL request through `SubprocessCLITransport` directly to the deterministic fake core and through the release selected by Dream's existing `CLAUDE_CODE_CLI_PATH` helper. It compares SDK argv, input, parsed message, cwd/environment receipt, and process counts without installing or modifying Python packages.

`bun run test` also performs a lower-level paired differential. It compares direct fake core versus envelope argv, JSONL stdin/stdout, stderr, cwd, session/resume flags, MCP/plugin/tool/sandbox/workspace/auth carriers, and nonzero exit. SIGTERM is intentionally not byte-for-byte identical: direct fixture exit is its own `0`, while the supervisor returns `128 + SIGTERM = 143` and removes the descendant process group. Envelope timeout similarly returns `124`. These are declared supervision semantics, not a core behavior change.

| Contract | Current automated evidence | Boundary |
| --- | --- | --- |
| SDK startup argv and JSONL | Same `SubprocessCLITransport` payload, direct fake vs envelope | Provider-free; not an official model response |
| raw stdin/stdout/stderr and exit | Paired bytes plus success and exit `19` | Fake core only; official `--help`/`--version` are separately compared |
| cancel, signal, timeout | SIGTERM direct/envelope differential plus envelope timeout/process-group tests | Supervision intentionally maps SIGTERM to `143` and timeout to `124` |
| session/resume | Exact `--resume` carrier and persistence-preserving gate | Does not prove official transcript storage or resume behavior |
| MCP and tools | Exact config/plugin/tool argv and selected environment carriers | Does not execute an MCP provider or tool callback |
| sandbox and workspace | Exact settings/add-dir/cwd/TMPDIR carriers and fail-closed path checks | Does not prove official sandbox enforcement |
| authentication | Built-in auth selector presence and management argv; values are not recorded | No login, token exchange, refresh, or account use |
| OAuth, Remote Control, provider/model | None in the provider-free differential | Requires authorized credentials, network/external state, and a separately scoped business test |

The networked MCP regression creates disposable temp environments, validates that the created root is a direct `ink-mcp-matrix-*` child of the OS temp directory, and removes it in `finally`; it changes no checkout:

```sh
UV_DEFAULT_INDEX=https://your-approved-pypi-mirror/simple bun run test:mcp-matrix
```

To compare a locally available verified official `2.1.241` executable:

```sh
INK_ACCEPTANCE_REAL_CLAUDE=/path/to/official/claude bun run test:official-difference
```

The real official executable comparison is deliberately limited to credential-free `--version`, `--help`, and doctor checks. A real SDK JSONL prompt, model/provider response, MCP tool execution, OAuth refresh, Remote Control, transcript/resume persistence, or sandbox enforcement requires external state and is not reproduced by the provider-free fixture. Carrier equality must not be reported as behavioral acceptance for those delegated features. See [impact](impact.md) and [acceptance results](acceptance-results.md).
