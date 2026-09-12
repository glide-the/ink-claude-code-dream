<!-- [Input] MCP Apps 2026-01-26 specification, ext-apps revision 10195ad, and the clean-room Runtime/Marketplace evidence. -->
<!-- [Output] Product interaction, status semantics, security boundary, compatibility matrix, and phased acceptance plan for MCP Apps. -->
<!-- [Pos] Authoritative design for the ext-apps Marketplace entry and any future MCP Apps Host capability. -->
<!-- [Sync] 2026-09-02: record the skills-only Marketplace integration and ordinary-MCP/Apps-Host compatibility boundary. -->

# MCP Apps Marketplace 接入与 Host 交互方案

## 1. 背景与问题

`ink-claude-code-dream` 是无交互界面的 Claude Runtime。它已经能连接 MCP server、发现和调用 tool、列出和读取 resource，但“能读取一段 `text/html`”不等于“实现 MCP Apps 客户端协议”。MCP Apps 还要求客户端显式协商 UI 扩展、识别 tool 与 `ui://` resource 的关联、在隔离环境渲染应用，并建立 Host 与应用之间的双向 JSON-RPC 桥。

本次接入的上游 `modelcontextprotocol/ext-apps` 也必须准确分类：仓库中的 Claude Plugin Marketplace 条目 `plugins/mcp-apps` 是 4 个面向开发者的 Skills，不包含 `.mcp.json`、可启动 MCP server 或 MCP Apps Host。安装成功只证明这些 Skills 可被 Claude Code/本 Runtime 的 `--plugin-dir` 机制加载，不能证明 MCP Apps 可运行。

截至 2026-09-02，当前总体结论为：**仅支持普通 MCP，不支持 MCP Apps Host**。现有 Runtime 能保留内部 discovery/result/resource 对象中的扩展字段，并能读取 MCP App HTML 资源；但它未声明 `io.modelcontextprotocol/ui` 能力，也没有 iframe、AppBridge、权限、CSP 或 Host/UI 消息生命周期。因此保持不协商 UI 扩展是当前正确的 fail-closed 行为。

## 2. 目标与边界

### 目标

- 在仓库 Marketplace 中以官方、可验证且版本固定的方式收录 `ext-apps` 的 `mcp-apps` Skills 插件。
- 建立可重复执行的普通 MCP/MCP Apps 能力边界测试，防止把 metadata 保留或资源读取误报为完整支持。
- 给出面向 Marketplace、插件详情和未来应用容器的状态、交互、安全及恢复方案。
- 为后续 Host 实现定义最小分期、前后端合同和可验收的完成条件。

### 边界

- 本次不把上游示例伪装成 Marketplace 插件，不新增不存在的 `.mcp.json`、启动命令或 manifest。
- 本次不在这个 headless Runtime 内嵌浏览器，不实现 Dream 前端页面，不改变数据库 schema、部署或远程环境。
- 本次不把开发 Skills、普通 MCP server、MCP Apps server 和 MCP Apps Host 混为一种能力。
- 本次不主动声明 UI extension；只有安全 Host 的完整合同上线并通过验收后才允许声明。
- 上游 `examples/quickstart` 仅用作协议兼容性 fixture；它不是 Marketplace 中被安装的插件内容。

## 3. 概念与规则

### 3.1 概念

| 概念 | 本设计中的含义 |
| --- | --- |
| 普通插件 | Claude Code 可安装内容；可包含 Skills、commands、hooks、agents 或 MCP 配置，具体能力以 manifest 为准。 |
| MCP server | 通过 stdio、HTTP 或 SSE 与客户端交换 MCP initialize、tools、resources、prompts 等消息的进程或服务。 |
| MCP App | MCP tool 通过 `_meta.ui.resourceUri` 关联 `ui://` resource，由支持 Apps extension 的 Host 安全渲染并交互。 |
| MCP Apps Host | 负责扩展协商、resource 校验、sandbox、CSP、权限、AppBridge、tool result 和生命周期的客户端 UI 宿主。 |
| `mcp-apps` Skills | `ext-apps/plugins/mcp-apps` 的 4 个开发指导 Skills；不等于 server 或 Host。 |

官方规范使用 “Host” 表示承载应用 UI 的 MCP client。本项目映射为 Dream 的服务端组合层加前端安全容器；当前 clean-room Runtime 只承担 headless MCP client 与 Claude turn，不承担浏览器 Host。

