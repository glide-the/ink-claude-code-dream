<!-- [Input] Canonical original src modules, byte-exact reference, build transforms and versioned package contracts. -->
<!-- [Output] Explain the one Runtime implementation, actual build, verification and local integration boundaries. -->
<!-- [Pos] Operator entry point for ink-claude-code-dream. -->
<!-- [Sync] 2026-09-13: unify original directories and modules as the actual implementation; retire the parallel cleanroom path. -->

# ink-claude-code-dream

Runtime `0.1.9` uses the original `claude-code-sourcemap` modules directly.
`src` is the only implementation and preserves original directories, module paths, permissions and
initial bytes: **1,902 files, 35 module directories, 30,382,832 bytes**.
The default build compiles `src/entrypoints/cli.tsx`, not a wrapper or a side snapshot.
The separate `src/cleanroom` implementation is removed. Its previous code is recoverable
from Git commit `38fdd3c`; it is not a second active Runtime.

The [source-layout contract](runtime/source-layout.json) and
[alignment decision](docs/design/claude-sourcemap-package-contract-alignment.md) describe
this correction. The reference is from commit
`a8a678cb6244e6770e1e421767ff0987a1d95549`; the unique source tree has inventory SHA-256
`40269454cd690c74d129a31699935d6db713f2958aabe4787e01617e1c92a906`.
Original source headers and module names are not rewritten.

## Build and verify

Use Node `24.13.0` and the locked Bun `1.4.0`:

```sh
bun install --frozen-lockfile
npm run source:verify

INK_AUTHORIZED_CORE_SOURCE_ROOT=/absolute/path/to/claude-code-sourcemap/restored-src \
INK_AUTHORIZED_CORE_PACKAGE_ROOT=/absolute/path/to/claude-code-sourcemap/package \
  npm run build

node scripts/verify-core-prune.mjs
npm run lint
npm test
```

`INK_AUTHORIZED_CORE_SOURCE_ROOT` supplies recovered `node_modules` and `vendor`
dependencies only. Its `src` is not a build input: implementation always comes from this
repository's `src`. `INK_AUTHORIZED_CORE_PACKAGE_ROOT` supplies checksum-pinned platform
assets. In an isolated worktree, `INK_CORE_TOOLCHAIN_ROOT` may point to the same locked
repository dependency installation. These roots are explicitly validated.

The existing headless pruning and MCP compatibility transforms remain in
`runtime/core-prune-profile.json` and `compat/mcp-auth`; they are applied during build,
without changing the initial recovered modules. Generated bundle, assets and receipts
are under Git-ignored `dist/core-local`.

For the Python SDK and stdio/HTTP MCP fixture lanes:

```sh
INK_DREAM_PYTHON=/absolute/path/to/python-with-sdk-0.2.145 npm run test:upstream-sdk
INK_DREAM_PYTHON=/absolute/path/to/python-with-sdk-0.2.145 \
INK_MCP_FIXTURE_PYTHON=/absolute/path/to/python-with-mcp-2.0.0 \
  npm run test:mcp-source
npm run test:acceptance
npm run test:mcp-auth-compat
npm run test:reproducible
```

These use disposable homes/workspaces and local fake providers, not real model requests.
The MCP fixture can use a separate interpreter; Dream's MCP 1.x environment is unchanged.
The smoke checks version, empty MCP inventory and explicit interactive-mode rejection.
This build is headless; restoring the original UI modules does not mean they are enabled.
Current results and remaining qualification boundaries are in
[0.1.9 notes](docs/build/runtime-0.1.9-release-notes.md).

## Module and capability boundary

All 35 original directories, including `assistant`, `bootstrap`, `bridge`, `buddy`,
`cli`, `components`, `entrypoints`, `services`, `tools`, `ink` and `voice`, remain
physically intact in the unique `src` tree. The read-only verifier and tests reject extra, missing,
renamed or byte-modified modules, including extra empty directories.

Source-bound build deltas preserve Dream's Notion-only native Bash projection,
exclude its credentials from generic/hooks/stdio MCP children, and honor explicit
server-owned model max-output/context and global effort without model-ID guessing.

The build profile retains headless SDK JSON/JSONL, control/cancel, session/resume,
tool use and permissions, Workspace/files/sandbox, MCP transports/OAuth/resources,
plugins, Skills, hooks and ordinary Agent subagents. Graph-proved interactive Ink,
remote/swarm UI and IDE/updater surfaces are pruned at build time, not replaced by a
redesigned source tree. Deferred shared dependencies are not removed by name alone.

## Package and Dream versions

The private root package is the build workspace, not the npm selector.
`package/` retains the original physical package-root shape: `package.json` and
`cli.js`. Both command aliases select an exact native optional package. The selector is
repository-authored; its MIT license does not relicense the original Runtime modules.

Runtime project, selector and native expectations are `0.1.9`.
Dream adoption is pending successful publication and verified installation; current Dream metadata is
backend `0.1.2` / frontend `0.0.2`. Python SDK stays `0.2.145`, source provenance
`2.1.88`, and Dream-facing CLI compatibility `2.1.241`; API schema stays `2.0.0`.

Native four-target packaging remains a qualification requirement, not a result inherited
from the removed implementation. Local packaging/installation still requires the current
digest-bound production gate. Older `0.1.4` public releases and `0.1.5` acceptance are
historical evidence only.

## Marketplace and publication boundary

The reviewed Marketplace still pins the official MCP Apps development Skills at
`10195ad91851502134930e9b80ec2c04e277a720`. It does not install an MCP server or add
MCP Apps UI hosting. See [the Host design](docs/design/mcp-apps-marketplace-and-host.md).

Original modules retain Anthropic copyright and research-only provenance. The mixed-source
root is private and `UNLICENSED`. Combining these modules into the actual implementation
is technically supported; public redistribution/publication is a separate authority gate
and is recorded in runtime/source-authorization.json based on the operator confirmation. No credentials, user data, generated artifacts or source maps are
added to packages or Git by this correction. CI checks source consistency and static
contracts; main qualification now builds on four native hosts and automatically feeds the exact artifacts to publishing.

Release and local adoption follow the [current design](docs/design/single-source-release-and-dream-adoption.md).
No API, database or ZIP-policy change is planned. See [build](docs/build/README.md),
[test](docs/test/README.md), and [historical 0.1.7 notes](docs/build/runtime-0.1.7-release-notes.md).
