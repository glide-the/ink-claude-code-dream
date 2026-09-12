<!-- [Input] Byte-exact original source-map reconstruction and canonical Runtime src. -->
<!-- [Output] Explain original reference provenance, identical actual implementation and retained copyright. -->
<!-- [Pos] Source reference boundary; not a separate Runtime architecture. -->
<!-- [Sync] 2026-09-13: actual src uses identical original modules; remove the previous build-exclusion claim. -->

# Original source reference

`restored-src/src` and repository `src` have identical directories, module paths,
file modes and initial bytes: 1,902 files, 35 module directories, 30,382,832 bytes.
Repository `src` is the actual build input, entering `src/entrypoints/cli.tsx`.
This reference is not a side implementation beside a redesigned cleanroom Runtime.

Reference: `claude-code-sourcemap` commit
`a8a678cb6244e6770e1e421767ff0987a1d95549`, reconstructed from the public
`@anthropic-ai/claude-code@2.1.88` source map. Original names, bytes and permissions
are preserved without Ink headers. `source-snapshot.json` retains immutable provenance;
the current actual-build contract lives in `runtime/source-layout.json`.
Its historical `cleanroomNpmInput=false` field describes the former implementation,
not a prohibition on building the canonical original src now.

Original source is unofficial research material copyrighted by Anthropic PBC, not MIT.
Repository-authored selector/tooling licenses do not relicense these modules.
Source-derived artifacts honestly retain this provenance; public publication and
redistribution remain closed. Recovered dependencies/vendor, maps and generated bundles
are not checked into Git.

Run `node scripts/sync-restored-source.mjs verify` to check both complete trees.