### 3.2 配置与运行状态规则

每项可配置能力都必须区分以下字段，禁止用一个 `enabled` 覆盖所有语义：

| 字段 | 定义 | 示例 |
| --- | --- | --- |
| `default` | 产品/manifest 提供的初始值，不代表用户选择或当前运行事实。 | 插件默认禁用；请求的显示模式为 inline。 |
| `desired` | 用户或管理员当前期望配置。 | 已启用；允许剪贴板写入。 |
| `effective` | 运行中的 Host 实际采用并验证过的不可变快照。 | server 已连接；UI extension 已协商；剪贴板未授权。 |
| `revision` | 配置快照的单调版本，用于判断 `desired` 与 `effective` 是否属于同一版。 | `desired.revision=8`、`effective.revision=7` 表示仍在应用中。 |

只有 fresh snapshot 同时满足以下条件，界面才能显示“可用”或“已应用”：

1. `effective.revision === desired.revision`；
2. 所有安全相关值与期望配置一致；
3. server 已连接，且 initialize 响应与客户端 UI extension 协商一致；
4. 关联 resource 通过 URI、MIME、HTML、CSP 和权限校验；
5. Host/UI 初始化和最小双向消息探测成功。

仅安装、进程启动或普通 `tools/list` 成功，分别只能显示“已安装”“启动中”或“普通 MCP 可用”。旧 revision 的成功回执不得覆盖新 desired；同 revision 异值、revision 回滚或无来源快照一律标记 invalid，并保留 last-known-good effective 供已打开应用完成安全退出。

## 4. 协议判定基线

依据 MCP Apps 规范版本 `2026-01-26`，完整客户端至少需要：

1. 通过既有配置连接 MCP server，完成 initialize 和协议版本/能力协商。
2. 在 client capabilities 中使用官方精确字段声明支持的 MIME type：

   ```json
   {
     "extensions": {
       "io.modelcontextprotocol/ui": {
         "mimeTypes": ["text/html;profile=mcp-app"]
       }
     }
   }
   ```

3. 调用 `tools/list`，保留并解释规范化的 `_meta.ui.resourceUri`、visibility 等字段；兼容期可读取已弃用的 flat key，但不得作为新写入格式。
4. 通过 `resources/read` 读取关联的 `ui://` resource，并校验 URI、精确 MIME、匹配内容以 `text` 或 base64 `blob` 提供、内容是有效 HTML5，以及 resource `_meta.ui`。
5. 在独立 origin 的双 iframe 或等价隔离容器中加载 HTML；默认拒绝网络和权限，只按声明及用户决定放行。
6. 完成 `ui/initialize` → `ui/notifications/initialized`，再传递 tool input、tool result、错误、取消和 Host context。
7. 支持应用侧受控 `tools/call`、resource 读取、消息、模型上下文更新、外链/显示模式请求；所有请求重新走 Host 授权。
8. 对关闭、重载、server 断连、revision 切换和页面崩溃提供 teardown、取消、重连与明确降级。

## 5. 当前源码与数据流

### 5.1 当前链路

```mermaid
flowchart LR
  A["外部 Claude Code / Dream 安装流程"] -->|"解析 Marketplace，物化插件目录"| B["mcp-apps Skills"]
  B -->|"--plugin-dir"| C["clean-room Runtime Skill catalog"]
  D["Dream 生成的 MCP config"] --> E["McpRegistry"]
  E -->|"initialize / tools / resources"| F["MCP server"]
  E -->|"普通 tool 定义与 JSON 结果"| G["Claude turn"]
  E -. "当前没有 UI DTO/桥接" .-> H["Dream MCP Apps Host"]
  H -. "尚未实现" .-> I["隔离 iframe / AppBridge"]
```

