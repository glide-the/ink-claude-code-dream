<!-- [Input] Canonical original Runtime modules, selector source and current source-derived package gates. -->
<!-- [Output] Define the four-native/selector plan without inheriting old MIT implementation authorization. -->
<!-- [Pos] Current package topology and closed qualification/publication contract. -->
<!-- [Sync] 2026-09-13: use current source and release contracts with precise programming terminology. -->

# Runtime npm 多平台发布设计

## 背景与问题

只有一套实现：原始 `src`，目录、模块、初始字节与权限由 source provenance 校验。
默认编译 `src/entrypoints/cli.tsx`，现有 headless/MCP 变换由构建层应用。
外部 recovered root 只提供 dependencies/vendor assets，不提供第二套 src。

## 目标与边界

复用四个平台包与 selector，版本变化同步 source manifest、包版本和 Dream pin。
当前发行 `0.1.9` 已完成四宿主资格、公开五包核对及本机采用，结果和未验收项见
[0.1.9 回执](../build/runtime-0.1.9-release-notes.md)。这些结果不代替下一版本的资格检查。

`package/` 只拥有 repository-authored selector，保持参考 package-root
package.json + cli.js 形状。两个 alias 指向同一个 cli.js，selector MIT 不重新许可
其选择的原始源码派生 Runtime。根 package 私有 UNLICENSED、无 bin，根 pack/publish 拒绝。

## 概念与规则

### 五包计划与资格

| 包/target | 身份 | 新资格要求 |
| --- | --- | --- |
| selector | @glide-the/ink-claude-code-dream@0.1.9 | 原始 package-root cli.js，四个同版本 optional dependencies，manifest/selector digest |
| darwin-arm64 | @glide-the/ink-claude-code-dream-darwin-arm64@0.1.9 | 原始模块 Mach-O arm64，同宿主真实协议/sandbox/业务和制品验证 |
| darwin-x64 | @glide-the/ink-claude-code-dream-darwin-x64@0.1.9 | 同版本原始实现、同宿主 native execution 与新摘要资格 |
| linux-arm64 | @glide-the/ink-claude-code-dream-linux-arm64@0.1.9 | 同宿主 ELF/sandbox/工具与 checksum-pinned ripgrep/seccomp assets |
| linux-x64 | @glide-the/ink-claude-code-dream-linux-x64@0.1.9 | 同宿主 ELF/sandbox/工具与 checksum-pinned ripgrep/seccomp assets |

Native magic、交叉编译或 fixture pass 不等于目标宿主业务资格。Windows、musl 等
缺少完整证据的目标仍 fail closed。Bun 1.4.0 工具链/依赖/LICENSE/SBOM/checksum、
原始 source provenance、所有输出、manifest 和同 SHA 资格必须互相绑定。

使用现有命令检查 npm 计划、模板、来源许可与制品资格：

```sh
npm run npm:plan
npm run npm:templates
npm run npm:legal
npm run npm:gate
```

legal/gate 必须核对当前源 SHA、授权、许可证与制品资格，缺项即拒绝。
环境变量、私有仓库或不同版本的批准不能替代本次来源授权。原始 TypeScript、maps、
用户 Workspace、sessions、OAuth/credentials 和生成的插件目录不进入制品；SBOM 必须如实保留来源。

## 发布流程、失败处理与验收

普通 CI 验证源码、lint 与协议 fixture；资格 workflow 执行四宿主实际构建，
发布 workflow 只上传同一源 SHA 的已验证制品，平台先于 selector。不得禁用检查
或复用不同字节的旧回执。具体触发与参数以现有 workflow 为准。

上传后 E404 按现有总等待预算查询同一版本；超时报告未可见，不重建或覆盖。
integrity 不同、认证失败或其他查询错误立即停止。精确安装后核对 manifest、
capability、checksum 与 resolver 身份，经授权重启相关服务后再验证实际加载版本。

不新增 packager、队列、UI 或部署框架；完整状态转换、影响范围和回滚沿用
[发布与 Dream 采用设计](single-source-release-and-dream-adoption.md)。不改变 SDK/API/DB 或 ZIP 策略。
