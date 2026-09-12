<!-- [Input] Authorized read-only Claude Code 2.1.88 package/source inventory, clean-room Runtime package/build policies, and Dream's resolver contract. -->
<!-- [Output] Record the evidence-led package restoration, deliberate compatibility differences, removed inventions, and closed 0.1.6 release gates. -->
<!-- [Pos] Canonical design decision for the 2026-09-12 CLI migration and package-structure correction. -->
<!-- [Sync] 2026-09-12: restore package/ as the selector source, bind cli.js end to end, and invalidate prior acceptance for the changed artifact. -->

# Claude sourcemap package contract alignment

## Decision

The repository now has two explicit package roles instead of one root manifest pretending to be both:

- root `package.json`: private build/test workspace named `ink-claude-code-dream`, with no `bin` and no publish surface;
- `package/`: the selector package source, with `package.json`, package-root `cli.js`, `README.md`, and `LICENSE.md`.

This restores the physical boundary seen in the authorized read-only reference while retaining Dream's already-required native four-package split. Generated `dist/cleanroom-npm/stage/**` directories are release outputs again, not an alternative source tree.

The workspace ZIP incident is outside this Runtime change. Dream's PreToolUse hook classifies and approves the Bash command before the Runtime executes it. ZIP policy remains owned by its separate task and is not duplicated in Runtime argv, tools, or sandbox code.

## Read-only evidence

The comparison used these local sources without modifying or copying them:

- `/Users/dmeck/project/claude-code-sourcemap/package/package.json`
- `/Users/dmeck/project/claude-code-sourcemap/package/cli.js`
- `/Users/dmeck/project/claude-code-sourcemap/package/README.md`
- `/Users/dmeck/project/claude-code-sourcemap/restored-src/src/`

The reference npm artifact is `@anthropic-ai/claude-code@2.1.88`, is an ES module, has no `exports`, and maps only `claude` to package-root `cli.js`. Its package directory also contains its license, lockfile, SDK type declarations, source map, and vendor audio/ripgrep binaries. `node package/cli.js --version` reports `2.1.88 (Claude Code)` and `--help` exposes the interactive and headless command surface.

The clean-room Runtime must not copy the reference source map, vendor binaries, recovered source, package identity, author metadata, license terms, or unsupported UI commands. Package-shape compatibility is not permission to redistribute unrelated material.

## Exact package mapping

| Concern | Reference 2.1.88 | Runtime 0.1.6 | Reason |
| --- | --- | --- | --- |
| Source boundary | `package/` is the npm package root | `package/` is the selector source root | Restores the real package/source separation |
| Package name | `@anthropic-ai/claude-code` | `@glide-the/ink-claude-code-dream` | Never impersonate the vendor scope |
| Module format | `type: module` | `type: module` | Required by package-root `cli.js` |
| Exports | absent | absent | A CLI package does not need an invented JS export map |
| Primary bin | `claude: cli.js` | `claude: cli.js` | Preserves CLI/SDK compatibility |
| Dream bin | absent | `ink-claude-code-dream: cli.js` | Existing fail-closed Dream resolver contract |
| Runtime body | JavaScript package plus bundled vendor assets | one selector plus exact native optional package | Existing four-target standalone deployment constraint |
| Mutable data | external | external | Never package sessions, transcripts, Workspace, OAuth, or credentials |

`runtime/cleanroom-npm-policy.json#metaPackage.sourceRoot` binds the source root to `package`; the packager validates the private workspace, source package identity/version, absence of `exports`, two aliases, exact `cli.js`, optional native package versions, and matching MIT license before staging. The tarball verifier independently checks package inventory, executable mode/hash, manifest entrypoint, capabilities, SBOM, notices, and target binding.

## Removed inventions and preserved Dream behavior

The review removed behavior that had no source or consumer evidence:

- fictional `fable-5` and `mythos-5` output/effort model heuristics;
- silent acceptance of unknown long options, which hid package/CLI drift;
- the root workspace's false identity as the published selector package;
- the generated `bin/ink-claude-code-dream` selector as the meta-package source entrypoint.

The review restored or retained only evidenced behavior:

- package-root `--help` plus the reference's kebab/camel tool aliases;
- `--version` compatibility value `2.1.241 (Claude Code)` required by Dream;
- SDK stream-json/control/cancel, sessions/resume/transcripts, Workspace/cwd/TMPDIR, permissions/hooks/tools, plugins/Skills, MCP stdio/HTTP/OAuth/Resources/management, sandbox, and provider/gateway behavior;
- Dream's explicit command alias and manifest/capability/checksum qualification;
- Darwin/Linux arm64/x64 native optional packages and signal forwarding.

Interactive Ink UI, IDE/Chrome integration, updater/install flows, remote-control/team UI, telemetry, audio capture, and vendor ripgrep are not claimed by the clean-room selector. Unsupported options now fail closed rather than appearing to work.

## Build, release, and Dream consumption

The meta-package release manifest now declares `runtime.entrypoint: "cli.js"` beside that file. Platform packages keep their internal `runtime/bin/ink-claude-code-dream` native executable because the selector owns that private hop. Dream resolves the installed npm bin symlink to package-root `cli.js`, then validates the adjacent release manifest, exact Runtime version, protocol, capability evidence, and selector digest.

Version `0.1.6` is mandatory because source bytes, package inventory, selector digest, and manifest location changed. The digest-bound `0.1.5` Dream acceptance receipt remains immutable historical evidence and is not rebound or edited. For `0.1.6`, the checked policies therefore set all production, redistribution, publication, and four-target qualification states to false.

The `INK_CLEANROOM_QUALIFICATION_FIXTURE=provider-free-test` lane may build all targets, create five tarballs, verify them, fresh-install the selector/host package, run both aliases, and exercise Dream's resolver. Fixture manifests are marked and `npm pack` remains rejected by the staged prepack gate. This evidence is technical only; it does not publish, deploy, or substitute for same-SHA real-business acceptance and explicit release authorization.

## Rollback

The public `0.1.4` release and historical `0.1.5` receipt are unchanged. Before a future `0.1.6` publication, rollback is simply to keep Dream production on its last qualified public Runtime; source that pins `0.1.6` must fail closed until the five-package registry set exists. After any future publication, rollback must change Dream's exact Runtime version and resolver evidence atomically rather than using an ambient `claude` or `CLAUDE_CODE_CLI_PATH` shortcut.