- 外部安装边界：Runtime argv 只接受 `--plugin-dir` 和 `--mcp-config`；不实现 `plugin marketplace add/install`。外部工具负责安装，本 Runtime 只读取物化后的 Skills。
- MCP client：`src/cleanroom/mcp/registry.ts:630-644` 使用 `@modelcontextprotocol/sdk` Client 建连，但 client capabilities 是空对象。
- discovery：`src/cleanroom/mcp/registry.ts:861-899` 发现 tools/resources/prompts；`src/cleanroom/mcp/types.ts:66-85` 的开放字段让内部对象保留 `_meta`。
- model projection：`src/cleanroom/mcp/registry.ts:732-750` 只投影 tool 名称、描述和 input schema，且没有按 Apps visibility 隐藏 app-only tool。
- 结果与资源：`src/cleanroom/mcp/registry.ts:753-802` 保留原始 result/resource；`src/cleanroom/protocol.ts:990-1017` 仅把它们 JSON 序列化给模型。
- 对外状态：`src/cleanroom/protocol.ts:131-155` 的安全状态 DTO 不输出 Apps `_meta`；没有供前端渲染的专用 UI DTO。
- 插件读取：`src/cleanroom/protocol.ts:762-780` 初始化 filesystem/plugin Skills；没有 Marketplace 管理状态。
- 有意边界：`runtime/core-prune-profile.json:278-284,413-417` 明确关闭 interactive MCP rich output，保留 headless MCP transport、tools、resources 和结构化协议。

### 5.2 Marketplace 内容事实

仓库 `.claude-plugin/marketplace.json` 固定到上游 commit `10195ad91851502134930e9b80ec2c04e277a720` 的 `plugins/mcp-apps` 子目录。该目录的 `.claude-plugin/plugin.json` 版本为 `0.1.0`，内容为：

- `add-app-to-server`
- `convert-web-app`
- `create-mcp-app`
- `migrate-oai-app`

它没有 MCP server manifest 或运行入口。版本升级策略是人工核对新的上游 commit、manifest 和 Skills 差异后更新 SHA 与回归测试；不得跟随浮动分支自动升级。

## 6. 兼容性矩阵

| 要求 | 代码/静态证据 | 运行证据 | 结论 | 缺口 |
| --- | --- | --- | --- | --- |
| Marketplace 收录 | 本仓库 manifest 使用官方 `git-subdir`、固定 URL/path/SHA，并明确 skills-only | 官方 Claude Code `plugin validate .` 通过；隔离配置可 add/list/install | 支持 | 不代表 server/Host |
| 插件安装与加载 | Runtime 支持 `--plugin-dir`，Skill catalog 读取 plugin Skills | 官方 Claude Code 安装后得到 4 个 Skills；与上游逐文件一致；Runtime 加载 4/4 | 支持开发 Skills | Runtime 本身不执行 Marketplace 命令 |
| MCP server 启动/连接 | `McpRegistry` 支持 stdio/HTTP/SSE；上游 Skills 无 server 配置 | 上游 quickstart stdio fixture 连接为 `connected` | 示例 server 可单独连接；插件安装不会启动它 | 产品仍需真实 MCP App server 配置 |
| initialize/Apps 协商 | Client 创建时 capabilities 为 `{}` | fixture 观察到 `{}` | 不支持 Apps 协商 | 安全 Host 完成后才可声明 extension/MIME |
| 普通 tool 发现/调用 | discovery 和 callTool 使用官方 SDK | `get-time` 可发现、调用并返回 text/structured content | 支持普通 MCP | 需 app-only visibility 与 UI 调用授权 |
| Apps metadata 保留 | 内部类型和 SDK discovery 保留未知字段；model/status projection 会裁剪 | 测试确认 registry 内有 `_meta.ui`，model tool 无 metadata | 内部部分保留，对 Host 不可达 | 需要专用、校验后的 UI DTO |
| `ui://` resource 读取 | list/read resource 通路存在 | MIME `text/html;profile=mcp-app` 与 HTML 可读 | 可读取，不等于可展示 | 需 schema/MIME/CSP 校验和 blob 处理 |
| 安全 UI 渲染 | 无 iframe/WebView/AppBridge/sandbox 代码；headless profile 明确关闭 rich rendering | 无目标系统页面可打开 | 不支持 | 需独立 origin、sandbox proxy、双 iframe、CSP |
| Host/UI 双向交互 | 无 `ui/initialize`、postMessage JSON-RPC 或 Host callbacks | 无可执行目标链路 | 不支持 | 需 AppBridge 生命周期及授权路由 |
| result/error 传递 | 普通 MCP result/isError 保留后转 JSON | content、structured content、result `_meta` 与 `isError` 被 registry fixture 保留 | 普通 MCP result/error 已验证，Apps 事件不支持 | 需 tool input/result/error 精确投递 |
| Apps cancel/teardown | 普通 turn 有独立取消语义，但没有 App bridge 生命周期 | 未执行 Apps cancel/teardown；目标链路不存在 | 不支持且未做运行验证 | 需 request 关联、取消投递、`ui/resource-teardown` 与挂起调用清理 |
| 生命周期/恢复 | server reconnect/close 存在 | 普通 fixture 可关闭 | 普通连接支持 | 缺应用加载、崩溃、revision、页面关闭状态机 |

