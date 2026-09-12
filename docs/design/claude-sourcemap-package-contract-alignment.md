<!-- [Input] Authorized read-only claude-code-sourcemap package/source inventory, Runtime 0.1.5 package policy, and Dream PreToolUse ZIP evidence. -->
<!-- [Output] Define the minimal package-identity and CLI compatibility alignment without copying vendor source or adding another Runtime framework. -->
<!-- [Pos] Design decision for the 2026-09-12 package-structure review requested after the workspace ZIP incident. -->
<!-- [Sync] 2026-09-12: record the source comparison, ownership boundary, corrected package identity, aliases, and release state. -->

# Claude sourcemap package contract alignment

## Background and problem

The workspace ZIP failure was initially attributed to the CLI migration. Source tracing disproved that premise: the mutating-command decision is made by Dream's `backend/libs/claude_agent_kit/server/agent_runner.py` PreToolUse hook before the Runtime receives an approved Bash command. Neither the restored `2.1.88` source nor this Runtime should gain a ZIP policy or a second filesystem state machine for that defect.

The follow-up review still found a real package-contract inconsistency. The authorized reference package at `/Users/dmeck/project/claude-code-sourcemap/package/package.json` has one package identity and exposes `claude` through its package-root CLI entrypoint. This repository's generated selector already exposed `claude` and `ink-claude-code-dream`, but the repository root used the unrelated unscoped name `ink-claude-code-dream` and declared only the latter command. Build policy, source package, and generated package therefore described different identities.

## Goals and boundaries

- Keep ZIP admission in Dream PreToolUse and leave Runtime argv, SDK JSONL, provider, MCP, session, transcript, sandbox, and process semantics unchanged.
- Make the repository package contract use the same owned scoped identity as the generated selector: `@glide-the/ink-claude-code-dream`.
- Expose `claude` as the compatibility command and retain `ink-claude-code-dream` as Dream's explicit resolver command; both resolve to the same entrypoint.
- Preserve the reference package's single-entrypoint compatibility shape without claiming Anthropic's package identity, author, license, or publication rights.
- Keep restored/vendor source external and read-only. The public MIT clean-room packages must not copy the restored source tree merely to imitate its physical directory names.
- Do not add a package manager, loader, dispatcher, wrapper protocol, or migration framework.

## Concepts and rules

| Concern | Reference fact | Runtime rule |
| --- | --- | --- |
| Package identity | `@anthropic-ai/claude-code` belongs to Anthropic. | Use the repository-owned `@glide-the/ink-claude-code-dream`; never impersonate the vendor scope. |
| CLI entry | The reference package maps `claude` to one CLI file. | Map both supported command names to one immutable Runtime entrypoint. |
| Source layout | The restored tree is a factual compatibility reference with upstream modules such as `tools/`, `cli/`, `services/mcp/`, and `utils/sandbox/`. | Reuse those facts when locating behavior, but do not copy proprietary modules into the public clean-room source. Existing Runtime modules remain responsible for their current contracts. |
| ZIP policy | No matching Runtime ZIP mutation policy exists in the reference tree. | Dream owns ordinary/protected workspace classification in PreToolUse; Runtime only executes an approved Bash command inside the supplied sandbox. |
| Generated packages | The reference npm artifact is one JavaScript package; this Runtime ships a native selector plus target packages. | Keep the target split because native executable selection is an established deployment constraint, while enforcing one selector identity and one CLI behavior. |

`scripts/package-cleanroom-npm.mjs` now fails closed unless the root package name equals the selector name, the two command aliases match policy, and both aliases point to the same versioned entrypoint. The packaging test repeats that assertion independently.

Runtime `0.1.5` is the source candidate containing this alignment. As of 2026-09-12, an anonymous registry query lists only `0.1.0` through `0.1.4`; therefore this document does not claim that `0.1.5` is published or deployed. Dream may pin the prepared version in source, but a production build remains fail-closed until the same-SHA five-package publication and registry fresh-install gates complete.
