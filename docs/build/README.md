<!-- [Input] Canonical original src modules, locked tooling, recovered dependencies/assets and current policy. -->
<!-- [Output] Actual original-module build and verification commands with explicit release boundaries. -->
<!-- [Pos] Current build guide; previous envelope/cleanroom procedures are historical only. -->
<!-- [Sync] 2026-09-13: compile unique original src at Runtime 0.1.9 and retain Dream contract deltas. -->

# Build and package

There is one active Runtime implementation: original `src`, verified against
`runtime/source-provenance.json`. The default build enters `src/entrypoints/cli.tsx`.
`src/cleanroom` and the envelope/fake-core builders are removed, recoverable at
Git commit `38fdd3c`, not alternative current build products.

## Requirements and commands

Node 24.13.0, locked Bun 1.4.0 and checked `bun.lock` are the tooling baseline.
Provide an absolute normalized recovered dependency root and the original pinned
platform package assets. The external root is used for `node_modules`/`vendor`
only; its src is never compiled.

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

In an isolated worktree, `INK_CORE_TOOLCHAIN_ROOT` may identify the existing same-lock
repository dependency installation. All dependency trees, asset identities/hashes/modes,
source digest, build receipt, graph gaps and DCE assertions remain checked.
The implementation root is hardwired to this repository.

The builder applies existing `runtime/core-prune-profile.json` headless transforms
and `compat/mcp-auth` / `compat/dream-runtime` deltas without editing original src. It writes only Git-ignored
`dist/core-local`. Receipt sourceLayout must prove repository src input and no parallel
implementation. Verifier rejects restored-src/cleanroom build paths.

Current original source inventory is 1,902 files/30,382,832 bytes/35 module directories;
the original src plus recovered dependency baseline is 4,471 files/46,447,794 bytes,
SHA-256 `470ca57d6390e2f9df5e2bb0a6f32b8b62c64f262ae3d02a31349488a08c228e`.

## Reproducibility, packaging and qualification

`npm run test:reproducible` recompiles twice and compares actual bundle/assets tree
digests. It does not change archive/ZIP policy.

`npm run package` uses the current local original-core packager after build verification.
Production eligibility is computed from fresh digest-bound receipts, not hardcoded.
The current Darwin ARM64 base local-core package is qualified; installation still requires
its exact manifest. npm capability qualification and all four native hosts remain separate.
Four native targets plus package-root selector are the source-derived CI qualification
plan in `runtime/npm-release-policy.json`, not an already-passing five-native fixture lane.

Original source copyright is retained; root is private UNLICENSED and public release
authority is recorded from the operator confirmation. Old cleanroom MIT receipts cannot
qualify these bytes; real four-host CI now feeds exact archives to automatic publishing.
See [0.1.9 results](runtime-0.1.9-release-notes.md), [test guide](../test/README.md) and
[alignment decision](../design/claude-sourcemap-package-contract-alignment.md).