## 7. 处理判断与分阶段方案

### 推荐方案：先诚实接入 Skills，再建设独立 Host

1. **阶段 0（本次）**：发布 skills-only Marketplace 条目、固定上游 commit、增加边界测试与文档。Marketplace 卡片只标记“开发 Skills”，不得显示“MCP Apps 可用”。
2. **阶段 1（Runtime 合同）**：增加经过校验的 Apps metadata/resource/result/control DTO；按 visibility 隔离 model/app tool；加入 desired/effective/revision diagnostics。Host 未就绪时继续不声明 extension。
3. **阶段 2（Dream 组合层）**：以 server/session/tool-call 身份绑定 UI 调用，复用现有 MCP registry 或受控代理；权限、资源读取和 tool call 均走同一公开生产授权入口，不新增数据库 schema。
4. **阶段 3（Dream 前端 Host）**：使用官方 `@modelcontextprotocol/ext-apps/app-bridge` 或兼容实现；采用不同 origin 的 sandbox proxy 与双 iframe；从声明生成 CSP/permissions，默认拒绝。
5. **阶段 4（真实验收）**：用固定版官方 quickstart 和一个产品实际 server 完成 initialize、resource、双向调用、取消、断连恢复、权限拒绝及会话回归，并保存脱敏协议日志和截图。

影响范围包括 Runtime MCP DTO/visibility、Dream 后端会话桥、Dream 前端安全容器、诊断状态和对应测试。无需修改 `ext-apps` 上游；只有发现 AppBridge/规范缺陷时才提交上游 issue 或补丁。

### 备选方案：保持文本降级，使用外部支持 Host

若当前产品不需要内嵌交互 UI，保持本 Runtime 为普通 MCP client，将 MCP Apps 交互交给明确支持 Apps 的 Claude 产品或其他 Host。本产品只展示 tool 的文本/structured fallback，并标记“交互界面需在兼容 Host 打开”。优点是安全面和实现成本最低；限制是 Dream 内不能操作 App UI。

### 需要的产品决策

- Dream 是否必须承载 inline、fullscreen 或 picture-in-picture 显示模式；默认只建议 inline。
- 哪些权限可申请、是否允许会话级记忆、外链是否需要 Host 中转；默认均拒绝并按请求授权。
- app-only tool 是否允许无确认调用；建议仍复用普通 MCP tool 权限策略，不给应用额外信任。
- unsupported Apps 是完全隐藏入口，还是保留文本 fallback；建议保留可工作的普通 MCP 并明确标记“无交互界面”。

## 8. 用户角色与典型场景

| 角色 | 目标 | 典型场景 |
| --- | --- | --- |
| 插件开发者 | 获得官方开发方法 | 安装 `mcp-apps` Skills，创建或迁移 MCP App；在兼容 Host 中调试。 |
| 工作区管理员 | 控制来源与权限 | 审核 Marketplace 来源、版本、server 配置、Apps 权限和 effective 状态。 |
| 最终用户 | 完成业务操作 | 在对话中调用 tool；支持时打开交互 UI，不支持时使用文本 fallback。 |
| 支持/安全人员 | 判断故障层级 | 区分安装、server、协商、resource、sandbox、bridge 和 tool call 故障。 |

## 9. Marketplace 卡片与详情页

### 9.1 卡片信息结构

卡片从上到下展示：

1. 名称 `MCP Apps Development Skills`、官方来源 `modelcontextprotocol/ext-apps`、经审查的 commit 短号。
2. 能力标签：`Claude Plugin`、`Skills ×4`；不要显示 `MCP server` 或 `MCP Apps Host`。
3. 一句话说明：“用于创建和迁移 MCP Apps；不会安装 server，也不会让当前客户端获得交互 UI。”
4. 安装状态与可用范围，例如“已安装 · 开发 Skills 可用”。
5. 主要操作：未安装为“安装”，已安装为“查看 Skills”；禁用/启用是可逆操作，不弹确认。

