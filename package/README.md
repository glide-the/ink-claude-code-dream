<!-- [Input] Canonical selector package metadata and generated native package contract. -->
<!-- [Output] Explain the package-root CLI entrypoint, supported aliases/targets, and excluded mutable data. -->
<!-- [Pos] npm selector package README copied unchanged into the generated package. -->
<!-- [Sync] 2026-09-13: bind the repository-authored package-root selector to original-module Runtime 0.1.8. -->

# @glide-the/ink-claude-code-dream

Dream-compatible Claude CLI package. Like the reference `@anthropic-ai/claude-code` npm artifact, the package exposes a package-root `cli.js` entrypoint. Both `claude` and `ink-claude-code-dream` resolve to that one file.

The entrypoint selects the exact optional native package for Darwin/Linux on arm64/x64. Its implementation is built from the repository's original src modules; raw TypeScript, source maps and user/session/Workspace/OAuth data are excluded. Original source copyright remains applicable to derived native artifacts; the selector's MIT license does not relicense them.

This checked-in directory is a private release template. Use the repository packaging and verification commands; do not publish it directly.
