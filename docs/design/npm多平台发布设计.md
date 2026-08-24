<!-- [Input] npm/local artifact policies, native Runtime assets, Bun package contract, and legal qualification gates. -->
<!-- [Output] Define the Chinese architecture and fail-closed workflow for scoped multi-platform npm delivery. -->
<!-- [Pos] Authoritative npm publication design; it does not grant redistribution rights or contain Runtime source. -->

# 精简 Claude Runtime 的 npm 多平台发布设计

## 当前结论

仓库根包不是 npm 交付物。它仍是 `private=true`、`UNLICENSED` 的历史 envelope，`prepack` 和 `prepublishOnly` 会直接拒绝 `npm pack`/`npm publish`。真正的发布拓扑由 `runtime/npm-release-policy.json` 和 `scripts/npm-release.mjs` 生成：

- 顶层选择包：`@glide-the/ink-claude-code-dream`；
- 平台包：`@glide-the/ink-claude-code-dream-darwin-arm64`、`darwin-x64`、`linux-arm64`、`linux-x64`；
- 顶层包使用精确版本的 `optionalDependencies`，启动时按 `platform/arch` 只选择一个平台包；
- 每个平台包固定依赖 `bun@1.4.0`，prepack 和安装 smoke 都执行真实 `bun --version`；
- Runtime、qualification subject、release/artifact manifest、ripgrep 路径与 SHA-256 全部绑定同一个 native target。

当前 `runtime/local-artifact-policy.json` 仍为 `publicationAllowed=false`、`redistributionAllowed=false`，`runtime/npm-release-policy.json` 的发布许可证也仍为空。因此只能审查布局和运行 provider-free 合同测试，不能生成发布 staging、不能发布。这是预期的安全阻断，不是用环境变量可以绕过的开关。

## 平台与 native 资产矩阵

| target | npm 平台包 | ripgrep 资产 | 运行器 | 状态 |
| --- | --- | --- | --- | --- |
| `darwin-arm64` | `@glide-the/ink-claude-code-dream-darwin-arm64` | `arm64-darwin/rg`，SHA `051d…6684f` | `macos-15` | 生成器支持；发布前需该 target 独立完整 qualification |
| `darwin-x64` | `@glide-the/ink-claude-code-dream-darwin-x64` | `x64-darwin/rg`，SHA `3b8b…19f3` | `macos-15-intel` | 同上 |
| `linux-arm64` | `@glide-the/ink-claude-code-dream-linux-arm64` | `arm64-linux/rg`，SHA `fa8f…4385` | `ubuntu-24.04-arm` | 同上；GitHub ARM runner 的可用性属于 CI 风险 |
| `linux-x64` | `@glide-the/ink-claude-code-dream-linux-x64` | `x64-linux/rg`，SHA `55c2…9ea1` | `ubuntu-24.04` | 同上 |

builder 只允许 `target == process.platform-process.arch`。这避免在 Darwin ARM64 上把其 Bun、ripgrep、sandbox/native 证据误标为 Linux 或 x64。四个平台必须分别构建、分别完成 SDK/MCP/management/full qualification，再分别打包。

Windows 明确 fail-closed。虽然参考包里存在 Windows ripgrep，但没有当前 Windows Runtime、Bun、sandbox、shell/tool、native dependency 和 Dream 全业务验收证据；仅有一个二进制文件不能推出 Windows 兼容。Linux musl 也未进入支持矩阵。

## 包结构

```text
@glide-the/ink-claude-code-dream
  bin/ink-claude-code-dream
  npm-publication-attestation.json
  optionalDependencies -> 四个平台包的同版本

@glide-the/ink-claude-code-dream-<target>
  bin/ink-claude-code-dream-platform
  runtime/
    bin/ink-claude-code-dream
    lib/core/**
    manifest/**
    release-manifest.json
  dependency: bun@1.4.0
  npm-publication-attestation.json
```

顶层 shell launcher 只做平台选择，然后 `exec` 到平台 launcher，不常驻第二个 Node 监督进程。平台 launcher 解析该包依赖的 Bun，校验精确版本后，通过现有 `INK_CLAUDE_CODE_BUN_PATH` 合同执行 Runtime。Dream 仍只看到标准 CLI 路径和现有 SDK JSONL 接口。

## 发布安全门

按顺序全部满足才会产生 staging：

1. checked-in local policy 的 publication 和 redistribution 两个字段都为 true；
2. `verify-core-package-local.mjs` 证明 core `productionEligible=true`；
3. 包内 policy、artifact manifest、release manifest 也分别允许 publication/redistribution；
4. npm policy 存在经法律审查的非 `UNLICENSED` 发布许可证；
5. core receipt、三类 qualification、manifest 和目标平台一致；
6. 仅存在目标平台的 ripgrep，且校验和匹配；
7. native `platform/arch` 匹配，`bun@1.4.0` 实际探测通过；
8. staging、`npm pack --dry-run` 文件清单和最终 tgz 都没有任何 `**/*.map`；
9. tgz 不含 legacy `dist/release`、恢复源码、用户数据、凭据或可变 Runtime 数据；
10. clean install 后 CLI `--version` smoke 通过。

当前 local package builder/verifier还把法律字段固定为 false。取得书面授权后，需要一次可审查的代码变更同时更新 policy、manifest 模板、builder/verifier 和许可证；不能只翻一个 JSON 或注入环境变量。

## Trusted Publishing

`.github/workflows/qualify-npm-runtime.yml` 在四个带 `ink-runtime-qualification` 与 native target 标签的受控 self-hosted runner 上，分别执行 core build、SDK/MCP differential、Dream MCP management、OAuth aggregate qualification、package 与 verifier，输出四个 `qualified-core-<target>` artifact。`.github/workflows/publish-npm.yml` 只允许手工启动，并校验 qualification run 来自同仓库、指定 workflow、成功状态、当前精确 commit 与 ref；发布 job 才拥有 `id-token: write`。两条 workflow 使用的第三方 Action 全部固定到 40 位 commit SHA。

发布顺序是四个平台包后顶层选择包，命令统一带 `--access public --provenance`。由于 npm Trusted Publisher 只能为已经存在的包配置，首次创建这五个包必须由 `glide-the` 账户在启用 2FA 后手工 bootstrap；五个包都存在后再逐个配置 repository `glide-the/ink-claude-code-dream`、workflow `publish-npm.yml`、environment `npm`，后续才允许选择 `trusted_publishers_configured=true`。仓库不会保存长期 npm token。

npm 当前登录身份是个人 scope `glide-the`，没有同名 organization，因此包名固定为 `@glide-the/*`。当前账号未启用 2FA 是首次 bootstrap 的明确阻断项，不能由仓库脚本代替处理。

## 回滚

npm 包版本不可覆盖。出现平台问题时，先停止发布顶层新版本或对问题版本执行 npm deprecate，再让 Dream 的 `CLAUDE_CODE_CLI_PATH` 指回已经验证的官方 CLI。回滚不修改 Dream 状态机、数据库、transcript 或 Workspace 数据。禁止 unpublish 作为常规回滚方案。
