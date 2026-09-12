<!-- [Input] Clean-room Runtime tooling, authorized external restored source, capability profile, compatibility policies, and verification evidence. -->
<!-- [Output] Explain the qualified local minimal-core workflow, published clean-room Runtime, legacy envelope, and safe Git/release boundary. -->
<!-- [Pos] Operator-facing entry point for ink-claude-code-dream. -->
<!-- [Sync] 2026-09-02: add the reviewed ext-apps development-Skills Marketplace and state its non-Host boundary. -->
<!-- [Sync] 2026-09-12: restore a package-root 0.1.6 selector source, remove invented CLI behavior, and close changed-artifact release gates. -->
<!-- [Sync] 2026-08-28: prepare clean-room Runtime 0.1.3 with model-bounded max_tokens and conditional effort projection. -->
<!-- [Sync] 2026-08-30: authorize Runtime 0.1.4 clean-room publication after Notion acceptance and four-target qualification. -->
<!-- [Sync] 2026-08-30: restore the 2.1.88 local-core Linux seccomp path with the Docker-style passthrough. -->
<!-- [Sync] 2026-08-30: record the completed Runtime 0.1.4 same-SHA npm publication and public-registry verification. -->

# ink-claude-code-dream

This private repository builds a locally packaged, IM-focused Claude Runtime named `ink-claude-code-dream`. Its primary path uses the user-authorized Claude Code `2.1.88` restored source as an external local input and Bun `1.4.0` compile-time feature DCE. Generated core and package files go only to Git-ignored `dist/core-local/` and `dist/core-package-local/`; Git stores the repository-authored, source-bound transformation builder, capability profile, resolution map, tests, manifests, and documentation. This is technical provenance, not a license conclusion.

The current Linux x64 local-core was built and qualified in a privileged Docker harness from source digest `470ca57d6390e2f9df5e2bb0a6f32b8b62c64f262ae3d02a31349488a08c228e`; its bundle SHA-256 is `a5827e0e6a1f5c3f09f5c4ceca66122893e531d3f31a644811273bae89487e9a`. SDK/Bash, stdio/HTTP MCP, MCP management, OAuth, static contracts, compatibility tests, and lint all exited 0. The qualified package has 64 files, 63 checksum entries, artifact-tree SHA-256 `b69f165f21a333489f35d1fb6e4e55c03b41a61fd11746e75163422505bbcb77`, and `productionEligible=true`. Source provenance remains `2.1.88`; `2.1.241` is only the separately qualified Dream-facing CLI compatibility value. The current profile restores the Linux-only disk path that the 2.1.88 sandbox code searches: `chunks/vendor/seccomp/<arch>/apply-seccomp` is the Docker-style passthrough with SHA-256 `bd2923ee44c624e03bac9efb57c84d72419726783ac7557acb708e431c16d74d`, and `unix-block.bpf` is checksum-pinned from `@anthropic-ai/sandbox-runtime@0.0.45`.

This is a technical artifact decision, not a publication or deployment grant: `productionEligible=true`, while `publicationAllowed=false` and `redistributionAllowed=false`. The Dream manifest gate and backend suite passed (1,954 passed, 24 skipped, 607 subtests), the current standard Runtime run passed 44 tests with 2 external OAuth-fixture tests skipped, and the current custom-core real Dream main journey passed. The official MCP Python SDK `2.0.0` fixture at commit `6f69a3758ebf2ee55ce050f58b470ce11af71133` separately passed the complete OAuth CLI contract 3/3 through pipe and real-PTY lanes. The final real Comfy acceptance also passed through Dream's public configure/auth/callback/inventory/logout/remove path: `comfyui-cloud` `0.40.1` connected with 41 tools and a complete 16-stage safe receipt ending in `credentials_present` → `flow_resolved` → `success_stdout_flushed`.

The existing Node supervisor/envelope and its `dist/release/` receipts remain a historical process-boundary and rollback baseline. Its green tests do not prove the minimal core.