能力标签必须来自 manifest 静态声明与运行探测的交集：静态声明决定“可能支持”，effective 探测决定“当前可用”。缺失声明不可从名称猜测。

### 9.2 详情页

详情页包含来源、固定 revision、上次审核日期、安装内容清单、运行要求（Node.js 只适用于上游 SDK/示例，不应用于 4 个纯 Markdown Skills）、能力与缺口、权限、诊断以及卸载入口。将“开发 Skills 状态”和“当前客户端 MCP Apps Host 状态”分成两个信息组，避免视觉上合并。

## 10. 状态模型与状态来源

| 用户态 | 判定 | 主要来源 | 可用操作 |
| --- | --- | --- | --- |
| 安装前 | catalog 有条目，本地无 installation receipt | Marketplace + 安装器 | 安装、查看来源 |
| 安装中 | 安装 job active | 安装器 job | 取消 |
| 已安装 | manifest 与文件摘要通过，本地存在 | installation receipt | 启用、卸载、查看 Skills |
| 启动中 | server desired=enabled，连接/协商尚未完成 | MCP registry | 取消、诊断 |
| 普通 MCP 可用 | server connected，普通 tool/resource 探测通过 | Runtime snapshot | 使用文本能力 |
| MCP Apps 可用 | desired/effective/revision 匹配且 Host 五项门禁通过 | Host capability snapshot | 打开应用 |
| 部分可用 | 普通 MCP 可用但 Apps 门禁缺失；或部分 tool 无 UI | capability matrix | 使用 fallback、查看缺口 |
| 不兼容 | manifest/协议/MIME/安全要求确定不满足 | validator | 查看要求、切换兼容 Host |
| 运行失败 | 曾可尝试但启动、网络、授权、resource 或 bridge 失败 | 分层 error receipt | 重试、重新授权、诊断 |
| 已禁用 | desired=disabled，effective 已停止 | revisioned snapshot | 启用、卸载 |

前三种安装状态属于 installation 轴，server 启动/普通 MCP/授权/运行失败属于 server 轴，Apps checking/ready/partial/incompatible/failed 属于 Apps 轴；同一页面可以同时展示“Skills 已安装”“普通 MCP 可用”“Apps 不兼容”。Apps 轴优先级为：确定违反协议或安全要求时 `incompatible`；门禁检查仍在进行时 `checking`；门禁部分通过且仍有可恢复缺口时 `partial`；运行中断为 `failed`；全部门禁通过才是 `apps_ready`。

状态必须包含 `reasonCode`、`observedAt` 和来源，但卡片只显示帮助决策的摘要；技术详情放在“诊断”。“连接成功”只对应 transport/server，不得替代 Apps 状态。

## 11. 安装、启用与首次打开

### 11.1 安装与启用

1. 用户在卡片选择“安装”。安装器校验 catalog schema、固定来源、plugin manifest 和目标目录，不弹可逆操作确认。
2. 安装成功后展示“开发 Skills 已安装”，列出 4 个 Skills；不启动任何 server。
3. 若另一个插件或用户配置提供 MCP server，启用流程创建新的 desired revision；Runtime 连接并回传 effective 普通 MCP 状态。
4. 若 server 提供 MCP App，但 Host 不支持，详情显示“普通 MCP 可用 · 交互 UI 不受支持”，仍允许文本 fallback。

### 11.2 首次打开与运行中交互

```mermaid
sequenceDiagram
  actor U as 用户
  participant M as Marketplace/安装器
  participant R as Runtime MCP client
  participant S as MCP server
  participant H as Dream Apps Host
  participant A as Sandbox App

  U->>M: 安装 mcp-apps 开发 Skills
  M-->>U: Skills 已安装（不会创建或启动 server）
  U->>R: 另行启用已配置的 MCP server
  R->>S: 启动 stdio server 或连接远端 server
  R->>S: initialize（仅 Host 已就绪时声明 UI extension）
  S-->>R: server capabilities
  R->>S: tools/list
  S-->>R: tool + _meta.ui.resourceUri
  U->>R: 调用关联 tool
  R->>S: tools/call
  S-->>R: tool result / structured content
  R->>S: resources/read ui://…
  S-->>R: text/html;profile=mcp-app + UI metadata
  R->>H: 已校验的 resource/result/context snapshot
  H->>A: 在隔离容器加载并 ui/initialize
  A-->>H: ui/notifications/initialized
  H-->>A: tool input/result
  A->>H: tools/call / resources/read / update context
  H->>R: 重新鉴权后的请求
  R->>S: MCP request
  alt server、resource 或 bridge 失败
    R-->>H: 分层错误或取消
    H-->>U: 文本 fallback、重试或诊断
    U->>R: 重连
    R->>S: 重新启动/连接并协商
    R->>H: 新 effective revision
    H->>A: 重载并重新初始化
  else revision 变化或关闭
    H->>A: teardown / cancel pending calls
  end
```

