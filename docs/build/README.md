<!-- [Input] Bun lock, build/verify/pack scripts, platform manifest, and immutable release policy. -->
<!-- [Output] Give reproducible build, packaging, platform, and release verification commands. -->
<!-- [Pos] Build and release operator guide. -->
<!-- [Sync] 2026-08-23: add the extensionless console bin and fail-closed pruning feasibility gate. -->

# Build and package

Requirements: Bun `1.2.20` for dependency/build scripts, exact Node `24.13.0` for deterministic archive packing, and Node `>=22,<25` for executing the produced runtime. The exact packer pin controls the `node:zlib` gzip bytes; cross-Node archive identity is not claimed. A reachable registry may be supplied to `bun install`; subsequent builds use the checked-in lock.

```sh
bun install --frozen-lockfile
SOURCE_DATE_EPOCH=1787443200 bun run build
node scripts/verify-release.mjs
bun run package
bun run test:reproducible
```

The package is generated at `dist/release/ink-claude-code-dream-0.1.0`; its discoverable console bin is `bin/ink-claude-code-dream`. The deterministic archive and SHA sidecar are generated under `dist/`. The official `2.1.241` artifact is user-supplied, unmodified, external, and absent from both. Source maps are external and omit source content. The release includes and verifies the artifact, entrypoint, Runtime-data, bare-profile, dependency-license, pruning-decision, SBOM, checksum, and rollback contracts.

The build targets Node 22 ESM and uses split dynamic chunks. Linux deployments are supported only for glibc x64/arm64 after validating the exact platform entry in `runtime/platforms.json`. This Mac-generated Node release proves bundle portability, not the external Linux binary's dynamic-library compatibility; scan and verify the official package on its deployment platform.

This is a feasibility artifact with `corePruned=false` and `productionEligible=false`; do not activate it as Dream's optimized default. Explicit compatibility experiments must use an immutable path and run `--runtime-doctor` against the verified external `2.1.241` artifact first. On macOS, the same official artifact directory must be first on the backend service `PATH` because Dream isolates MCP management identity. The wrapper exposes the `CLAUDE_SECURESTORAGE_CONFIG_DIR` capability marker for Dream's static gate but does not implement, read, or redirect credential storage. Default production and rollback both point directly to a verified official executable.

Historical candidate evidence is optionally rechecked without copying source:

```sh
INK_RESTORED_SOURCE_ROOT=/absolute/read-only/restored-src bun run test:pruning-evidence
```
