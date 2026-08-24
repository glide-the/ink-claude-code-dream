<!-- [Input] 公开 MIT Claude Agent SDK 协议、Dream 当前调用链、MCP 公共协议与仓库自有测试。 -->
<!-- [Output] 定义不读取恢复源码的 MIT Runtime 架构、能力门、构建边界与验收顺序。 -->
<!-- [Pos] 公共 npm Runtime 的当前目标设计；旧恢复源码裁剪产物仅保留为本地历史证据。 -->
<!-- [Sync] 2026-08-24：记录最终 Dream 真实业务通过、透明跨目标资格与正式发布门。 -->

# Dream Clean-room Runtime 架构

## 1. 决策

公共 npm 包不再使用 `restored-src`、`dist/core-local` 或
`dist/core-package-local` 中的任何实现字节。新 Runtime 只允许从以下输入构建：

- 本仓库 `src/cleanroom/` 内独立编写的实现；
- 具有兼容再分发许可证并被 lockfile、checksum 和 SBOM 固定的第三方依赖；
- 构建时生成且可由上述输入完全重现的 launcher、manifest 和平台包。

仓库自有代码使用 MIT。旧恢复源码裁剪构建器和本地收据可以继续作为历史研究与
black-box 差分工具，但不得进入 clean-room 编译图、npm tarball 或发布许可证判断。

## 2. 当前事实

原本地 Runtime 的 `lib/core` 来自仓库外恢复源码：输入为 4,471 个文件、
46,447,794 字节，Bun 构建输出 48 个文件。没有 source map 只证明发布包不带源码映射，
不能把这些衍生输出变为仓库自有实现。因此公共发布路径必须替换核心，而不是只修改
`package.json#license` 或删除 license report。

## 3. 兼容边界

Python SDK 保持 `ink-claude-dream-agent-sdk==0.2.143`，公开 import 仍为
`claude_agent_sdk`，继续使用 `ClaudeAgentOptions.cli_path` 注入 Runtime。Dream 不增加
第二套业务入口、Agent 状态机或数据库合同。

Runtime 必须实现公开进程接口：

1. SDK argv/env 解析和 `-v/--version`；
2. stdin/stdout NDJSON 与并发 `request_id` 关联；
3. `initialize`、user、system、stream_event、assistant、result；
4. Runtime→SDK 的 permission、hook、SDK-MCP control request；
5. SDK→Runtime 的 interrupt、MCP status/toggle/reconnect 和运行时设置控制；
6. Provider streaming、tool loop、错误与退出语义；
7. session/transcript/resume 与进程内连续多轮。

## 4. Dream 发布能力门

以下 13 项必须分别有代码证据和进程级测试，不能用一次 UI 会话替代：

| 能力 | 最小证明 |
| --- | --- |
| `extensions.plugins` | 本地 plugin-dir 与 Skill 真实调用 |
| `lifecycle.cancel` | interrupt 在 Provider 延迟前终止并产生终态 |
| `mcp.http` | initialize-first、tools/resources、503 恢复 |
| `mcp.management.identity` | add/get/list/remove、冒号名称、scope 保持 |
| `mcp.oauth` | DCR、PKCE、无浏览器回调、持久凭据、logout |
| `mcp.stdio` | 子进程握手、tools/resources、进程组回收 |
| `protocol.control.bidirectional` | 双向 control、并发关联、cancel |
| `protocol.streaming` | 完整 partial event 顺序与 Unicode 合并 |
| `sandbox` | Bash 无法读取拒绝的 credential 文件 |
| `session.resume` | 新进程恢复同一 session 与上下文 |
| `tmpdir.thread-local` | 精确 workspace `.claude-tmp`、真实目录、0700 |
| `transcript.jsonl` | 每 session 单一、非空、可恢复 JSONL |
| `workspace.cwd` | 文件工具与 Bash 只能在声明 workspace 合同内执行 |

OAuth credential 有两个持久边界：Runtime 私有 `mcp-oauth/` 状态和 Dream 可投影的
`.credentials.json#mcpOAuth`。启动时只有私有状态缺少 token 才允许投影 hydration，避免旧投影
覆盖已轮换的 refresh token；SDK refresh 成功后必须等待私有提交并原子回写投影。服务器明确返回
不可恢复的 `invalid_grant` 时，两处 token 都删除并进入 `needs-auth`，不得继续复活旧 token，
也不得把 token 或失败正文输出到 JSONL/日志。

任何一项缺失时，`runtime/cleanroom-artifact-policy.json` 的发布门保持关闭。

## 5. 模块布局