首次打开只在应用实际请求敏感权限时提示。Host 在加载前展示应用名称、server 来源和即将授予的权限；没有权限请求时直接打开。运行中将应用与产生它的 tool call、server 和 revision 绑定，禁止跨 server 借用身份。

## 12. UI resource 承载与安全边界

- 资源必须是关联 tool 指定的 `ui://` URI，通过同一 MCP server 的 `resources/read` 获取；禁止从任意外部 URL直接当作 App HTML。
- 仅接受规范声明的 MCP App MIME；HTML text/blob 先做结构和大小政策校验。大小、超时和域名均来自 policy/config，不写死在产品逻辑或文案中。
- Host 页面不直接执行 server HTML。建议 outer Host iframe + 不同 origin sandbox proxy + inner app iframe；sandbox token、Permissions Policy 和 CSP 取声明与产品 policy 的最小交集。
- 默认禁止网络、导航、弹窗、下载、摄像头、麦克风、地理位置、剪贴板等能力。权限按应用、server、来源 revision 和会话记录，变更 revision 后重新评估。
- `postMessage` 必须校验 origin、窗口身份、JSON-RPC schema、request id 和允许的方法；应用侧请求不得绕过现有 MCP permission/admission 顺序。
- 外链由 Host 打开并显示目标来源；应用不能直接顶层导航。敏感 tool result 和凭证不得写入 telemetry、URL 或通用错误文案。
- 不安全路径应 fail closed：不声明 Apps capability、不渲染 HTML、保留普通文本 fallback，不影响既有 MCP 会话。

## 13. 权限、错误、恢复与卸载

### 13.1 权限请求

提示包含“请求方、所需能力、作用范围、持续时间”，操作为“允许一次”“本次会话允许”“拒绝”。只有不可逆或明显高风险的 tool 继续使用现有确认流程；普通打开、关闭、禁用和重试不增加确认弹窗。

### 13.2 错误分层

| 层级 | 用户文案原则 | 恢复动作 |
| --- | --- | --- |
| 安装 | “插件文件未完成校验” | 重试安装、查看来源 |
| server | “MCP server 未启动/需要授权” | 重连、授权、查看日志 |
| 协商 | “当前客户端未启用交互界面协议” | 使用文本结果、兼容 Host |
| resource | “应用界面资源无效或不可读取” | 重读资源、报告 server |
| 安全 | “应用请求的来源或权限未获允许” | 调整管理员 policy 或拒绝 |
| bridge | “交互界面未完成初始化” | 重新加载应用；取消挂起请求 |
| tool | 展示 server 返回的安全摘要 | 重试、修改输入、查看诊断 |

自动重试只用于确定幂等的连接/resource 读取，并遵循配置策略；tool call 不做隐式重放。恢复时生成新 runtime attempt，但 desired revision 不因瞬时失败变化。已打开应用在 server 断连后进入只读/失效态，禁止继续发起 tool call；重连并重新协商后创建新的 effective snapshot。

### 13.3 禁用与卸载

禁用是可逆操作：停止新调用、取消未完成请求、teardown iframe、关闭连接，再回写 effective disabled，无确认弹窗。卸载会删除安装内容，若没有用户数据或不可逆影响可直接执行并提供短时“撤销”；有未保存应用状态时先说明会丢失的具体内容，而不是使用通用确认。

## 14. 空、加载、异常状态与无障碍

