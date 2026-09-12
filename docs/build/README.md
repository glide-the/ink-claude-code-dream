<!-- [Input] Checked restored-source snapshot, Bun locks, authorized complete local-core inputs, clean-room policies, and legacy envelope build. -->
<!-- [Output] Give fail-closed local-core, legacy-envelope, packaging, and Git-boundary commands. -->
<!-- [Pos] Build and release operator guide. -->
<!-- [Sync] 2026-08-24: add fail-closed @glide-the four-platform npm staging, tarball, OIDC publication flow, and zero-source-map rule for every release form. -->
<!-- [Sync] 2026-08-30: document the authorized Runtime 0.1.4 clean-room qualification and publication flow. -->
<!-- [Sync] 2026-08-30: document the restored 2.1.88 Linux path with the Docker-style passthrough and locked BPF. -->
<!-- [Sync] 2026-08-30: record the completed Runtime 0.1.4 qualification and npm publication workflows. -->
<!-- [Sync] 2026-09-13: verify the complete original source snapshot and 0.1.7 candidate with publication gates closed. -->

# Build and package

There are two distinct build products. Do not combine their claims:

- `dist/core-local/`: the qualified local minimal core, built from the explicitly authorized external Claude Code `2.1.88` restored source with exact Bun `1.4.0`; generated and Git-ignored.
- `dist/release/ink-claude-code-dream-0.1.0/`: the existing Node supervisor/envelope around an external official CLI; useful as a historical process-boundary baseline, not a pruned core.

Both products forbid `*.map`. The legacy envelope build disables esbuild source-map generation, while the minimal core, npm stage, npm dry-run inventory, and final tgz verifier independently reject source maps.

The separate repository-authored clean-room Runtime is published as `0.1.4`. Its checked policy generates `sandbox.notion-cli` into the platform and selector capability manifests. The exact darwin-arm64 executable has a version-bound real Dream acceptance receipt, the four targets have native-format/package/reproducibility qualification, and public npm publication is explicitly authorized. Main commit `0ebafe95db22101cf77db2c27e73b561d3af37a6` passed qualification run `33306855166`; publish run `33306940462` reverified that exact artifact and published the four platform packages before the selector.

Runtime `0.1.7` is the current source candidate, not a release. It restores the complete byte-exact `restored-src/src` tree and supersedes the incomplete unpublished `0.1.6` candidate. The mixed-source root is private and `UNLICENSED`; `package/` owns the independent MIT selector. The restored snapshot is research-only and excluded from clean-room builds/tarballs. Every production/publication/redistribution/target gate remains closed. See [Runtime 0.1.7 notes](runtime-0.1.7-release-notes.md).

## Restored-source integrity

```sh
node scripts/sync-restored-source.mjs verify
node --test tests/restored-source-structure.test.mjs
```

The gate requires 1,902 files, 35 original module directories, and exact commit/subtree/byte inventory. It does not execute or reformat the restored implementation. This checked `src`-only snapshot does not replace the explicit complete authorized source/dependency/package roots required by the separate historical local-core builder below.

## Clean-room Runtime 0.1.7 candidate

Build and verify all five local packages without opening publication:

```sh
./node_modules/.bin/bun scripts/build-cleanroom-targets.ts
INK_CLEANROOM_QUALIFICATION_FIXTURE=provider-free-test \
  node scripts/package-cleanroom-npm.mjs all
INK_CLEANROOM_QUALIFICATION_FIXTURE=provider-free-test \
  node scripts/verify-cleanroom-npm.mjs
```

The fixture marker is written into candidate evidence. It permits deterministic technical build/install checks only; generated `scripts/prepack.mjs` still rejects npm packing because `publicationAllowed` is false. The meta tarball contains package-root `cli.js` plus adjacent `release-manifest.json`; each native package retains its private `runtime/bin/ink-claude-code-dream` executable.

## Clean-room Runtime 0.1.4 release

Build the exact Bun `1.4.0` targets and the formal five-tarball set locally:

```sh
./node_modules/.bin/bun scripts/build-cleanroom-targets.ts
node scripts/package-cleanroom-npm.mjs all
node scripts/verify-cleanroom-npm.mjs
```

