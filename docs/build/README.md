<!-- [Input] Bun locks, authorized external restored source, core profile/resolution map, compatibility manifest, and legacy envelope build. -->
<!-- [Output] Give fail-closed local-core, legacy-envelope, packaging, and Git-boundary commands. -->
<!-- [Pos] Build and release operator guide. -->
<!-- [Sync] 2026-08-24: document content-addressed local installation and isolated Bun 1.4.0 discovery. -->

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

The verifier requires `status=built`, Bun `1.4.0`, zero gaps, zero forbidden inputs, every required capability input in the metafile, and all required MCP transforms applied. Current evidence passes: source digest `470ca57d6390e2f9df5e2bb0a6f32b8b62c64f262ae3d02a31349488a08c228e`, bundle SHA-256 `a300fe7fb3da453e45b2f2cd7721bef1963aa991498c26a2826fef8b381161f5`, 1,989 inputs, 48 outputs, zero gaps, and passing DCE assertions. The build receipt binds source provenance `2.1.88` separately from the qualified Dream CLI compatibility version `2.1.241`.

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

This layer covers selected `2.1.238` and `2.1.239` deltas. The qualified headless build records all six required transform IDs as applied, and the SDK, MCP, and MCP-management process receipts bind the same bundle/source hashes. Restored `2.1.88` OAuth remains distinct from this patch. The source-bound OAuth repair preserves Commander `--no-browser`, a consistent port-3118 callback, pipe/PTY input with explicit PTY stdin pause on cleanup, provider-instance DCR client-information memoization, verified token save plus `credentials_present`, fixed error classification, and a bounded secret-free receipt.

Secure storage has two explicit modes. With a valid explicit `CLAUDE_SECURESTORAGE_CONFIG_DIR`, the Runtime uses only that actor-owned `0700` directory's `0600` `.credentials.json` and must not call the user's macOS keychain. When the selector is unset, the official keychain path remains unchanged. This rule fixes the previous real Comfy candidate, which recorded `token_save_completed` followed by `credentials_missing` because keychain primary storage shadowed the actor plaintext fallback.

Run the complete executable OAuth CLI contract against the exact official MCP Python SDK `2.0.0` fixture checkout at commit `6f69a3758ebf2ee55ce050f58b470ce11af71133`:

```sh
INK_MCP_OAUTH_FIXTURE_PYTHON=/absolute/path/to/pinned/venv/bin/python \
INK_MCP_OAUTH_FIXTURE_ROOT=/absolute/path/to/python-sdk/examples/servers/simple-auth \
  bun run test:core-oauth
```

The current result is 3/3 passed across source-bound safety, pipe, and real-PTY tests. A fake `security` sentinel proves the actor-selector lanes never invoke macOS `security`; the process helper also handles the `waitForExit` already-exited-listener race. The final real Comfy lane independently passed through public production endpoints with a complete 16-stage safe receipt and 41-tool connected inventory.

## Qualification and local package

After producing the digest-bound SDK, MCP, and MCP-management receipts, aggregate and package the exact artifact:

```sh
node scripts/qualify-core-local.mjs
node scripts/package-core-local.mjs
node scripts/verify-core-package-local.mjs
```

The current SDK real-process differential, stdio/HTTP MCP tools/resources differential, MCP management lifecycle, and aggregate qualifier all exit 0. The verified package under `dist/core-package-local/ink-claude-code-dream-0.1.0/` contains 62 files and 61 checksum entries, has artifact-tree SHA-256 `b674fb04734cde23c3821ae7796f3125e96e110392f6be353c30e1e7f59b0f5b`, and records two byte-identical passes. Its manifest state is `productionEligible=true`, `publicationAllowed=false`, and `redistributionAllowed=false`; the Dream manifest contract also passes. Qualification receipts remain outside the package and are represented by digest-bound summaries.

Install the qualified package without changing the user's ambient Bun:

```sh
node scripts/install-core-local.mjs
command -v ink-claude-code-dream
ink-claude-code-dream --version
```

The installer refuses an unqualified package, a non-`1.4.0` Bun, unsafe prefix roots, and existing non-symlink PATH entries. Runtime and toolchain bytes are copied into content-addressed `~/.local/share/ink-claude-code-dream/` directories before atomic links are created under `~/.local/bin`. The launcher resolves `INK_CLAUDE_CODE_BUN_PATH` only when explicitly supplied, then the dedicated `ink-claude-code-bun-1.4.0`, and only then ambient `bun`; this prevents an older global Bun from breaking Dream startup while preserving a diagnostic override.

The final repository verification uses exact Node `24.13.0`:

```sh
PATH=/Users/dmeck/.nvm/versions/node/v24.13.0/bin:$PATH bun run verify
```

It exits 0 with Node 44 passed and 2 external OAuth-fixture tests skipped, MCP compatibility 46 passed and 6 authorized-source fixtures skipped, and the SDK contract, acceptance, release verification, and archive reproducibility all passing. The explicit authorized-source replay, `INK_AUTHORIZED_CORE_SOURCE_ROOT=/Users/dmeck/project/claude-code-sourcemap/restored-src bun --cwd compat/mcp-auth test`, executes all six source-bound fixtures and passes 52/52 with zero failures. Final archive SHA-256: `64c919d1f11b2770497a080c4cdeb8587925f45d928912459b31647e1b68eb38`. Final checksum-inventory SHA-256: `61e12c7c1828c05fb6e70535abb36ff1fbe924aaba2d78787b9ce8e832b3947c`.

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

May enter Git: repository-authored replayable source-bound builders, capability profiles, resolution maps, source-hash-bound patches/manifests, tests, documentation, SBOM/checksum tooling, and non-vendor interface definitions. This inventory does not itself grant redistribution rights.

Must stay out of Git and public release: the read-only restored/vendor source input, `dist/core-local`, `dist/core-package-local`, generated artifacts, vendor binaries/maps, source-containing maps, transcripts, Workspace bodies, plugin materialization, settings, complete environment data, OAuth tokens, authentication files, and credentials. The ignored local package may contain only the runtime assets named by its checksum/SBOM/license manifests.

The user's local build authorization is not a public redistribution grant, and no Anthropic redistribution authorization has been obtained. Do not publicly publish or redistribute the restored source or derived core. The local Dream main journey and final real Comfy lane passed; authenticated Admin UI evidence remains the separate missing-session gap. Official `2.1.241` remains the behavior comparator and rollback executable; the local implementation remains restored `2.1.88` plus separately applied MCP compatibility and OAuth repairs.
