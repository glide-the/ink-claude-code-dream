<!-- [Input] Provider-free fixtures, upstream SDK/Dream sibling checkout, optional official core, and MCP matrix runner. -->
<!-- [Output] Explain repeatable tests, environment overrides, claims, and non-claims. -->
<!-- [Pos] Test execution and interpretation guide. -->

# Test guide

Run the deterministic local suite:

```sh
bun run test
bun run test:upstream-sdk
bun run test:acceptance
node scripts/verify-release.mjs
bun run test:reproducible
```

The upstream test defaults to a sibling `ink-dream-memory` checkout and its `backend/.venv`. Override without editing files:

```sh
INK_DREAM_REPO=/path/to/ink-dream-memory \
INK_DREAM_PYTHON=/path/to/venv/bin/python \
bun run test:upstream-sdk
```

It records current Dream compatibility with SDK `0.2.140`, directly executes the release shebang through Dream's existing `CLAUDE_CODE_CLI_PATH` helper, and does not install or modify Python packages. Upstream design baseline is SDK `0.2.143`/CLI `2.1.241`; its real Dream business validation is outside this bounded local suite.

The networked MCP regression creates disposable temp environments, validates that the created root is a direct `ink-mcp-matrix-*` child of the OS temp directory, and removes it in `finally`; it changes no checkout:

```sh
UV_DEFAULT_INDEX=https://your-approved-pypi-mirror/simple bun run test:mcp-matrix
```

To compare a locally available verified official `2.1.241` executable:

```sh
INK_ACCEPTANCE_REAL_CLAUDE=/path/to/official/claude bun run test:official-difference
```

Provider-free tests prove process-boundary behavior, not real model/OAuth/Dream persistence. See [impact](impact.md) and [acceptance results](acceptance-results.md).
