<!-- [Input] Actual original Runtime bundle, src/reference inventories and installed public SDK/fixture interpreters. -->
<!-- [Output] Current source, build and local protocol validation, including skipped/remaining lanes. -->
<!-- [Pos] Test guide for the unified original-module Runtime, not real business acceptance. -->
<!-- [Sync] 2026-09-13: retire removed implementation's tests and reuse original-source protocol harnesses. -->

# Test guide

## Original directories and modules

```sh
npm run source:verify
node --test tests/original-source-structure.test.mjs
npm run lint
npm test
```

The unique src must preserve original directory lists, module paths, bytes and
modes; restored-src must not exist. The original 1,902 files/35 module directories remain intact; added empty
directories, wrapper files and src/cleanroom are rejected.
Default build must compile repository src/entrypoints/cli.tsx.

## Actual build and protocol

Build using the [explicit recovered dependency/assets roots](../build/README.md), then:

```sh
node scripts/verify-core-prune.mjs
npm run test:acceptance
npm run test:mcp-auth-compat
npm run test:dream-compat
INK_DREAM_PYTHON=/absolute/path/to/python-with-sdk-0.2.145 \
  npm run test:upstream-sdk
INK_DREAM_PYTHON=/absolute/path/to/python-with-sdk-0.2.145 \
INK_MCP_FIXTURE_PYTHON=/absolute/path/to/python-with-mcp-2.0.0 \
  npm run test:mcp-source
INK_DREAM_PYTHON=/absolute/path/to/python-with-sdk-0.2.145 \
INK_MCP_FIXTURE_PYTHON=/absolute/path/to/python-with-mcp-2.0.0 \
  node scripts/run-unified-sdk-contract.mjs --dream-compat
npm run test:reproducible
```

The real original bundle, unmodified public Python SDK and existing local fake provider
exercise streaming/Unicode, initialization, permission callback, Bash/write/sandbox deny,
Skills/hooks/subagent, transcripts/resume/session, interrupt and MCP tools/resources.
The test MCP server uses MCP 2.0.0 and can use a separate disposable interpreter;
Dream's production MCP 1.x dependency is not upgraded. No real model or credential is used.

The candidate Dream mode compiles a disposable native `ntn`, checks canonical
private home and actual API-token/workers-field projection in sandboxed Bash,
checks command hooks and stdio MCP have no Notion credentials, and observes
max_tokens=1000 and output_config.effort=xhigh at the existing local provider.
It writes an exact bundle/source/target-bound receipt required by full qualification.

Smoke verifies version, empty MCP inventory and explicit rejection of interactive mode;
headless profile does not claim full UI or --help. Static MCP Apps characterization
preserves Marketplace pin/resource transports, but does not claim UI hosting.
The MCP auth compatibility suite replays source-bound transforms (52 tests when the
recovered root is supplied). Reproducibility compares two actual output inventories.

Original-core management/OAuth/differential harnesses remain. Two official comparator
and two pinned official OAuth pipe/PTY tests skip unless their explicit external
fixtures are supplied; skip is not a pass. Retired cleanroom/wrapper tests remain in
Git history and are not counted as validating this implementation.

## Qualification and non-claims

Static build, local protocol and real Dream business acceptance are distinct layers.
A passing fake provider or Dream manifest fixture does not prove real business,
four-host native qualification, public registry installation or publication authority.
Current results are in [0.1.9 notes](../build/runtime-0.1.9-release-notes.md).
Old immutable acceptance receipts cannot qualify current bytes. Publication and local
adoption follow the current release design; no API/database/ZIP changes are planned.
