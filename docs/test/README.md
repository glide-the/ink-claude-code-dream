<!-- [Sync] 2026-10-12: public 0.1.12 adopted; six normal image/Token, settings and 19-image reopen/hash observed; image-inflight cancel remains unverified. -->
<!-- [History] Candidate-stage Sync below records prior pending gates; current status is in the final section. -->
<!-- [Sync] 2026-10-11: 0.1.12 compact-image candidate; original src and published 0.1.11 remain immutable, release/adoption pending. -->
<!-- [Input] Actual original Runtime bundle, src/reference inventories and installed public SDK/fixture interpreters. -->
<!-- [Output] Current source, build and local protocol validation, including skipped/remaining lanes. -->
<!-- [Pos] Test guide for the unified original-module Runtime, not real business acceptance. -->
<!-- [Sync] 2026-10-11: exact native image dependency checks are local source repair; old release/normal adoption unchanged. -->
<!-- [Sync] 2026-09-13: add offline publisher verification and separate operator acceptance from technical receipts. -->

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
Historical 0.1.9 guide statement (original wording retained):

Current results are in [0.1.9 notes](../build/runtime-0.1.9-release-notes.md).
Old immutable acceptance receipts cannot qualify current bytes. Publication and local
adoption follow the current release design; no API/database/ZIP changes are planned.

## Offline publication control

```sh
node --test tests/publish-qualified-npm.test.mjs
```

These call the production publisher with injected verifier/npm transport and a virtual clock.
They test five-archive gating, platform-before-selector order, identical-byte retry, 190-second
visibility delay, five-minute deadline including query duration, mismatch/error fail-closed,
and credential-safe token/OIDC handling. Synthetic archive bodies are not Runtime
qualification and no npm upload or network request is made. Ordinary CI runs these tests;
docs/folder/publisher-only main commits do not regenerate a published Runtime version.
The operator separately confirmed real model and real Notion E2E for `0.1.9`; this does not
change automated test scope. Docker image build remains unverified.

## Image native dependencies

`npm test` includes `npm-release-contract.test.mjs`: four target maps match
bundled sharp metadata, key order is irrelevant, optional overrides fail, and
actual Bun loads host native packages from an isolated hoisted installation.
Metadata/version failures and native-library symlinks outside that tree are
rejected. The fixture's core file is only a resolution anchor, not a CLI.

The IM专项 also observes an unchanged released CLI processing 2400px input in
a private installation using the production dependency map, then resuming the
same session through public SDK. Its Gateway is a fixture and the records are
technical evidence. It does not qualify a new archive, other host platforms,
normal installation or a real model. Those require the original release and
real-business gates in the [current design](../design/single-source-release-and-dream-adoption.md).

## Current 0.1.12 evidence — 2026-10-12

The 0.1.9 results and local-only image fixture above belong to their original
stages. The [0.1.12 record](../build/runtime-0.1.12-release-notes.md) separates
actual four-platform qualification38149158758, publication38149958179, public
byte matching and normal Dream adoption from SDK/fake Gateway tests and
normal-account business evidence. The second compact feedback, five image
main operations/Token captures and reference/mention controls were observed.
Manual recovery's sixth image and Token capture, 19-image reopen, six new
download SHA matches and original model settings refresh now have normal receipts.
The initial async-history helper count failure is retained without a model replay.
Ordinary cancellation passed after a same-turn running Stop; early-submit Stop
only disconnected and image-inflight cancellation is unverified. Fixture/external-lane skips
are not passed and document validation does not complete those business checks.
