<!-- [Input] Bun locks, authorized external restored source, core profile/resolution map, compatibility manifest, and legacy envelope build. -->
<!-- [Output] Give fail-closed local-core, legacy-envelope, packaging, and Git-boundary commands. -->
<!-- [Pos] Build and release operator guide. -->
<!-- [Sync] 2026-08-24: record the verified zero-gap core, digest-bound qualification, reproducible local package, and publication prohibition. -->

# Build and package

There are two distinct build products. Do not combine their claims:

- `dist/core-local/`: the qualified local minimal core, built from the explicitly authorized external Claude Code `2.1.88` restored source with exact Bun `1.4.0`; generated and Git-ignored.
- `dist/release/ink-claude-code-dream-0.1.0/`: the existing Node supervisor/envelope around an external official CLI; useful as a historical process-boundary baseline, not a pruned core.

## Requirements

- repository dependencies installed from checked-in `bun.lock`;
- `node_modules/.bin/bun` exactly `1.4.0` for the core builder;
- an absolute, normalized, non-symlink `INK_AUTHORIZED_CORE_SOURCE_ROOT` containing `src/` and recovered `node_modules/`;
- restored-source baseline digest SHA-256 `470ca57d6390e2f9df5e2bb0a6f32b8b62c64f262ae3d02a31349488a08c228e` for 4,471 files / 46,447,794 bytes;
- exact Node `24.13.0` only when reproducing the legacy envelope archive.

## Local minimal-core build

```sh
bun install --frozen-lockfile
./node_modules/.bin/bun --version

INK_AUTHORIZED_CORE_SOURCE_ROOT=/absolute/path/to/claude-code-sourcemap/restored-src \
  bun run build:core-local

INK_AUTHORIZED_CORE_SOURCE_ROOT=/absolute/path/to/claude-code-sourcemap/restored-src \
  bun run verify:core-local
```

The builder:

1. verifies Bun/profile/resolution schemas and the exact source boundary;
2. refuses a symlinked source root or source-tree symlink;
3. refuses to write unless `dist/core-local/` is Git-ignored;
4. hashes the complete source input;
5. builds `${INK_AUTHORIZED_CORE_SOURCE_ROOT}/src/entrypoints/cli.tsx` with the 89-feature profile;
6. writes a sanitized metafile, resolution-gap report, source/build receipt, and DCE evidence only under `dist/core-local/`;
7. never edits or copies the restored tree into the repository.

The verifier requires `status=built`, Bun `1.4.0`, zero gaps, zero forbidden inputs, every required capability input in the metafile, and all required MCP transforms applied. Current evidence passes: source digest `470ca57d6390e2f9df5e2bb0a6f32b8b62c64f262ae3d02a31349488a08c228e`, bundle SHA-256 `6904d3cd7954ead347cc5f5dd65f1313cfa78e0a080514e9efc874e51ff88893`, 1,989 inputs, 48 outputs, zero gaps, and passing DCE assertions. The build receipt binds source provenance `2.1.88` separately from the qualified Dream CLI compatibility version `2.1.241`.

Generated layout:

```text
dist/core-local/
  bundle/
  build-receipt.json
  metafile.json
  resolution-gaps.json
  qualification/
```

`dist/core-local/` is disposable local output. Deleting it is the build rollback; it has no database or Dream-state implications.

## MCP compatibility build layer

Run the separate policy/manifest tests:

```sh
bun run test:mcp-auth-compat
```

This layer covers selected `2.1.238` and `2.1.239` deltas. The qualified headless build records all six required transform IDs as applied, and the SDK, MCP, and MCP-management process receipts bind the same bundle/source hashes. Restored `2.1.88` OAuth remains distinct from this patch. OAuth help and management contracts passed; a complete real browser OAuth login is deferred to real-business QA rather than inferred from technical receipts.

## Qualification and local package

After producing the digest-bound SDK, MCP, and MCP-management receipts, aggregate and package the exact artifact:

```sh
node scripts/qualify-core-local.mjs
node scripts/package-core-local.mjs
node scripts/verify-core-package-local.mjs
```

The current qualification exits 0. The verified package under `dist/core-package-local/ink-claude-code-dream-0.1.0/` contains 62 files, has tree SHA-256 `90e205c41a4fcda5c4ba72a2cd84b6f82e8a7fd1b0b7055b50ea4ef7cd7f5a78`, and records two byte-identical passes. Its manifest state is `productionEligible=true`, `publicationAllowed=false`, and `redistributionAllowed=false`; the Dream manifest contract also passes. Qualification receipts remain outside the package and are represented by digest-bound summaries.

## Legacy envelope build

The old supervisor remains reproducible for comparator/rollback work:

```sh
SOURCE_DATE_EPOCH=1787443200 bun run build
node scripts/verify-release.mjs
bun run package
bun run test:reproducible
```

It targets Node ESM and supervises an external official executable. Its manifest remains `corePruned=false` and `productionEligible=false`. It neither contains nor validates the new minimal core.

## Git and publication gate

May enter Git: repository-authored source-bound builders, capability profiles, resolution maps, source-hash-bound patch policies/manifests, tests, docs, SBOM/checksum tooling, and non-vendor interface definitions. This inventory does not itself grant redistribution rights.

Must stay out of Git/public release: restored/vendor source, `dist/core-local`, `dist/core-package-local`, vendor binaries/maps, source-containing maps, transcripts, Workspace bodies, plugin materialization, settings, complete environment data, OAuth tokens, authentication files, and credentials. The ignored local package may contain only the licensed runtime assets named by its checksum/SBOM/license manifests.

The user's local build authorization is not a public redistribution grant. Do not publish or redistribute the derived core without a separate written legal/release decision. The local Dream main journey passed, but production deployment remains separately unauthorized and the working OAuth MCP/Admin UI lanes remain incomplete. Official `2.1.241` remains the behavior comparator and rollback executable; the local implementation remains restored `2.1.88` plus a separately applied MCP compatibility patch.
