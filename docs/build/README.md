<!-- [Sync] 2026-10-11: public Runtime 0.1.11 qualified/published/adopted; real image business acceptance remains separate and incomplete. -->
<!-- [Input] Canonical original src modules, locked tooling, recovered dependencies/assets and current policy. -->
<!-- [Output] Actual original-module build and verification commands with explicit release boundaries. -->
<!-- [Pos] Current single-source build guide and artifact-validation boundary. -->
<!-- [Sync] 2026-10-11: exact native image dependency checks are local source repair; old release/normal adoption unchanged. -->
<!-- [Sync] 2026-09-13: retain qualified source/build gates and link completed four-host public release evidence. -->

# Build and package

There is one active Runtime implementation: original `src`, verified against
`runtime/source-provenance.json`. The default build enters `src/entrypoints/cli.tsx`.
No second source tree or alternative implementation participates in the build.

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
implementation. Verifier rejects duplicate source trees and implementation roots outside this repository.

Current original source inventory is 1,902 files/30,382,832 bytes/35 module directories;
the original src plus recovered dependency baseline is 4,471 files/46,447,794 bytes,
SHA-256 `470ca57d6390e2f9df5e2bb0a6f32b8b62c64f262ae3d02a31349488a08c228e`.

## Reproducibility, packaging and qualification

`npm run test:reproducible` recompiles twice and compares actual bundle/assets tree
digests. It does not change archive/ZIP policy.

`npm run package` uses the current local original-core packager after build verification.
Production eligibility is computed from fresh digest-bound receipts, not hardcoded.
The historical `0.1.9` Darwin ARM64 base local-core package was qualified; installation still
required its exact manifest. That evidence does not qualify the `0.1.11` candidate.
npm capability qualification and all four native hosts remain separate.
Four native targets plus package-root selector passed the source-derived CI qualification
for release `0.1.9` at source `820be726`; the public five archives match those CI bytes.
This is real native-host evidence, not the retired five-native fixture lane.
Docs/publisher-only edits run ordinary CI without rebuilding or republishing that version.

Original source copyright is retained; root is private UNLICENSED and public release
authority is recorded from the operator confirmation. Qualification is bound to exact
source/archive bytes; four-host CI feeds those archives to automatic publishing.
See [0.1.9 results](runtime-0.1.9-release-notes.md), [test guide](../test/README.md) and
[alignment decision](../design/claude-sourcemap-package-contract-alignment.md).

## Image native package dependencies

The existing four-target [npm policy](../../runtime/npm-release-policy.json)
now pins Bun and the target sharp/libvips packages. The shared
[dependency helper](../../scripts/npm-runtime-dependencies.mjs) is consumed by
staging, standalone prepack, archive verification and installation smoke.
Build-time sharp metadata must match these versions; native loading uses Bun
and the core bundle's resolution anchor. Optional overrides and installation
tree escapes fail before a successful probe.

This repair requires the next Runtime version and fresh qualification. Do not
rebuild or publish a different `0.1.10` archive. See the
[current design](../design/single-source-release-and-dream-adoption.md).

The current published image-native release is Runtime `0.1.11`; see the
[release record](runtime-0.1.11-release-notes.md) for actual qualification, publication
and adoption receipts. Historical `0.1.10` archives are never repacked.