Runtime `0.1.6` restores the reference artifact's physical package boundary: the repository root is again only the private build workspace, while [`package/`](package/) owns the selector package's `package.json`, package-root `cli.js`, README, and license. The selector intentionally has no `exports`; both `claude` and Dream's explicit `ink-claude-code-dream` alias resolve to `cli.js`, which selects one exact native optional package. This preserves Dream's four-target standalone distribution without pretending that generated staging directories are source packages.

The source comparison and deliberate differences are documented in [Claude sourcemap package contract alignment](docs/design/claude-sourcemap-package-contract-alignment.md). The review removed unsupported fictional model-family heuristics and silent unknown-option acceptance, and added only the truthful help/tool aliases present in the reference CLI contract. It does not copy restored/vendor code, reuse the Anthropic package identity, add ZIP policy, or claim interactive Ink/IDE/updater support. Because these changes produce a new source tree and package layout, all `0.1.6` production, redistribution, publication, and target-qualification gates are closed. The immutable `0.1.5` acceptance receipt remains historical evidence only and cannot authorize `0.1.6`.

The clean-room Runtime `0.1.4` adds the stable `sandbox.notion-cli` capability for production Bash only. At each fresh or resumed Runtime start it validates an exact canonical `{workspace}/.notion-home`, fixes `NOTION_KEYRING=0`, accepts only an optional nonempty single-line token and an exact existing `workers.json`, and admits only a native owner/root `ntn` plus the three required HTTPS hosts. Invalid, ambient, foreign-thread, or stale projections remain unset. Provider helpers and stdio MCP children explicitly remove these names. The exact darwin-arm64 executable passed a normal three-turn Dream Chat journey covering fresh Bash, same-thread resume, read-only `ntn` doctor/identity, and ordinary Chat. Four target formats, five-package reproducibility, and explicit public npm authorization were checked; main commit `0ebafe95db22101cf77db2c27e73b561d3af37a6` then passed qualification run `33306855166` and published all four platform packages before the selector in run `33306940462`. This claim does not apply to the restored-source local core. See the [Notion CLI sandbox task record](docs/notion-cli-sandbox-task.md).

## Capability boundary

Keep: headless SDK JSON/JSONL, streaming/control/cancel, session/transcript/resume, tool use/result and permission confirmation, Workspace/cwd/files, sandbox and exact `CLAUDE_CODE_TMPDIR`, MCP stdio/HTTP/OAuth/Resources/inventory, plugins, Slash Skills, hooks, ordinary Agent/Task subagents, authentication, and gateway/provider behavior.

Remove after graph proof: CCR/Remote Control bridge, swarm/team/teammate collaboration UI, interactive Ink REPL, IDE auto-connect/UI surface, updater command/UI, and feedback/reporting command/UI.

Defer: telemetry, shared diagnostics, and shared `autoUpdater.ts` logic. A name that looks unrelated is not deletion evidence.

## Claude Plugin Marketplace

This repository exposes a reviewed local Marketplace catalog. Its `mcp-apps` entry pins the official `modelcontextprotocol/ext-apps` development Skills at commit `10195ad91851502134930e9b80ec2c04e277a720`:

```text
/plugin marketplace add /absolute/path/to/ink-claude-code-dream
/plugin install mcp-apps@ink-claude-code-dream
```

The installed plugin contains four authoring/migration Skills. It does not contain or start an MCP server, and it does not add MCP Apps UI hosting to this headless Runtime. The Runtime currently supports ordinary MCP tool/resource flows only; installing the Skills must not be presented as MCP Apps protocol availability. See the [MCP Apps Marketplace and Host design](docs/design/mcp-apps-marketplace-and-host.md) for the compatibility evidence, product states, security boundary, and phased Host plan.

## Local core build

The exact external source root must be absolute, normalized, and not a symlink:

```sh
bun install --frozen-lockfile

INK_AUTHORIZED_CORE_SOURCE_ROOT=/absolute/path/to/claude-code-sourcemap/restored-src \
  bun run build:core-local

INK_AUTHORIZED_CORE_SOURCE_ROOT=/absolute/path/to/claude-code-sourcemap/restored-src \
  bun run verify:core-local
```