The source-of-truth is `runtime/cleanroom-artifact-policy.json#requiredCapabilities`. The packager emits it verbatim as entries in each platform package's `runtime/manifest/capabilities.json` and the selector's `manifest/capabilities.json`; Dream should require stable ID `sandbox.notion-cli` and reject a missing ID. `runtime/local-capabilities.json` and `runtime/capabilities.json` belong to the distinct local-core and official-envelope products, so they intentionally do not claim this clean-room-only capability.

Local tarballs remain qualification evidence rather than registry evidence. Public release uses `.github/workflows/qualify-npm-runtime.yml` on main, then passes that exact successful run ID to `.github/workflows/publish-npm.yml`; the publisher re-verifies all five archives and publishes four platform packages before the selector. Runtime `0.1.4` completed that flow in runs `33306855166` and `33306940462`. Never publish the restored-source local core.

## Requirements

- repository dependencies installed from checked-in `bun.lock`;
- exact build-only alias `@anthropic-ai/sandbox-runtime-legacy -> @anthropic-ai/sandbox-runtime@0.0.45`, which supplies the checksum-pinned Linux BPF asset expected by the restored code;
- `node_modules/.bin/bun` exactly `1.4.0` for the core builder;
- an absolute, normalized, non-symlink `INK_AUTHORIZED_CORE_SOURCE_ROOT` containing `src/` and recovered `node_modules/`;
- an absolute, normalized, non-symlink `INK_AUTHORIZED_CORE_PACKAGE_ROOT` containing the original 2.1.88 package assets such as ripgrep;
- restored-source baseline digest SHA-256 `470ca57d6390e2f9df5e2bb0a6f32b8b62c64f262ae3d02a31349488a08c228e` for 4,471 files / 46,447,794 bytes;
- exact Node `24.13.0` only when reproducing the legacy envelope archive.

## Local minimal-core build

```sh
bun install --frozen-lockfile
./node_modules/.bin/bun --version

INK_AUTHORIZED_CORE_SOURCE_ROOT=/absolute/path/to/claude-code-sourcemap/restored-src \
INK_AUTHORIZED_CORE_PACKAGE_ROOT=/absolute/path/to/claude-code-sourcemap/package \
  bun run build:core-local

INK_AUTHORIZED_CORE_SOURCE_ROOT=/absolute/path/to/claude-code-sourcemap/restored-src \
INK_AUTHORIZED_CORE_PACKAGE_ROOT=/absolute/path/to/claude-code-sourcemap/package \
  bun run verify:core-local
```

The builder:

1. verifies Bun/profile/resolution schemas and the exact source boundary;
2. refuses a symlinked source root or source-tree symlink;
3. refuses to write unless `dist/core-local/` is Git-ignored;
4. hashes the complete source input;
5. builds `${INK_AUTHORIZED_CORE_SOURCE_ROOT}/src/entrypoints/cli.tsx` with the 89-feature profile;
6. for Linux only, copies the repository-authored Docker-style passthrough as `apply-seccomp` and exact `sandbox-runtime@0.0.45` `unix-block.bpf` bytes into the chunk-adjacent `vendor/seccomp/<arch>` path that the 2.1.88 code searches;
7. writes a sanitized metafile, resolution-gap report, source/build receipt, and DCE evidence only under `dist/core-local/`;
8. never edits or copies the restored tree into the repository.

The verifier requires `status=built`, Bun `1.4.0`, zero gaps, zero forbidden inputs, every required capability input in the metafile, all required MCP transforms applied, and exact runtime-asset source identity/digest/mode/path. The current Docker-native Linux x64 build passed for source digest `470ca57d6390e2f9df5e2bb0a6f32b8b62c64f262ae3d02a31349488a08c228e` and bundle SHA-256 `a5827e0e6a1f5c3f09f5c4ceca66122893e531d3f31a644811273bae89487e9a`; its qualified 64-file package has artifact-tree SHA-256 `b69f165f21a333489f35d1fb6e4e55c03b41a61fd11746e75163422505bbcb77`. The build receipt binds source provenance `2.1.88` separately from the Dream CLI compatibility value `2.1.241`.

