<!-- [Input] Original 2.1.88 src subtree, actual compiler resolution, selector and Dream contracts. -->
<!-- [Output] Bind identical directories/modules to the actual implementation and preserve source provenance. -->
<!-- [Pos] Canonical decision for the original-module Runtime unification. -->
<!-- [Sync] 2026-09-13: supersede 0.1.7's side snapshot with canonical src and remove the parallel implementation. -->

# Claude sourcemap package contract alignment

## Decision

`src` is the original implementation. `restored-src/src` is its identical reference:
same directories, modules, paths, permissions and initial bytes. These are one Runtime,
not an original snapshot beside an independently designed implementation.
The default compiler starts at `src/entrypoints/cli.tsx` and resolves original
`src/main.tsx`, `src/cli/print.ts`, `src/services/mcp/client.ts` and the rest of this
repository's module graph.

The old `src/cleanroom` and wrapper `src/cli.ts`, `contracts.ts`, `launcher.ts`,
`manifest.ts` are removed. Prior implementation and tests remain recoverable from
Git commit `38fdd3c`. Retired policies move to `runtime/history/0.1.7`, marked
`historicalOnly`; no active build or workflow reads them.

`0.1.6` fixed only the outer package shape; `0.1.7` added a side snapshot but retained
the redesigned implementation. Neither fulfilled the requested same-module build.
`0.1.8` corrects the actual source ownership and compiler routing.

## Original module structure and identity

Reference commit: `a8a678cb6244e6770e1e421767ff0987a1d95549`.
Original Git subtree: `7640f58ea271eb60952ebdbe0dfa173fc96ebe30`.
Each tree contains 1,902 regular files, 30,382,832 bytes and these 35 directories:

```text
assistant bootstrap bridge buddy cli commands components constants context coordinator
entrypoints hooks ink keybindings memdir migrations moreright native-ts outputStyles
plugins query remote schemas screens server services skills state tasks tools types
upstreamproxy utils vim voice
```

Root modules such as `main.tsx`, `query.ts`, `Tool.ts`, `Task.ts` and `QueryEngine.ts`
are preserved too. No module is renamed, reformatted or given Ink-specific headers.
No per-module folder contract is inserted into either byte-exact tree.

ASCII-path content/mode inventory SHA-256:
`40269454cd690c74d129a31699935d6db713f2958aabe4787e01617e1c92a906`.
`node scripts/sync-restored-source.mjs verify`, lint and regression tests compare
both complete file inventories and complete directory lists, including empty directories.

## Actual build and compatibility

`scripts/build.ts` invokes the existing original-core compiler.
`runtime/core-prune-profile.json#sourceDirectory` is `src`.
Implementation source root is hardwired to the repository, not an environment-selected
external `src`. The external recovered root supplies only `node_modules` and `vendor`;
platform package root supplies pinned assets; optional toolchain root supplies the same
locked repository dependency installation.

The combined original src/recovered dependency baseline remains 4,471 files,
46,447,794 bytes, SHA-256
`470ca57d6390e2f9df5e2bb0a6f32b8b62c64f262ae3d02a31349488a08c228e`.
A receipt must declare implementationRoot=src, implementationSource=repository,
parallelImplementation=false, and recovered-dependencies-only external use.
The verifier rejects a restored-src or cleanroom implementation graph.

Headless pruning and the existing source-bound MCP/auth/security-storage fixes stay
in the build transformation layer. Original source bytes remain intact. Physically
preserving Ink/voice/bridge modules does not enable their UI; headless print/SDK/MCP
behavior remains the qualified feature goal. No independent Agent/MCP state machine,
fictional model-family heuristic or ZIP-command policy is introduced.

## Package shape and Dream consumer

The private mixed-source root package orchestrates builds and has no bin/publish surface.
`package/` is the repository-authored selector source, preserving package-root
`package.json` + `cli.js`, ES module/no invented exports, both `claude` and
`ink-claude-code-dream` aliases, and four exact native optional package versions.
The selector's MIT license does not relicense original modules.

Runtime root, selector, target expectations, local receipts, Dream resolver, Docker and
AutoDL move together to 0.1.8. Dream backend/frontend metadata moves to 0.1.2/0.0.2;
SDK stays 0.2.145, source provenance 2.1.88, CLI compatibility 2.1.241, API schema 2.0.0.
npm package-root and local nested-bin layout checks remain distinct distribution
contracts for the same implementation, not permission for a second source architecture.

## Evidence and release boundary

The original-module Darwin ARM64 build verifies 1,989 inputs, 48 outputs, zero resolution
gaps and all DCE assertions. Two complete output inventories have the same digest.
Current fixture results are in [0.1.8 notes](../build/runtime-0.1.8-release-notes.md).

Original modules retain Anthropic copyright/research provenance. Compilation and local
integration are technically supported together; redistribution/publication require
separate authority. Current source-derived production, publication, redistribution and
four-target qualification gates remain closed. The old MIT Runtime 0.1.4 release and
immutable 0.1.5 acceptance cannot qualify these bytes.

CI no longer bans restored source or builds a removed implementation. Old qualification
and publish workflows explicitly fail closed and have no publish/token/artifact-reuse
steps. This change does not push, publish, install production software, deploy, alter
database/API contracts or change Dream's separately owned ZIP policy.