Both commands now complete with a zero-gap receipt for the exact source digest above. A later source, profile, transformation, or bundle hash drift must fail closed and requires fresh qualification; a DCE receipt by itself is never sufficient.

## Local installation

After qualification and packaging, install the Runtime and its exact Bun toolchain into the user's local prefix:

```sh
node scripts/package-core-local.mjs
node scripts/install-core-local.mjs
```

The installer re-verifies `productionEligible=true`, copies the release and Bun `1.4.0` into content-addressed directories under `~/.local/share/ink-claude-code-dream/`, and atomically installs `~/.local/bin/ink-claude-code-dream` plus `~/.local/bin/ink-claude-code-bun-1.4.0`. It does not replace or upgrade ambient `bun`; the Runtime launcher selects the versioned executable first, with `INK_CLAUDE_CODE_BUN_PATH` retained only as an explicit operator override. Dream therefore resolves the manifest-qualified Runtime through ordinary `PATH` without a `CLAUDE_CODE_CLI_PATH` bypass.

## Separate MCP compatibility layer

`compat/mcp-auth/` records repository-authored, source-bound policies/tests for the Claude Code `2.1.238` and `2.1.239` MCP deltas: trusted `headersHelper` scope/cwd and credential filtering, plus bounded transient-5xx reconnect with non-retryable 401/403 and redacted errors.

The separate patch is source-bound and applied to the qualified headless artifact; all six required transform IDs are present. Restored OAuth/DCR/PKCE/token/revoke behavior remains the base implementation, while the newer patch covers the narrowly evidenced deltas without creating a second MCP or Agent state machine. MCP protocol and management receipts are bound to the same bundle/source hashes as the SDK differential.

The OAuth repair keeps Commander `mcp login --no-browser` headless semantics, uses the same `http://localhost:3118/callback` in the advertised and submitted redirect without opening a competing listener, and works with both pipe stdin and a real PTY; PTY cleanup explicitly pauses stdin so the process exits deterministically. DCR client information is memoized only for the provider instance lifetime. When a valid explicit `CLAUDE_SECURESTORAGE_CONFIG_DIR` is present, the Runtime fixes secure storage to that actor-owned `0700` directory's `0600` `.credentials.json` and never invokes the user's macOS keychain; without the selector, official keychain behavior remains unchanged. Token persistence must report save success and a `credentials_present` postcondition. Failures are mapped to a fixed safe classification, and the bounded receipt contains only allowlisted stages, sequence, and timestamp—never server identity, URLs, OAuth parameters, credentials, or error text.

The preceding candidate's real Comfy run reached `token_save_completed` and then `credentials_missing`: macOS keychain primary storage shadowed the actor plaintext fallback. The selector-pinned rule above removes that mixed-storage ambiguity. The official OAuth contract uses a fake `security` sentinel to prove that an actor-selector run never calls macOS `security`, and its `waitForExit` helper handles processes that exited before listener registration. The final real Comfy rerun passed with the selector credential as a regular `0600` file and no `flow_failed` stage.

```sh
bun run test:mcp-auth-compat
```

## SDK and Dream integration

Dream installs `ink-claude-dream-agent-sdk==0.2.145` while keeping the upstream `claude_agent_sdk` import namespace and launcher. Official and custom Runtimes are selected through the existing absolute CLI-path injection point. No Dream business implementation is required to switch between them.

Runtime acceptance has three ordered layers:

1. static build/metafile evidence;
2. SDK/CLI protocol-level differential against official `2.1.241`;
3. real Dream/Admin/Gateway/PostgreSQL business acceptance.

The interface differential is the primary compatibility gate; UI/business coverage cannot prove every Runtime contract by itself.

## Repository and publication boundary

The restored source is a read-only local build input. Git contains only replayable repository-authored builders, patches, manifests, tests, and documentation; it does not contain the restored source or generated artifact. No Anthropic redistribution authorization has been obtained, so the restored source and derived artifact must not be publicly published or redistributed. Credentials, complete environment data, transcripts, Workspace content, and materialized plugins are likewise excluded.

