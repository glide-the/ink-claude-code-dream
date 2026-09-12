<!-- [Input] Exact Claude Code 2.1.88 restored-source subtree, package inventory, clean-room policies, and Dream's resolver contract. -->
<!-- [Output] Record byte-exact source/package restoration, research licensing, preserved compatibility, and closed 0.1.7 release gates. -->
<!-- [Pos] Canonical design decision for the complete sourcemap package-structure correction. -->
<!-- [Sync] 2026-09-13: restore all 1,902 source files and 35 original module directories, without admitting them into public clean-room packages. -->

# Claude sourcemap package contract alignment

## Decision

The repository now preserves the reference source layout and separates three roles:

- `restored-src/src/`: the complete byte-exact research-source subtree from `claude-code-sourcemap`, with its original paths and no Ink rewrites;
- root `package.json`: private mixed-source build/test workspace named `ink-claude-code-dream`, with `UNLICENSED`, no `bin`, and no publish surface;
- `package/`: the selector package source, with `package.json`, package-root `cli.js`, `README.md`, and `LICENSE.md`.

The existing independent `src/cleanroom/` implementation is an additive clean-room layer, not a renamed or replacement version of the reference source tree. It remains the only public Runtime build input. Generated `dist/cleanroom-npm/stage/**` directories are release outputs, not source packages. Dream's required native four-package split is unchanged.

The incomplete `0.1.6` correction restored only the outer `package/cli.js` selector shape and incorrectly treated artifact exclusion as a ban on keeping research source in the repository. `0.1.7` corrects that distinction. `0.1.6` was unpublished and is superseded.

The workspace ZIP incident is outside this Runtime change. Dream's PreToolUse hook classifies and approves the Bash command before the Runtime executes it. ZIP policy remains owned by its separate task and is not duplicated in Runtime argv, tools, or sandbox code.

## Read-only evidence

The reference checkout remained read-only. The comparison used:

- `/Users/dmeck/project/claude-code-sourcemap/package/package.json`
- `/Users/dmeck/project/claude-code-sourcemap/package/cli.js`
- `/Users/dmeck/project/claude-code-sourcemap/package/README.md`
- `/Users/dmeck/project/claude-code-sourcemap/restored-src/src/`

The reference npm artifact is `@anthropic-ai/claude-code@2.1.88`, is an ES module, has no `exports`, and maps only `claude` to package-root `cli.js`. Its package directory also contains its license, lockfile, SDK type declarations, source map, and vendor audio/ripgrep binaries. `node package/cli.js --version` reports `2.1.88 (Claude Code)` and `--help` exposes the interactive and headless command surface.

Only the `restored-src/src` subtree is synchronized into the repository. Reference source maps, vendor binaries, recovered `node_modules`, package identity, author metadata, and package artifacts are not copied. The clean-room Runtime must not import or embed the checked restored source. Package-shape compatibility is not permission to redistribute unrelated material.

## Exact restored-source structure

The snapshot is bound to source commit `a8a678cb6244e6770e1e421767ff0987a1d95549` and Git subtree `7640f58ea271eb60952ebdbe0dfa173fc96ebe30`. It has 1,902 regular files, 30,382,832 bytes, and these 35 original top-level module directories:

```text
assistant bootstrap bridge buddy cli commands components constants context coordinator
entrypoints hooks ink keybindings memdir migrations moreright native-ts outputStyles
plugins query remote schemas screens server services skills state tasks tools types
upstreamproxy utils vim voice
```

Original root modules such as `main.tsx`, `query.ts`, `Tool.ts`, and `Task.ts` are also preserved. No file is renamed, reformatted, or given Ink headers; no per-module `.folder.md` is injected into the exact subtree. `restored-src/source-snapshot.json` records the ASCII-path-ordered SHA-256 inventory `40269454cd690c74d129a31699935d6db713f2958aabe4787e01617e1c92a906`. Run `node scripts/sync-restored-source.mjs verify`; lint and the dedicated regression test invoke this gate automatically.

The source is an unofficial reconstruction from the public `@anthropic-ai/claude-code@2.1.88` source map, not an assertion about Anthropic's official internal repository. Copyright remains Anthropic PBC. The checked research snapshot is not MIT-licensed and has no publication/redistribution grant. The root package is therefore `UNLICENSED`, while the independent selector and clean-room artifacts retain MIT. Clean-room source graphs, npm staging, tarballs, and SBOM provenance continue to exclude every `restored-src` input. The local historical core builder still requires an explicit complete authorized source root (including recovered dependencies) and package assets; the checked `src`-only snapshot does not silently satisfy that separate build contract.

## Exact package mapping

| Concern | Reference 2.1.88 | Runtime 0.1.7 | Reason |
| --- | --- | --- | --- |
| Source boundary | `package/` is the npm package root | `package/` is the selector source root | Restores the real package/source separation |
| Restored modules | `restored-src/src`, 1,902 files | same paths and exact Git subtree | Original research structure is preserved, not redesigned |
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

Version `0.1.7` is mandatory because the repository source inventory and research boundary changed after the unpublished `0.1.6` candidate. Runtime manifests, optional packages, local-core receipts, and Dream's exact Runtime contract move atomically to `0.1.7`; SDK remains `0.2.145`. The digest-bound `0.1.5` Dream acceptance receipt remains immutable historical evidence and is not rebound or edited. Every `0.1.7` production, redistribution, publication, and four-target qualification gate remains false.

The `INK_CLEANROOM_QUALIFICATION_FIXTURE=provider-free-test` lane may build all targets, create five tarballs, verify them, fresh-install the selector/host package, run both aliases, and exercise Dream's resolver. Fixture manifests are marked and `npm pack` remains rejected by the staged prepack gate. This evidence is technical only; it does not publish, deploy, or substitute for same-SHA real-business acceptance and explicit release authorization.

## Rollback

The public `0.1.4` release and historical `0.1.5` receipt are unchanged. Before a future `0.1.7` publication, rollback is simply to keep Dream production on its last qualified public Runtime; source that pins `0.1.7` must fail closed until the five-package registry set exists. After any future publication, rollback must change Dream's exact Runtime version and resolver evidence atomically rather than using an ambient `claude` or `CLAUDE_CODE_CLI_PATH` shortcut.
