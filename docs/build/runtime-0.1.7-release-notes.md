<!-- [Input] Exact restored-source snapshot, Runtime 0.1.7 policies, Dream contract, and provider-free validation lane. -->
<!-- [Output] Explain the complete structure correction, licensing, version impact, validation scope, and remaining release gates. -->
<!-- [Pos] Unpublished candidate note; it is not a publication or deployment announcement. -->
<!-- [Sync] 2026-09-13: restore the original sourcemap module tree and supersede the incomplete 0.1.6 candidate. -->

# Runtime 0.1.7 source-structure candidate

> Superseded by [0.1.8](runtime-0.1.8-release-notes.md). This historical candidate
> restored only a side snapshot while retaining a separate Runtime implementation;
> it did not satisfy the required identical-directory/identical-module build contract.

`0.1.7` restores the complete `claude-code-sourcemap/restored-src/src` subtree: 1,902 files,
30,382,832 bytes, 35 original top-level module directories, and the original root modules.
No source file is renamed, reformatted, or given Ink headers. The reference checkout remains read-only.
Source commit is `a8a678cb6244e6770e1e421767ff0987a1d95549`; Git subtree is
`7640f58ea271eb60952ebdbe0dfa173fc96ebe30`. The deterministic ASCII-path byte inventory is
`40269454cd690c74d129a31699935d6db713f2958aabe4787e01617e1c92a906`.

The incomplete `0.1.6` candidate restored only the outer selector shape and was never published.
It is superseded. The existing `package/cli.js` selector and independent `src/cleanroom/` layer
remain additive package/build roles, not substitutes for the restored source layout.

The snapshot is unofficial research material copyrighted by Anthropic, not MIT code or an
authorization to redistribute. The private mixed-source root package is `UNLICENSED`; the
independent clean-room selector/artifacts remain MIT. Lint admits only the exact verified snapshot.
Clean-room source graphs, npm staging, tarballs, and SBOM provenance continue excluding restored
source. Source maps, vendor binaries, recovered dependencies, user data, and generated derived
artifacts are not added to Git.

Runtime identities, optional native package versions, local-core receipt bindings, and Dream's
exact Runtime contract move atomically to `0.1.7`. SDK remains `0.2.145`. Dream still resolves
the npm bin symlink to package-root `cli.js` and validates its adjacent release manifest.
No ZIP policy or unrelated Dream business behavior is changed.

Run `node scripts/sync-restored-source.mjs verify`, lint, the full provider-free Runtime suite,
and the four-target/five-package fresh-install lane with the actual Dream resolver. The dedicated
source-structure regression requires all original directories and exact bytes. Fixture packages
are marked, restored-source-free, and still rejected by their publication/prepack gate.

## Local validation on 2026-09-13

Exact Node `24.13.0` / Bun `1.4.0`, the existing pinned dependency install, the updated isolated
Dream checkout, and its installed SDK `0.2.145` were used. The full `npm test` exited 0:
136 tests, 132 passed, 0 failed, 4 skipped. The four skips are the two unavailable official
`2.1.241` comparator lanes and the external pinned Python SDK pipe/PTY OAuth fixture lanes.
The four-target/five-tarball build, temporary fresh install, actual Dream resolver, authorized
native fixture, and research-source exclusion lanes passed. No model/provider or real-user
business acceptance is implied.

Snapshot verification and lint also passed. The explicit authorized-source MCP compatibility
replay passed 52/52 with zero skips/failures. The SDK direct/envelope contract, provider-free
acceptance, and release inventory verification exited 0 (`sdkModified=false`, `coreBundled=false`).
The real-core acceptance probe was intentionally not enabled. Two deterministic build/pack passes
produced the same archive SHA-256 `4cf7133ec809693cafd29e9f7cb2d87f78efa09fc0bef1c3ca560acf472b0a0e`
and checksum-inventory SHA-256 `446b53ea3162b02ce969318c00bd9519086d55fb7429c304812ff9d944b36676`.
These hashes identify the historical Node envelope qualification output, not a publication receipt
for the standalone clean-room five-package set or a source-derived minimal core.
Repository-authored staged changes pass `git diff --cached --check -- . ':(exclude)restored-src/src'`.
The restored subtree intentionally retains the reference's pre-existing whitespace, including
prompt-string spaces; its byte inventory and exact Git subtree identity take precedence over
formatting that would change the recovered source.

The first sandbox run was not accepted: local-port/socket permissions, a root-owned npm cache,
and restricted fixture dependency access caused harness failures. The successful rerun used
an isolated temporary npm cache and permission for local test processes/temporary installs;
it did not change the production dependency environment, publish, or deploy.

The immutable `0.1.5` acceptance receipt is historical only. All `0.1.7` production, publication,
redistribution, npm publish, and target-qualification gates remain false. Future publication
requires new same-SHA business acceptance, target qualification, explicit release authorization,
ordered five-package publication, and registry fresh-install evidence. No remote push, publish,
or deployment is part of this change.