```text
src/cleanroom/
  cli.ts            # 顶层版本、management 分流、SDK stdin 生命周期
  argv.ts           # SDK stream-json/session/plugin 参数
  protocol.ts       # NDJSON、Provider/tool loop、控制面、SDK envelope
  headers.ts        # ANTHROPIC_CUSTOM_HEADERS 边界
  session/          # transcript、fresh/resume/fork、tmpdir
  settings/         # --settings、apiKeyHelper、内存态 Provider auth
  tools/            # Bash、文件、搜索、Skill、Agent
  sandbox/          # 生产 OS sandbox 与 provider-free process fixture
  mcp/              # stdio/http、registry、OAuth、management
  extensions/       # plugins、skills、hooks
```

MCP 固定公开 MIT `@modelcontextprotocol/sdk` v1 客户端线。生产 Bash sandbox 固定公开
Apache-2.0 `@anthropic-ai/sandbox-runtime@0.0.73`，通过其 `SandboxManager` 接入 macOS
`sandbox-exec` 与 Linux `bubblewrap`。Runtime 只向 sandbox 传入规范化后的精确 workspace
和 `{workspace}/.claude-tmp`，网络默认拒绝，子进程环境使用白名单，超时或取消时终止整个
进程组，输出大小有上限。平台不支持、依赖缺失或 sandbox 初始化失败时必须关闭执行，
不得回退到宿主机裸执行。Linux 产物仍要求目标主机具备通过检查的 `bubblewrap` 和 `rg`；
这些系统前置条件不作为 npm 包内嵌资产。

## 6. 数据与安全

分发包不得包含 transcript、Workspace 正文、plugin materialization、MCP 配置、OAuth
token、认证文件或完整环境变量。运行时数据只能位于服务端绑定的 thread workspace 和
actor credential root；拒绝 symlink、非规范路径和宽权限文件。

stdout 只允许 SDK JSONL；日志写 stderr。Provider、MCP 和 OAuth 错误对外只输出安全 DTO，
不得回显 token、header、响应正文或用户路径。

## 7. 构建与发布

目标仍为一个 selector 和四个平台包：darwin arm64/x64、Linux glibc arm64/x64。Bun、
ripgrep、第三方依赖和 native asset 均按目标固定。所有层级拒绝 `.map`。

资格顺序：

1. clean-room source inventory 与禁止输入扫描；
2. SDK provider-free 真实进程合同；
3. MCP stdio/HTTP/Resources/management/OAuth 合同；
4. Workspace/sandbox/transcript/resume 合同；
5. 四平台 native format qualification；darwin-arm64 加真实宿主执行，其他目标保留明确的 cross-build 资格基础；
6. 五 tarball 精确绑定、CycloneDX SBOM、license、checksum、可复现构建；
7. Dream 依赖切换、协议差分和真实业务验收；
8. npm 首次发布后从 registry 重新下载验收。

## 8. 回滚

Dream 继续保留绝对 `CLAUDE_CODE_CLI_PATH` 指向官方 CLI 的回滚能力。clean-room Runtime
与旧本地衍生制品使用不同 build receipt 和 provenance，禁止互相冒充或混合打包。

## 9. 当前状态

仓库 MIT 许可与 clean-room policy 已建立。当前 clean-room 实现已覆盖 SDK JSONL 初始化
与双向控制、Provider streaming、稳定 session/transcript/resume、interrupt、Dream 所需的
tool result envelope、内置工具权限、MCP stdio/HTTP/Resources/management/OAuth，以及生产
sandbox。Bun 构建与 npm provider-free 测试已经验证四个目标产物和五个 tarball 的选择、
安装、checksum、CycloneDX/许可证证据与无 `.map` 合同；macOS arm64 本机测试还验证了真实
`sandbox-exec` 隔离，Linux
运行时会在缺少 `bubblewrap` 或 `rg` 时 fail closed。

最终候选已通过用户日常使用的 Dream、Admin、Gateway 与本机真实 PostgreSQL 公开入口的
既有真实账户两轮业务验收，包括同 Thread refresh/resume、Comfy 浏览器 OAuth、两次工具调用、
SSE 终态、Admin/Gateway 可见和 logout/remove。隐私删减回执及其 digest 已 checked in；
`productionEligible`、`publicationAllowed`、`redistributionAllowed` 与 `npmPublishAllowed` 均为 true。

资格声明保持可审查：darwin-arm64 包含真实宿主业务/native execution；其他三个目标是 Bun
cross-build native format、精确 package inventory、verifier 和复现性资格，不宣称相应宿主 live
execution。正式五包 prepack 已开放，发布必须平台包优先、selector 最后。registry 全新安装与
Dream resolver 验收仍是发布后证据，不能由本地 tarball 检查代替。

当前精确版本、13 项能力、内存和命令回执见
[`cleanroom-runtime-verification.md`](./cleanroom-runtime-verification.md)。
