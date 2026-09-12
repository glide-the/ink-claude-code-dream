<!-- [Input] Canonical selector package metadata and generated native package contract. -->
<!-- [Output] Explain the package-root CLI entrypoint, supported aliases/targets, and excluded mutable data. -->
<!-- [Pos] npm selector package README copied unchanged into the generated package. -->
<!-- [Sync] 2026-09-12: restore the package-root cli.js layout for Runtime 0.1.6. -->

# @glide-the/ink-claude-code-dream

Dream-compatible Claude CLI package. Like the reference `@anthropic-ai/claude-code` npm artifact, the package exposes a package-root `cli.js` entrypoint. Both `claude` and `ink-claude-code-dream` resolve to that one file.

The entrypoint selects the exact optional native package for Darwin/Linux on arm64/x64. Session data, Workspace content, transcripts, credentials, OAuth material, source maps, and restored source are not included.

This checked-in directory is a private release template. Use the repository packaging and verification commands; do not publish it directly.