- 空状态：“尚未安装开发 Skills”或“当前 server 没有关联的交互界面”，两者不可合并。
- 加载状态分“安装内容”“启动 server”“验证交互界面”“加载应用”，并给出可取消操作；不循环显示模糊“连接中”。
- 异常状态保留文本/structured result，提供“重试界面”“查看诊断”“在兼容 Host 打开”等可行动入口。
- 状态和能力标签不能只靠颜色；使用图标、文本和 `aria-live`。焦点先进入应用标题/状态区，再进入 iframe；关闭后返回触发按钮。
- `Tab` 不应困在 iframe；提供 Host 级“离开应用”和“关闭应用”快捷方式，`Esc` 仅退出 fullscreen/overlay，不取消业务 tool。
- 权限对话框可全键盘操作，默认焦点放在最小授权或拒绝选项；屏幕阅读器读出请求方和范围。

## 15. 关键文案

| 场景 | 推荐文案 |
| --- | --- |
| Marketplace 卡片 | “官方 MCP Apps 开发 Skills；不包含 server 或交互界面 Host。” |
| Skills 安装完成 | “4 个开发 Skills 已安装。当前客户端的 MCP Apps 支持状态未改变。” |
| 普通 MCP 可用 | “工具可用；此客户端暂不能显示该工具的交互界面。” |
| 协商完成 | “交互界面协议已验证，可以打开。” |
| revision 未应用 | “正在应用最新配置；当前运行版本为上一版。” |
| 安全拒绝 | “该界面请求的来源或权限不在允许范围内，已改用文本结果。” |
| bridge 失败 | “交互界面未完成初始化。工具结果仍可在对话中查看。” |

避免使用孤立的“连接成功”“插件可用”“已应用”等无法说明能力层级的文案。

## 16. 前后端状态模型

Skills 安装、MCP server 和 MCP Apps Host 是三条可并存的状态轴。Marketplace 页面可以合并展示三个快照，但不得把它们压成一个枚举，也不得要求 skills-only 插件具有 `serverId`。建议的只读状态快照如下；字段名表示语义，不规定具体传输框架：

```ts
interface PluginInstallationSnapshot {
  pluginId: string;
  default: PluginDesiredConfig;
  desired: PluginDesiredConfig & { revision: number };
  effective?: PluginEffectiveConfig & { revision: number; observedAt: string };
  installationState: "not_installed" | "installing" | "installed" | "failed";
  activationState: "enabled" | "disabled";
  observedAt: string;
  evidenceSource: "installer";
  reasonCode?: string;
}

interface McpServerSnapshot {
  serverId: string;
  default: McpServerDesiredConfig;
  desired: McpServerDesiredConfig & { revision: number };
  effective?: McpServerEffectiveConfig & { revision: number; observedAt: string };
  serverState: "disabled" | "starting" | "mcp_ready" | "needs_auth" | "failed";
  observedAt: string;
  evidenceSource: "runtime";
  reasonCode?: string;
}

interface McpAppHostSnapshot {
  serverId: string;
  appResourceUri: string;
  default: McpAppDesiredConfig;
  desired: McpAppDesiredConfig & { revision: number };
  effective?: McpAppEffectiveConfig & { revision: number; observedAt: string };
  appsState: "checking" | "apps_ready" | "partial" | "incompatible" | "failed" | "disabled";
  observedAt: string;
  evidenceSource: "apps_host";
  gates: {
    extensionNegotiation: Gate;
    toolMetadata: Gate;
    resource: Gate;
    secureHost: Gate;
    bridge: Gate;
  };
  reasonCode?: string;
}
```

安装快照由安装器签发；server 与 Host 快照由运行服务端签发，各自拥有 revision，页面只做关联展示。后端只发送经过 schema 校验和最小化的 metadata/resource/result，不发送任意 registry 对象。前端不从“有 `_meta`”自行推断支持；只根据后端签发的 revisioned gates 展示 Apps 入口。effective snapshot 必须 server-owned、immutable，不能在 turn 主路径临时查询或变更 policy。

## 17. 诊断与埋点

诊断事件建议覆盖：catalog 校验、安装摘要、server connect、协议版本、extension negotiation、tool/resource id、MIME validation、sandbox load、bridge initialize、应用侧方法、权限决定、取消、teardown 和 reasonCode。事件关联 installation id、server id、session id、tool call id 与 revision，但不得记录正文、HTML、tool result、凭证或完整外部 URL。

产品指标只用于定位漏斗和可靠性：安装成功率、普通 MCP ready、Apps gates 通过率、首开时延、权限拒绝率、bridge 失败率、文本 fallback 使用率。禁止把未协商的 server connect 计入 Apps 成功率。

## 18. 验收标准

