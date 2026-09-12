<!-- [Input] Runtime 0.1.6 source/package diff, historical 0.1.5 receipt, and provider-free package verification contract. -->
<!-- [Output] Release-candidate notes, upgrade impact, validation scope, and remaining publication actions. -->
<!-- [Pos] Build/release note for the package-root selector correction; it is not a publication announcement. -->
<!-- [Sync] 2026-09-12: document the 0.1.6 candidate and its deliberately closed release gates. -->

# Runtime 0.1.6 release-candidate notes

Runtime `0.1.6` restores `package/` as the selector package source and moves the public CLI entrypoint to package-root `cli.js`. The root `package.json` is now only the private build workspace. Both `claude` and `ink-claude-code-dream` continue to resolve to one selector, and the selector continues to dispatch to the exact Darwin/Linux arm64/x64 optional native package.

The candidate also removes unsupported `fable-5`/`mythos-5` heuristics, rejects unknown long options, and exposes a truthful headless help surface with the documented camel/kebab tool aliases. SDK stream-json, session/resume, tools/hooks/permissions, plugins/Skills, MCP, Workspace/TMPDIR, sandbox, provider, and signal behavior are preserved.

Dream must resolve the npm bin symlink to `cli.js` and validate the adjacent `release-manifest.json` with `runtime.entrypoint: "cli.js"`. Platform-package internal binaries remain private selector implementation details.

This is an unpublished candidate. The package/source digest differs from `0.1.5`, so that version's acceptance receipt cannot be reused. Checked policy keeps production, redistribution, publication, npm publish, and all target qualifications false. Provider-free five-package build/install/Dream-resolver validation is allowed only with the explicit fixture marker, and the generated prepack gate still rejects publication.

Before publication, operators must obtain new same-SHA four-target qualification, normal Dream/Admin/Gateway/PostgreSQL business acceptance, explicit npm release authorization, ordered four-platform-then-selector publication, and a registry fresh-install receipt. No remote publish or deployment is part of this candidate.