Generated layout:

```text
dist/core-local/
  bundle/
    chunks/vendor/seccomp/<arch>/apply-seccomp     # Linux only
    chunks/vendor/seccomp/<arch>/unix-block.bpf    # Linux only
  build-receipt.json
  metafile.json
  resolution-gaps.json
  qualification/
```

`dist/core-local/` is disposable local output. Deleting it is the build rollback; it has no database or Dream-state implications.

### Linux apply-seccomp passthrough

The Linux local-core build always materializes `runtime/seccomp/apply-seccomp-passthrough-v2.1.88.sh` as packaged `lib/core/chunks/vendor/seccomp/<arch>/apply-seccomp`. The artifact receipt and checksum inventory bind those bytes directly; deployment does not mutate the package afterward. This local-core behavior remains outside the public clean-room npm package.

The restored 2.1.88 runtime calls the helper as `apply-seccomp <unix-block.bpf> <command> ...`; the shim therefore removes exactly argv 1 before executing the command. This bypasses only the Unix-socket seccomp layer. A host that rejects bubblewrap's outer user/mount namespace still requires a topology/capability change outside the Runtime.

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

May enter Git: repository-authored tooling/tests/docs and the exact research-only `restored-src/src` snapshot bound by `source-snapshot.json`. The snapshot retains Anthropic copyright and is not MIT code. This inventory does not grant redistribution rights.

Must stay out of Git: recovered dependencies/vendor artifacts, `dist/core-local`, `dist/core-package-local`, generated artifacts, vendor binaries/maps, transcripts, Workspace bodies, plugin materialization, settings, complete environment data, OAuth tokens, authentication files, and credentials. Restored source and derived artifacts must also stay out of public releases. The ignored local package may contain only assets named by its checksum/SBOM/license manifests.

The user's local build authorization is not a public redistribution grant, and no Anthropic redistribution authorization has been obtained. Do not publicly publish or redistribute the restored source or derived core. The local Dream main journey and final real Comfy lane passed; authenticated Admin UI evidence remains the separate missing-session gap. Official `2.1.241` remains the behavior comparator and rollback executable; the local implementation remains restored `2.1.88` plus separately applied MCP compatibility and OAuth repairs.

## npm 多平台打包与发布

查看不产生制品的发布布局：

```sh
npm run npm:plan
```

当前法律门会按预期失败，输出同时点名 `publicationAllowed` 和 `redistributionAllowed`：

```sh
npm run npm:legal
npm run npm:gate
npm pack --dry-run --json
```

前两个命令不能授权发布；第三个命令还会由根包 lifecycle 明确拒绝 legacy envelope。取得书面再分发授权、补齐发布许可证，并对某个 native target 完成独立 qualification 后，才使用：

```sh
SOURCE_DATE_EPOCH=1787443200 \
node scripts/npm-release.mjs stage \
  --target darwin-arm64 \
  --package-root /absolute/path/to/qualified/ink-claude-code-dream-0.1.0 \
  --output-root dist/npm-stage

node scripts/smoke-npm-release.mjs dist/npm-stage/darwin-arm64
```

四个平台必须在对应 native runner 上分别执行；禁止交叉打包。平台包固定依赖并实测 `bun@1.4.0`，同时校验 target、manifest、ripgrep SHA-256。所有 `*.map` 在 core material、staging、prepack、npm dry-run inventory 和最终 tgz 五层都被拒绝。

先由 `.github/workflows/qualify-npm-runtime.yml` 在四个受控 native self-hosted runner 生成精确 commit/target 的 qualification artifact，再由 `.github/workflows/publish-npm.yml` 校验 workflow path、同仓库、成功状态、head SHA 与 ref 后进入 Trusted Publishing OIDC 流程；法律 gate 为 false 时不会打包或发布。GitHub `npm` Environment 已创建并限定 `main`，但当前 private plan 不支持 required reviewers，且仓库当前没有任何 self-hosted runner。五个包首次创建必须在账户启用 2FA 后手工 bootstrap，之后才能配置 Trusted Publisher。完整架构和外部 npm 设置见 [npm 多平台发布设计](../design/npm多平台发布设计.md)。
