<!-- [Input] Canonical src/reference inventories, actual original-module build and isolated Runtime/Dream validation. -->
<!-- [Output] Record the same-directory/same-module correction, versions, passing lanes and remaining skips. -->
<!-- [Pos] Local source integration candidate note, not a release/deployment or real-business receipt. -->
<!-- [Sync] 2026-09-13: original modules become the actual default implementation; retire parallel cleanroom. -->

# Runtime 0.1.8 original-module unification

`src` and `restored-src/src` have identical directory/module paths, permissions and
initial bytes: 1,902 files, 35 original directories, 30,382,832 bytes; inventory SHA-256
`40269454cd690c74d129a31699935d6db713f2958aabe4787e01617e1c92a906`.
Reference commit `a8a678cb6244e6770e1e421767ff0987a1d95549`, subtree
`7640f58ea271eb60952ebdbe0dfa173fc96ebe30`. Original source headers are unchanged.

The default `npm run build` compiles repository `src/entrypoints/cli.tsx`. The external
root supplies recovered dependencies/vendor only; its src is never used. Existing
headless/MCP compatibility transforms stay at build time. `src/cleanroom`, wrapper
modules and their separate builders/tests are removed from the active tree, recoverable
at commit `38fdd3c`. Retired policies are explicitly historical under runtime/history/0.1.7.
0.1.7's side-snapshot plus separate implementation was not the requested structure.

Runtime root/selector/target/local-manifest and Dream resolver/Docker/AutoDL pins are 0.1.8.
Dream backend/frontend metadata is 0.1.2/0.0.2. SDK remains 0.2.145, source provenance
2.1.88, CLI compatibility 2.1.241 and API schema 2.0.0. No API/DB/ZIP/business policy changes.

## Local validation — 2026-09-13

Exact Node 24.13.0/Bun 1.4.0, existing locked repository dependencies, installed
unmodified SDK 0.2.145 and disposable HOME/workspace/fake providers were used.
Tests/build stages follow luna-test-stage; new local port permissions were handled
by the primary agent. No real model/provider, user credentials or production service was used.

| Lane | Result |
| --- | --- |
| Both source inventories and lint | pass; canonical src, 1,902 files, 35 directories |
| Default original-source build and verification | pass; 1,989 inputs, 48 outputs, zero gaps, 88 disabled features/DCE assertions passed |
| npm test | 36 total; 32 passed, 0 failed, 4 skipped |
| MCP auth compatibility, including default canonical source with no external source env | 52 passed, 0 failed, 0 skipped |
| Actual bundle SDK contract | pass: Unicode streaming, init/control/permission, Bash/write, credential-read deny, 0700 tmpdir, Skills/hooks/subagent, transcript/session/resume and interrupt |
| Actual bundle stdio/HTTP MCP | pass: initialize ordering, colon-name tools/resources, disable/enable inventory, transient 503 recovery and sanitized 401 handling |
| Provider-free actual-bundle smoke | pass: version, empty MCP inventory and headless interactive-mode rejection |
| Two default original-source builds | same 50-file output inventory SHA-256 `3884683b020dd7e35f0557fb20fb774fd5e1c94273e00a53543c5c647f492f82` |
| Dream project/resolver/Docker contracts | 33 passed, 13 subtests passed |
| Dream startup validation/identity | 2 passed |
| Dream synthetic registry verifier (including isolated local wheel fixture) | 27 passed; no actual registry request |
| Final combined Dream focused suite | 62 passed, 13 subtests passed; 0 failed/skipped |
| AutoDL shell syntax and offline uv lock check | pass; uv.lock changes only project version |

Dream README mirrors have the same 13 command blocks (localized comments excepted),
version facts and heading structure; 37 changed-document local link targets exist.

The 4 Runtime skips are two unavailable official comparator lanes and two explicit
pinned official OAuth pipe/PTY fixtures. They are not reported as passed. The ordinary
MCP fixture requires MCP 2.0.0 in a separate disposable interpreter via
INK_MCP_FIXTURE_PYTHON; Dream's MCP 1.x dependency remains unchanged.

Original modules retain Anthropic copyright. Combining their structure with the actual
build is supported; source-derived publication and redistribution still lack separate
authority. Candidate production/four-target/fresh-registry/real-business qualification
is not inherited from old MIT implementation receipts. CI no longer builds removed
cleanroom code or bans original source. Qualification/publish workflows fail closed
without tokens, downloads of old artifacts or publish steps.

This source correction does not push, publish, install a production Runtime or deploy.
The 114 pre-existing tracked dist/release files are retained unchanged as historical receipts;
no new generated artifacts are staged, and current core output remains Git-ignored.
Old immutable receipts remain unchanged. See [alignment](../design/claude-sourcemap-package-contract-alignment.md).