The final exact-Node verification command, `PATH=/Users/dmeck/.nvm/versions/node/v24.13.0/bin:$PATH bun run verify`, exited 0: Node 44 passed with 2 external OAuth-fixture tests skipped, MCP compatibility 46 passed with 6 authorized-source fixtures skipped, and the SDK contract, acceptance, release verification, and archive reproducibility all passed. A separate authorized-source replay, `INK_AUTHORIZED_CORE_SOURCE_ROOT=/Users/dmeck/project/claude-code-sourcemap/restored-src bun --cwd compat/mcp-auth test`, then executed those six fixtures and passed 52/52 with zero failures. The archive SHA-256 is `64c919d1f11b2770497a080c4cdeb8587925f45d928912459b31647e1b68eb38`; checksum-inventory SHA-256 is `61e12c7c1828c05fb6e70535abb36ff1fbe924aaba2d78787b9ce8e832b3947c`.

The official CLI `2.1.241` remains the current behavior comparator and direct rollback target. It is not the source of this core: the implementation is restored `2.1.88` plus the separate `2.1.238`/`2.1.239` MCP compatibility patch and source-bound OAuth repair. The custom package business path and final real Comfy lane passed. Authenticated Admin UI evidence remains unavailable because no administrator browser session was supplied; publication/redistribution remain prohibited.

### Linux seccomp 恢复与容器兼容

2.1.88 的 sandbox adapter 不会从 Dream `settings.json` 转发 `sandbox.seccomp`；它依赖 sandbox-runtime 从 bundle chunk 相邻目录自动发现 `vendor/seccomp/<arch>`。因此这里恢复的是实际磁盘资产和摘要约束，不是新增一个无效的 settings 配置项。

Linux local-core 构建时直接把 [`runtime/seccomp/apply-seccomp-passthrough-v2.1.88.sh`](runtime/seccomp/apply-seccomp-passthrough-v2.1.88.sh) 放到该 `apply-seccomp` 路径，不存在部署后再覆盖的第二套模式。2.1.88 会把 BPF 路径作为第一个参数传给 helper，所以该脚本先 `shift` 再 `exec "$@"`；这是同一个 Docker workaround 对 2.1.88 argv 的适配。它只关闭 Unix socket seccomp 层，不会赋予 bubblewrap 创建 user/mount namespace 的宿主权限。

See the [canonical design](docs/design/claude-code-runtime-minimalization.md), [build guide](docs/build/README.md), and [test guide](docs/test/README.md).

## npm 发布状态

仓库根 `package.json` 是私有构建编排器和历史 envelope，不是发布包；它不再冒充 selector，也不声明 `bin`。可审查的发布源位于 `package/`，结构为 package-root `package.json` + `cli.js`，并由 `runtime/cleanroom-npm-policy.json` 绑定为 `@glide-the/ink-claude-code-dream` 顶层选择包，加 Darwin/Linux 的 arm64/x64 四个平台包。每个平台必须使用同平台 qualification、ripgrep 和 `bun@1.4.0`，Windows 暂无完整证据并 fail-closed。

clean-room `0.1.3` 的历史发布回执仍保留；`0.1.4` 已完成公开发布。main
`0ebafe95db22101cf77db2c27e73b561d3af37a6` 的 qualification run `33306855166` 与 publish run
`33306940462` 均成功，发布顺序为四个平台包后 selector。五个 registry tgz 与 qualification
SHA-256 逐包一致，fresh install 的两个 CLI alias 均输出 `2.1.241 (Claude Code)`；包清单和 tgz
不含 `*.map`。历史 restored-source/local-core 路径仍禁止发布。
`0.1.5` 的 digest-bound Dream 验收仍作为不可变历史文件保存。`0.1.6` 是本次 package-root 修复候选；其新 source tree 尚无同 SHA 真实业务验收和四目标资格回执，所以 checked policy 明确设置 `productionEligible=false`、`publicationAllowed=false`、`redistributionAllowed=false`、`npmPublishAllowed=false`。本地 `provider-free-test` fixture 只允许构建、五包打包、fresh install、Dream resolver 和协议验证，不会解除发布 gate。
详见 [npm 多平台发布设计](docs/design/npm多平台发布设计.md)。