### 本次接入

- Marketplace schema 被官方 Claude Code validator 接受。
- 隔离配置下能 add/list/install `mcp-apps@ink-claude-code-dream`，安装物与固定 commit 的上游 `plugins/mcp-apps` 相同。
- Runtime 能从安装目录加载 4 个 Skills。
- provider-free 回归确认普通 MCP tool/result/resource 可用、Apps metadata 在 registry 内保留、model projection 不宣称 UI、initialize 未声明 UI extension。
- 卡片和文档明确“Skills 可用、Host 不支持”，不会用安装结果推导 Apps 可用。

### 未来完整 Host

- 客户端只在 Host 安全门禁已就绪时声明 `io.modelcontextprotocol/ui` 与实际支持 MIME。
- 对固定 quickstart 和产品 server，完成 tool → resource → sandbox → `ui/initialize`/`ui/notifications/initialized` → 双向 tool/resource 调用 → result/cancel → teardown 的真实 E2E。
- app-only tool 不暴露给模型；应用侧调用必须沿用既有权限、server 和 session 边界。
- CSP、origin、Permissions Policy、外链、恶意 postMessage、无效 MIME/HTML、断连和 revision 回滚均 fail closed，并保留文本 fallback。
- Apps 故障不改变已有普通 MCP、Claude session、resume/cancel 或其他插件行为。
- 保存脱敏协议日志和 UI 截图，明确区分自动化与真实运行证据。

## 19. 暂不支持范围

- 当前 Runtime 中的 MCP Apps UI 渲染、AppBridge 和双向消息。
- fullscreen、picture-in-picture、多窗口、持久化应用状态及后台应用。
- 浮动上游版本自动更新、未审查的第三方 HTML 或外部 URL 直接渲染。
- 以 Marketplace 插件安装自动创建/启动 quickstart server。
- 因本次能力新增数据库表、DDL、部署通道或远程环境差异路径。

## 20. 一手资料与检查基线

- [MCP Apps Overview](https://modelcontextprotocol.io/extensions/apps/overview)，检查日期 2026-09-02。
- [MCP Apps Extension specification 2026-01-26（固定 commit）](https://github.com/modelcontextprotocol/ext-apps/blob/10195ad91851502134930e9b80ec2c04e277a720/specification/2026-01-26/apps.mdx)，检查日期 2026-09-02。
- [`modelcontextprotocol/ext-apps`](https://github.com/modelcontextprotocol/ext-apps)，检查 commit `10195ad91851502134930e9b80ec2c04e277a720`，package version `1.7.5`，检查日期 2026-09-02。
- [上游 Marketplace manifest（固定 commit）](https://github.com/modelcontextprotocol/ext-apps/blob/10195ad91851502134930e9b80ec2c04e277a720/.claude-plugin/marketplace.json) 与 [`mcp-apps` plugin manifest（固定 commit）](https://github.com/modelcontextprotocol/ext-apps/blob/10195ad91851502134930e9b80ec2c04e277a720/plugins/mcp-apps/.claude-plugin/plugin.json)，检查日期 2026-09-02。
- [Quickstart server（固定 commit）](https://github.com/modelcontextprotocol/ext-apps/blob/10195ad91851502134930e9b80ec2c04e277a720/examples/quickstart/server.ts) 与 [basic-host AppBridge 实现（固定 commit）](https://github.com/modelcontextprotocol/ext-apps/blob/10195ad91851502134930e9b80ec2c04e277a720/examples/basic-host/src/implementation.ts)，检查日期 2026-09-02。
- [Claude Code plugin marketplaces](https://code.claude.com/docs/en/plugin-marketplaces) 与 [Plugins reference](https://code.claude.com/docs/en/plugins-reference)，检查日期 2026-09-02。
- [Claude MCP Apps getting started](https://claude.com/docs/connectors/building/mcp-apps/getting-started)，检查日期 2026-09-02。

上游 README 明确把根 package 分为 app SDK、React hooks 与 AppBridge，并说明仓库除 `examples/basic-host` 外不提供受支持 Host；quickstart 则是独立 server/app 示例。根 SDK package 与示例要求 Node.js `>=20`；4 个 Markdown Skills 本身不生成 MCP 配置、启动参数或 Node 运行时要求。以上内容与本地固定 commit 的 manifest、package 和示例源码做了交叉核对。
