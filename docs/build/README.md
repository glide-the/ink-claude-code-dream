<!-- [Input] Bun lock, build/verify/pack scripts, platform manifest, and immutable release policy. -->
<!-- [Output] Give reproducible build, packaging, platform, and release verification commands. -->
<!-- [Pos] Build and release operator guide. -->

# Build and package

Requirements: Bun `1.2.20` for dependency/build scripts and Node `>=22,<25` for the produced runtime. A reachable registry may be supplied to `bun install`; subsequent builds use the checked-in lock.

```sh
bun install --frozen-lockfile
SOURCE_DATE_EPOCH=1787443200 bun run build
node scripts/verify-release.mjs
node scripts/pack-release.mjs
bun run test:reproducible
```

The package is generated at `dist/release/ink-claude-runtime-0.1.0`; the deterministic archive and SHA sidecar are generated under `dist/`. The official core is deliberately external and absent from both. Source maps are external and omit source content.

The build targets Node 22 ESM and uses split dynamic chunks. Linux deployments are supported only for glibc x64/arm64 after validating the exact platform entry in `runtime/platforms.json`. This Mac-generated Node release proves bundle portability, not the external Linux binary's dynamic-library compatibility; scan and verify the official package on its deployment platform.

Activation must use an immutable path and deployment-specific `CLAUDE_CODE_CLI_PATH`. Run `--runtime-doctor` against the verified external `2.1.235` core before changing configuration. Default rollback points directly to the prior official executable.
