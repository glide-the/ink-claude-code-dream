<!-- [Input] Canonical original Runtime modules, selector source and current source-derived package gates. -->
<!-- [Output] Define the four-native/selector plan without inheriting old MIT implementation authorization. -->
<!-- [Pos] Current package topology and closed qualification/publication contract. -->
<!-- [Sync] 2026-09-13: original src replaces parallel cleanroom; old publishing lane is retired. -->

# Runtime npm 多平台发布设计

## 当前实现和状态

只有一套实现：canonical `src`，与 `restored-src/src` 同目录同模块同初始字节/权限。
默认编译 `src/entrypoints/cli.tsx`，现有 headless/MCP 变换由构建层应用。
外部 recovered root 只提供 dependencies/vendor assets，不提供第二套 src。
旧 `src/cleanroom` 和其五-native fixture packager 已退出，可从 Git commit 38fdd3c 恢复。

0.1.8 root、selector、native expectations、local manifests 和 Dream pins 同步更新。
Darwin ARM64 原始模块编译/协议/复现性已验证；不能沿用旧四目标或 MIT 发布回执。
当前 `runtime/local-artifact-policy.json` 仍关闭 production/publication/redistribution；
`runtime/npm-release-policy.json#publish.license` 为 null，原始来源不能冒充 MIT。

`package/` 只拥有 repository-authored selector，保持参考 package-root
package.json + cli.js 形状。两个 alias 指向同一个 cli.js，selector MIT 不重新许可
其选择的原始源码派生 Runtime。根 package 私有 UNLICENSED、无 bin，根 pack/publish 拒绝。

## 五包计划与资格

| 包/target | 身份 | 新资格要求 |
| --- | --- | --- |
| selector | @glide-the/ink-claude-code-dream@0.1.8 | 原始 package-root cli.js，四个同版本 optional dependencies，manifest/selector digest |
| darwin-arm64 | @glide-the/ink-claude-code-dream-darwin-arm64@0.1.8 | 原始模块 Mach-O arm64，同宿主真实协议/sandbox/业务和制品验证 |
| darwin-x64 | @glide-the/ink-claude-code-dream-darwin-x64@0.1.8 | 同版本原始实现、同宿主 native execution 与新摘要资格 |
| linux-arm64 | @glide-the/ink-claude-code-dream-linux-arm64@0.1.8 | 同宿主 ELF/sandbox/工具与 checksum-pinned ripgrep/seccomp assets |
| linux-x64 | @glide-the/ink-claude-code-dream-linux-x64@0.1.8 | 同宿主 ELF/sandbox/工具与 checksum-pinned ripgrep/seccomp assets |

Native magic、交叉编译或 fixture pass 不等于目标宿主业务资格。Windows、musl 等
缺少完整证据的目标仍 fail closed。Bun 1.4.0 工具链/依赖/LICENSE/SBOM/checksum、
原始 source provenance、所有输出、manifest 和同 SHA 资格必须互相绑定。

当前 npm 计划命令可读，不能发布：

```sh
npm run npm:plan
npm run npm:templates
npm run npm:legal
npm run npm:gate
```

legal/gate 预期拒绝：缺来源授权和新版本资格。环境变量、私有仓库或旧用户批准
不能自动提供原始源码再分发授权。原始 TypeScript、maps、用户 Workspace、sessions、
OAuth/credentials/materialized plugins 不进入制品；source-derived SBOM 必须如实保留来源。

## Workflow 和历史

CI 运行 canonical source consistency、lint、静态/provider-free tests 和 MCP auth
source transforms，不自动取得外部 recovered dependencies/assets 或声称已 full-build。

`.github/workflows/qualify-npm-runtime.yml` 和 publish-npm.yml 保留名字但明确 fail closed。
没有 token、id-token、旧 artifact 下载或 npm publish 步骤。恢复发布需要用户独立请求、
来源授权、新四目标和真实业务/制品/registry 回下载资格，以及单独审查的实际 pipeline。

历史 0.1.4 MIT 实现曾在 main 0ebafe95db22101cf77db2c27e73b561d3af37a6 完成
qualification 33306855166 和 publish 33306940462，四个平台包先于 selector，同 SHA
registry fresh install 已验证；其字节/授权不覆盖当前原始模块候选。0.1.5 immutable
acceptance 也不重新绑定。详见 historical cleanroom-runtime-verification.md 和
[当前 0.1.8 notes](../build/runtime-0.1.8-release-notes.md)。

本轮只做本地源码统一/文档/版本/验证与本地分支集成，不 push、publish、deploy 或改变 ZIP/API/DB。
