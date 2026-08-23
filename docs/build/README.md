<!-- [Input] Bun lock, build/verify/pack scripts, platform manifest, and immutable release policy. -->
<!-- [Output] Give reproducible build, packaging, platform, and release verification commands. -->
<!-- [Pos] Build and release operator guide. -->
<!-- [Sync] 2026-08-23: add the Dream macOS MCP management identity activation contract. -->

# Build and package

Requirements: Bun `1.2.20` for dependency/build scripts, exact Node `24.13.0` for deterministic archive packing, and Node `>=22,<25` for executing the produced runtime. The exact packer pin controls the `node:zlib` gzip bytes; cross-Node archive identity is not claimed. A reachable registry may be supplied to `bun install`; subsequent builds use the checked-in lock.

```sh
bun install --frozen-lockfile
SOURCE_DATE_EPOCH=1787443200 bun run build
node scripts/verify-release.mjs
bun run package
bun run test:reproducible
```

The package is generated at `dist/release/ink-claude-runtime-0.1.0`; the deterministic archive and SHA sidecar are generated under `dist/`. The official `2.1.241` artifact is user-supplied, unmodified, external, and absent from both. Source maps are external and omit source content. The release includes and verifies the artifact, entrypoint, Runtime-data, bare-profile, dependency-license, SBOM, checksum, and rollback contracts.

The build targets Node 22 ESM and uses split dynamic chunks. Linux deployments are supported only for glibc x64/arm64 after validating the exact platform entry in `runtime/platforms.json`. This Mac-generated Node release proves bundle portability, not the external Linux binary's dynamic-library compatibility; scan and verify the official package on its deployment platform.

Activation must use an immutable path and deployment-specific `CLAUDE_CODE_CLI_PATH`. Run `--runtime-doctor` against the verified external `2.1.241` artifact before changing configuration. On macOS Dream deployments, also put that exact official artifact directory first on the backend service `PATH`: Dream isolates MCP management identity and removes the wrapper-only `INK_CLAUDE_CODE_EXECUTABLE` selector before launching `mcp` management commands. The wrapper exposes the official `CLAUDE_SECURESTORAGE_CONFIG_DIR` capability marker for Dream's static gate but does not implement, read, or redirect credential storage. The wrapper must not patch, bundle, rename, or alter authentication. Default rollback points directly to the prior official executable.
