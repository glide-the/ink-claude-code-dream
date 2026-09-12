// [Input] Canonical original src modules, locked Bun, and explicit recovered dependency/asset roots.
// [Output] Build the one Dream Runtime from src/entrypoints/cli.tsx under ignored dist/core-local.
// [Pos] Default project build entry; no parallel cleanroom or supervisor implementation is selected.
// [Sync] 2026-09-13: make npm run build compile the actual aligned source tree.

await import("./build-core-prune.ts");
