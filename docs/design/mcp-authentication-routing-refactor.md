<!-- [Input] Runtime/official CLI differential evidence, current clean-room MCP management/OAuth call chains, and official MCP 2026-07-28 transport/authorization contracts. -->
<!-- [Output] Define anonymous-first MCP authentication routing, stable CLI status/error semantics, minimal implementation scope, rollback plan, and verification matrix. -->
<!-- [Pos] Authoritative design and implementation-evidence record for the second planning-round MCP authentication routing refactor. -->
<!-- [Sync] 2026-08-25: implement and validate anonymous-first routing, stable status/failure output, OAuth/cancel/logout compatibility, and official/custom CLI differential evidence. -->

# MCP 认证路由最小重构设计

> Historical / retired implementation. Runtime 0.1.8 now builds canonical original
> src modules, identical to restored-src/src, with no parallel cleanroom implementation.
> Procedures, code paths and release/business receipts below describe the previous code,
> not current qualification. See [current alignment](claude-sourcemap-package-contract-alignment.md).

## 1. 本轮记录

| 项目 | 值 |
| --- | --- |
| Optimized Prompt | 在 `ink-claude-code-dream` 中完成第二规划轮次“Runtime 最小实现设计”：基于已验证的目标 Server、官方 CLI 与自定义 Runtime 差异，设计匿名优先的 MCP 认证路由；精确定义规范挑战、显式 OAuth 配置、用户主动登录三种入口；覆盖 CLI、registry、OAuth provider、凭证投影、错误分类、HTTP/stdio/资源与工具清单、会话兼容、回滚和测试矩阵；严格区分 MCP 2026-07-28 无状态协议、目标 Server 2025-06-18 传输握手和 Dream 业务恢复；不得复制 OAuth/Agent 状态机，不得扩展到 SDK 环境继承、instructions 截断或 signal 语义。 |
| 负责人 | `/root/runtime_cli_diagnosis` |
| 负责目录 | `docs/design/` |
| 状态 | 已实现并完成 Runtime 自动化、官方 CLI 差分和 Dream 匿名/OAuth 真实 Chat 验收；未发布或部署 |

Optional Enhancer：本轮已执行同配置、同 Server 的官方/自定义 CLI 命令与事件顺序差分；未把官方黑盒行为复制成新的生产状态机。

## 2. 结论

最小修复不是增加一套 OAuth 状态机，而是删除错误的“配置即认证事实”推断：

1. `mcp add` 不再默认写入 `oauth: true`。
2. HTTP Server 没有可用凭证时先匿名连接；只有收到合规的认证挑战、配置明确提供 OAuth 发现线索，或用户主动执行 `login` 时，才进入现有 OAuth provider。
3. `get`、`list` 的认证状态来自一次真实连接/健康探测结果，不再仅由凭证投影是否存在决定。
4. 配置声明、凭证投影和服务器认证事实是三个独立量，不得相互冒充。
5. 复用现有 MCP SDK、registry 和 provider；不复制 Authorization、OAuth 或 Claude Agent 的状态机。

本次仅改变 Runtime 内部的路由与诊断语义，不改变 Dream、Claude Agent SDK、MCP 工具协议或服务端实现。

## 3. 已验证复现证据

为避免把用户指定地址固化到实现或 fixture，以下用 `MCP_TARGET_URL=<target-server>/mcp` 表示本轮目标地址。

### 3.1 目标 Server

通过原始 HTTP 请求验证：

- `GET $MCP_TARGET_URL` 返回 `405`，允许 `DELETE, POST`，没有 `WWW-Authenticate`。
- `POST initialize`，协议版本 `2025-06-18`，返回 `200`；`serverInfo` 为 `comfy-mcp 0.10.0`。
- 随后的 `notifications/initialized` 返回 `202`。
- `tools/list` 返回 40 个工具；`resources/list` 和 `prompts/list` 均为空。
- 响应没有 `Mcp-Session-Id`。
- Protected Resource Metadata well-known 地址返回 `404`。
- 服务器业务工具 `auth_status` 返回 `signed_in: false`，但 MCP 传输和工具发现仍然成功。

这证明目标 Server 是“匿名可连接的 MCP Server，其工具层另有业务登录能力”，而不是“需要 OAuth 才能建立 MCP 传输”。工具名 `auth_login`/`auth_status` 不能被 Runtime 解释为传输层 OAuth 信号。

### 3.2 官方 CLI 与自定义 Runtime 差异

在规范化的独立目录 `/private/tmp/...` 中运行，避免 macOS `/tmp` 符号链接触发路径安全拒绝：

| 操作 | 官方 Claude CLI `2.1.220` | 自定义 Runtime |
| --- | --- | --- |
| `mcp add` | 成功 | 成功，但写入 `{type:http,url,oauth:true}` |
| `mcp get` | `Connected` | `Needs authentication` |
| `mcp list` | `Connected` | `Needs authentication` |
| `mcp login` | 不需要完成传输登录即可正常使用该 Server | 进入 OAuth 并以通用错误退出 |
| 实际匿名 initialize / inventory | 成功 | 使用普通 `{type:http,url}` 控制配置时同样成功并发现 40 个工具 |

因此网络、协议版本和 SDK 基础连接能力不是故障点；错误发生在管理 CLI 写配置和状态投影的认证路由上。

### 3.3 精确根因

- `src/cleanroom/mcp/management-cli/storage.ts` 的 `addServer()` 无条件写入 `oauth: true`。
- `src/cleanroom/mcp/management-cli/index.ts` 的 `statusLabel()` 只检查投影 token：有 token 即 `Connected`，无 token 即 `Needs authentication`，没有健康探测。
- 同一文件的 `login` 路径因此强制调用 OAuth flow；目标 Server 没有挑战和 metadata，最终只输出通用 `Claude MCP command failed.`。
- `src/cleanroom/mcp/config.ts` 把 `oauth`、`authProvider` 或 `authorization` 的存在投影为 `requiresOAuth`。
- `src/cleanroom/mcp/registry.ts` 在真正连接前依据 `requiresOAuth && !provider` 阻断，导致匿名可用的 Server 无法到达 SDK transport。

## 4. 当前调用链

### 4.1 `add/get/list/login/logout`

```text
mcp add
  -> management-cli/index.ts
  -> storage.addServer()
  -> 写入 HTTP 配置（当前额外写 oauth:true）

mcp get/list
  -> storage.readServer()/listServers()
  -> storage.readProjectedOAuth()
  -> statusLabel(projectedToken)
  -> 输出 Connected / Needs authentication

mcp login
  -> createManagementOAuthContext()
  -> flow.beginLogin()
  -> provider.auth()
  -> 打印 authorization URL
  -> 读取回调 URL
  -> flow.completeLogin()
  -> 写 private OAuth state，并镜像 projected credential

mcp logout
  -> createManagementOAuthContext()
  -> provider.stopAcceptingMutations()
  -> flow.logout()/provider.invalidateCredentials("all")
  -> 删除 projected credential；保留 Server 配置
```

目前顶层 catch 将多数错误压成同一条消息，调用者无法区分用户取消、metadata 无效、网络错误或服务器根本不支持传输 OAuth。

### 4.2 Runtime registry

```text
读取 MCP 配置
  -> config.ts 归一化并计算 requiresOAuth
  -> mcp/index.ts 仅为 requiresOAuth Server 创建 provider
  -> registry.connectServer()
       -> 当前 requiresOAuth 且无 provider 时提前失败
       -> 创建 stdio / HTTP transport
       -> SDK client.connect()
       -> tools/resources/prompts inventory
       -> 记录连接或认证转换状态
```

### 4.3 OAuth provider

`oauth/flow.ts` 已提供 begin、callback、refresh、logout；`oauth/provider.ts` 已提供 client information、tokens、PKCE verifier、state、discovery 和凭证失效；`management-cli/oauth.ts` 已把 private state 与管理 CLI 的 projected credential 对接。

这些组件应继续作为唯一 OAuth 实现。新路由只负责决定“什么时候调用它们”和“怎样把结果投影为稳定状态”，不得重写协议细节。

## 5. 三层协议边界

### 5.1 MCP 2026-07-28：无状态核心协议

2026-07-28 版本取消 `initialize`/`initialized` 和传输会话依赖；每个请求自描述，HTTP metadata 可镜像到 header，但消息 body 是事实源。HTTP Authorization 是可选的传输能力，受保护资源使用 RFC 9728 metadata、授权服务器发现、issuer 校验和 resource indicator。

本设计只吸收它的认证安全约束与“认证属于 HTTP transport”的分层，不要求当前 Runtime 立即把目标 Server 升级到 2026 协议。

### 5.2 目标 Server：MCP 2025-06-18 握手

当前目标明确使用 `initialize -> notifications/initialized -> inventory`。即使它没有返回 `Mcp-Session-Id`，也不能跳过 2025-06-18 握手；“无 Session header”不等于“2026 无状态协议”。Runtime 应继续由当前 SDK 执行该握手。

### 5.3 Dream 业务恢复

Dream resume 恢复的是 Thread/Run、Agent 会话和业务上下文。它不恢复、持久化或伪造 MCP transport session。恢复后 Runtime 根据 Server 配置和可用凭证重新建立 MCP client；若目标采用旧协议，重新握手；若未来采用 2026 无状态协议，则按能力选择无状态请求。

三层状态不得互相替代：

```text
Dream Thread/Run resume
        != MCP HTTP transport session resume
        != OAuth authorization state
```

## 6. 目标匿名优先路由

### 6.1 总体算法

```text
解析配置并确定 transport
  |
  +-- stdio -> 不进入 HTTP OAuth；按 stdio 原合同连接
  |
  +-- HTTP
       |
       +-- 有与当前 Server/issuer/client 绑定且可用的投影凭证
       |     -> 带凭证连接
       |     -> 401 时允许 refresh 一次；仍失败则处理规范挑战
       |
       +-- 无可用凭证
             -> 先匿名连接（配置存在 OAuth hint 也不提前阻断）
             -> 成功：Connected，执行完整 inventory
             -> 401 + 合规 Bearer challenge/metadata：Authentication required
             -> 403：仅规范 insufficient_scope 可进入 step-up
             -> 其他错误：按网络/协议/安全类别返回，不伪装成认证需求
```

这里的“匿名优先”指无可用凭证时优先验证公开能力；不是要求已有有效凭证的用户先降权匿名请求。已有凭证时复用凭证，避免额外请求和权限视图漂移。

### 6.2 入口一：规范挑战与 metadata

正常连接收到 `401` 时，只有同时满足以下条件才进入 OAuth：

- 是 HTTP transport；
- `WWW-Authenticate` 是可解析的 Bearer challenge；
- 能从 challenge 或 RFC 9728 well-known 位置取得 Protected Resource Metadata；
- metadata 的资源、授权服务器、scheme/host 和 issuer 通过现有 provider/SDK 的规范校验；
- 后续授权服务器 metadata 可按 RFC 8414 或 OIDC 发现。

此时把状态投影为 `Needs authentication`，并允许 `login` 或 Runtime 的既有认证控制流继续。不得从一个裸 `401` 猜测授权端点，也不得把 token 发给 metadata 指向的未验证主机。

有 token 时收到 `403` 且 challenge 明确给出 `insufficient_scope`，可按规范执行一次有界 step-up：新请求 scope 是已请求 scope 与本次操作所需 scope 的并集。普通 `403` 不触发 OAuth。

### 6.3 入口二：显式 OAuth 配置

显式的 `oauth`、`authorization` 或 `authProvider` 配置表示：

- 管理者允许 Runtime 为该 Server 构造既有 provider；
- 配置可提供 client registration、metadata/issuer 或 scopes 等发现线索；
- 用户主动 `login` 时可以在没有先前 challenge 的情况下开始经过验证的发现。

它不表示：

- Server 一定拒绝匿名连接；
- 当前已有凭证；
- `get/list` 可以跳过网络探测直接输出 `Needs authentication`；
- registry 可以在 transport.connect() 前失败。

为了兼容历史配置，读取已有 `oauth:true` 时把它降级为 OAuth hint，而不是 `requires-auth` 事实；不需要迁移或重写用户配置。

### 6.4 入口三：用户主动 `login`

用户显式执行 `mcp login <name>` 时：

1. 验证 Server 存在且是 HTTP transport。
2. 优先使用已验证挑战缓存或显式配置中的 metadata/issuer 线索；否则按规范 well-known 发现。
3. 如果 Server 没有声明 transport OAuth，稳定返回 `mcp_auth_not_advertised`，不修改配置、private state 或投影凭证。
4. 若 provider 判断当前凭证已授权，完成一次安全健康探测后退出 `0`；这是 `login` 的正常早退。
5. 若需要交互，沿用既有 authorization URL、PKCE/state 和 callback 路径。
6. 成功后持久化 private state、更新投影，并重新连接/探测；只有探测成功才输出 `Connected`。
7. 用户取消或输入 EOF 时仅清理本轮 pending state/verifier，不删除先前可工作的 token。

目标 Server 的 `auth_login` 是普通 MCP 工具；主动执行管理命令 `mcp login` 不得偷偷调用该工具，也不得以工具存在推断传输认证。

## 7. 配置声明与投影凭证

| 数据 | 含义 | 不能证明 |
| --- | --- | --- |
| Server 配置 | endpoint、transport、可选 OAuth intent/hints | Server 当前受保护、用户已登录 |
| private OAuth state | provider 持有的 client/tokens/verifier/state | MCP 健康、inventory 成功 |
| projected credential | 供 Runtime 发现“可能可复用凭证”的最小投影 | token 仍有效、Server 必须认证 |
| 最近探测结果 | 某一时刻的连接/认证/网络事实 | 永久状态 |

投影凭证必须绑定规范化 Server URL，并沿用 provider 已保存的 issuer/client identity 约束。绑定不匹配、过期或无法刷新时不得发送，并按既有失效流程清除或降级；不得仅因为投影文件存在就输出 `Connected`。

操作语义：

- `add`：只写 Server 配置，不创建 OAuth 声明或凭证。
- `get/list`：配置始终可见；状态来自受限健康探测，凭证只影响探测路由。
- `login`：创建/更新凭证，不改变 endpoint 或工具配置。
- `logout`：删除 private/projected credentials，保留 Server 配置；无凭证时幂等成功。
- `remove`：删除 Server 配置，并按现有合同删除该 Server 自有凭证，不影响其他 Server。

## 8. 稳定且安全的 CLI 输出

### 8.1 输出原则

- `stdout` 仅输出成功结果、列表和交互登录所需的已验证 authorization URL。
- `stderr` 输出一行稳定错误：`Claude MCP command failed [code=<semantic-code> retryable=<true|false>].`
- 不输出 access/refresh token、authorization code、PKCE verifier、callback URL、请求 header、metadata 原文或响应 body。
- `list/get` 不回显配置中的 secrets/headers；Server URL 按现有公开配置合同展示。
- 人类状态标签可以本地化，自动化只依赖方括号中的 semantic code 和进程退出码。

为保持 Dream 和既有脚本兼容，本轮不扩展进程退出码状态机：成功为 `0`，所有已处理的操作失败为 `1`；参数解析错误也维持当前非零行为。更细粒度由稳定 semantic code 提供，避免在未修改 Dream/SDK 的情况下引入破坏性退出码。

### 8.2 状态标签

| 标签 | 判定 |
| --- | --- |
| `Connected` | 当前探测完成 handshake/请求并完成预期 inventory |
| `Needs authentication` | 已收到并验证规范认证挑战，或主动登录已验证 metadata 但尚未授权 |
| `Forbidden` | 服务器拒绝操作，且没有可执行的规范 scope step-up |
| `Unavailable` | timeout/network/remote 失败；不得伪装成认证问题 |
| `Invalid authorization metadata` | metadata、issuer、resource 或授权端点校验失败 |
| `Configured` | 只读路径明确未执行探测时的保守状态；不得显示为 `Connected` |

### 8.3 错误分类

| 条件 | Semantic code | Retryable | 路由/清理 |
| --- | --- | --- | --- |
| `401` + 有效 challenge/metadata | `mcp_auth_required` | false | 进入现有 OAuth 路由；不删除 Server 配置 |
| `401` + 无效/缺失 challenge | `mcp_auth_challenge_invalid` | false | 不猜端点；不开始登录 |
| token 后 `401` | `mcp_auth_required` | false | 最多 refresh 一次；失败后清理失效 token |
| `403` + `insufficient_scope` | `mcp_insufficient_scope` | false | 最多一次规范 step-up |
| 其他 `403` | `mcp_forbidden` | false | 不自动登录 |
| MCP endpoint `404` | `mcp_endpoint_not_found` | false | Server 不存在/路径错误 |
| metadata endpoint `404` | `mcp_auth_not_advertised` 或 `mcp_auth_metadata_invalid` | false | 主动 login 无广告时前者；已有规范 challenge 引用缺失 metadata 时后者 |
| timeout | `mcp_timeout` | true | 保留配置和凭证；状态 `Unavailable` |
| DNS/connect/TLS 网络失败 | `mcp_network_error` | true | 保留配置和凭证；不得标记需登录 |
| metadata resource/issuer/URL 无效 | `mcp_auth_metadata_invalid` | false | fail closed，不发送 token |
| 用户取消登录 | `mcp_auth_cancelled` | false | 清除本轮 pending state，保留旧 token |
| 登录输入 EOF/进程提前结束 | `mcp_auth_input_closed` | false | 同上；非零退出 |
| 已授权的 `login` 早退 | 无错误 | 不适用 | 健康探测成功后退出 `0` |

`404` 必须带上下文分类：目标 Server 的 well-known `404` 在匿名连接已成功时，只说明它没有广告 transport OAuth，不能推翻连接成功。

## 9. inventory、transport 与恢复兼容

### 9.1 tools/resources/prompts

- 认证路由不得按工具名称、数量或 schema 做特殊判断。
- 匿名或凭证连接成功后，继续沿用 registry 的 tools/resources/prompts 发现路径和分页语义。
- 目标 Server 的 40 个工具、0 resources、0 prompts 是回归基线，不是写入生产逻辑的常量。
- 认证后权限变化时重新执行 inventory；不得把匿名 inventory 永久缓存为认证后的能力。
- Server instructions 的处理维持当前合同；本设计不讨论截断或 prompt 注入变化。

### 9.2 stdio

stdio transport 不使用 HTTP Authorization discovery。它继续按现有 child process 配置、换行分帧和关闭语义连接；若 stdio Server 自己需要凭证，应由其已有配置合同提供，而不是复用 HTTP OAuth 路由。本轮不改变 SDK 环境继承。

### 9.3 HTTP 与 session

- 当前 2025-06-18 Server 继续执行 initialize/initialized。
- 有 `Mcp-Session-Id` 时交由 SDK 的现有 transport 生命周期处理；没有时不自行生成。
- 401/403 只改变 Authorization 路由，不改变 JSON-RPC body、SSE、工具调用或 inventory 合同。
- 未来 2026-07-28 无状态 Server 应通过 SDK/协议 capability 支持，不用 Dream resume 或手写 session 状态模拟。

## 10. 明确不做

- 不复制或重写 MCP SDK 的 OAuth、PKCE、metadata discovery、refresh、step-up 状态机。
- 不复制 Claude Agent SDK 的 Agent/session/resume 状态机。
- 不让 Dream 或 SDK 为本修复增加分支、环境变量或新 DTO。
- 不以工具 `auth_status`/`auth_login` 推断 transport authorization。
- 不增加 runtime DDL、持久化服务或凭证数据库。
- 不扩展到 SDK 环境继承、Server instructions 截断、signal/取消语义。
- 不把目标 host、scope、超时或重试次数硬编码进业务代码；使用现有 config/provider/SDK policy。
- 不声称当前 Runtime 已实现 MCP 2026-07-28；只保证分层设计可兼容演进。

## 11. 最小改动建议

实现阶段优先限制在以下文件；只有测试证明确有需要才扩大范围：

1. `src/cleanroom/mcp/management-cli/storage.ts`
   - `addServer()` 停止默认写 `oauth:true`。
   - 保持历史配置可读，不做破坏性重写。
2. `src/cleanroom/mcp/config.ts`
   - 把“存在 OAuth 声明”表达为 hint/provider capability，不再等同于连接前 `requiresOAuth` 事实。
3. `src/cleanroom/mcp/index.ts`
   - 显式配置或已有投影凭证时仍可构造既有 provider；不把 provider 是否存在用作匿名连接门。
4. `src/cleanroom/mcp/registry.ts`
   - 删除连接前认证阻断；先按凭证/匿名路由连接，再从规范错误转换状态。
   - 保持 transport、inventory、重连和关闭路径唯一。
5. `src/cleanroom/mcp/management-cli/index.ts`
   - `get/list` 使用有界健康探测，不再仅检查 token。
   - 输出稳定 semantic code，区分取消、metadata、网络和协议失败。
6. `src/cleanroom/mcp/management-cli/oauth.ts` 与 `src/cleanroom/mcp/oauth/flow.ts`
   - 仅在测试发现必要时增加“未广告 OAuth”和“已授权早退”的薄适配；不得复制 provider 逻辑。
7. 对应现有测试目录
   - 增补 management CLI、registry 和 provider-free HTTP fixtures；不得增加第二套生产入口。

如果现有 SDK 已能从 connect error 完成 challenge/discovery，优先消费其结构化错误；不要写新的 HTTP OAuth 客户端。若 SDK 只提供文本错误，应在 transport adapter 单点归一化，禁止在 CLI 和 registry 各解析一次。

## 12. 实施顺序

1. 固定当前失败 fixture 和官方/Runtime 事件证据。
2. 修正 `add` 配置写入与历史配置解释。
3. 删除 registry 的预连接阻断，实现“已有凭证复用，否则匿名”。
4. 将 SDK/provider 的认证结果归一化为内部一次性结构化 outcome。
5. 让 `get/list/login/logout` 消费同一 outcome，增加稳定 semantic code。
6. 扩充矩阵测试并跑 Dream 既有协议验收；Runtime 本仓只提供稳定分类，Dream 在独立分支以兼容 parser/DTO 消费，不把连接逻辑复制过去。
7. 更新本目录设计状态和实现证据。

## 13. 测试矩阵

| 维度 | 场景 | 预期 |
| --- | --- | --- |
| 管理 CLI | `add` 开放 HTTP Server | 配置无默认 `oauth:true`；exit 0 |
| 管理 CLI | 历史 `{oauth:true}` + 开放 HTTP | 匿名连接成功；`get/list` 为 `Connected` |
| 目标回归 | 2025-06-18 initialize + 40 tools | handshake/inventory 成功；不进入 OAuth |
| 目标回归 | 主动 `login`，well-known 404 | `mcp_auth_not_advertised`；配置与 inventory 不变 |
| 规范认证 | 匿名请求 401 + 合法 challenge/metadata | `mcp_auth_required`；既有 provider 生成授权流程 |
| 规范认证 | callback 成功 | private/projected credential 更新；重连后 `Connected` |
| token | token 401、refresh 成功 | 只 refresh 一次；请求成功 |
| token | token 401、refresh 失败 | 清理失效 token；`mcp_auth_required` |
| scope | 403 + `insufficient_scope` | 一次有界 step-up，scope 合并 |
| forbidden | 裸 403 | `mcp_forbidden`；不启动 OAuth |
| metadata | challenge 引用 404 metadata | `mcp_auth_metadata_invalid`；fail closed |
| metadata | issuer/resource 不匹配、非安全 URL | `mcp_auth_metadata_invalid`；不发送 token |
| 网络 | DNS/TLS/connect 失败 | `mcp_network_error`；保留凭证/配置 |
| 网络 | 探测 timeout | `mcp_timeout`；retryable true |
| 交互 | 用户取消 | `mcp_auth_cancelled`；旧 token 保留 |
| 交互 | EOF/登录进程提前结束 | `mcp_auth_input_closed`；pending state 清理 |
| 交互 | 已有授权主动 login | 探测成功后 exit 0，不重复授权 |
| logout | 有凭证 | private/projected 删除，Server 配置保留 |
| logout | 无凭证 | 幂等 exit 0 |
| remove | 删除一个 Server | 只删除对应配置和凭证 |
| inventory | tools/resources/prompts 分页及权限变化 | 每次连接按当前权限完整发现，无名称特判 |
| stdio | add/get/list/connect | 与修复前一致，不进入 HTTP OAuth |
| HTTP session | 有/无 `Mcp-Session-Id` | 完全交由 SDK；认证路由不伪造 session |
| Dream resume | 恢复 Thread/Run 后重建 MCP | 使用配置/凭证重新连接，不恢复 transport session |
| 2026 兼容 | SDK 支持的无状态 fixture | 无 initialize/session 假设；body 为事实源 |
| 安全输出 | 所有失败与 debug 输出 | 无 token/code/verifier/header/metadata body 泄漏 |
| 兼容 | 现有与新版 Dream MCP parser/控制协议 | 保留 exit 0/1 和既有成功文本；新增固定认证/失败行供 expand/consume |

测试 fixture 必须使用本地可控 HTTP/stdio Server，超时与重试由测试 clock/policy 注入；目标地址仅用于只读回归，不写入生产代码或永久 fixture。

## 14. 可选协议事件差分测试

可新增一个只记录脱敏事件的黑盒 harness，对官方 CLI 与自定义 Runtime 执行同一矩阵：

```text
add -> get -> list -> connect -> initialize/control -> inventory -> login/logout
```

比较项仅包括命令退出码、稳定状态、HTTP status、JSON-RPC method 顺序、是否出现认证挑战、inventory 计数和清理结果。所有 URL 用 origin/path 分类脱敏，禁止记录 header、token、callback、正文或用户内容。

该测试用于发现协议事件差异，不以复制官方内部实现为目标，也不能成为恢复源码或不可验证行为的入口。本轮已执行真实命令差分并记录退出码、状态、inventory 与认证入口；没有固化 token、callback 或官方内部实现。

## 15. 回滚

本重构不做配置迁移、schema 变更或凭证格式破坏，因此回滚以源码版本回退为主：

1. 保留对历史 `oauth:true` 配置和现有 projected/private credential 的读取能力。
2. 发布前保存开放 HTTP、规范 OAuth、stdio、Dream resume 四类基线回执。
3. 若新路由导致连接回归，回退 Runtime 版本；不得删除用户配置或全量清空凭证。
4. 回滚验证至少覆盖：旧配置可读、已有 token 可继续使用、开放 Server 仍能恢复、logout 不误删配置。
5. 不引入按 `development/test/production` 或临时环境变量切换的双业务路径；修复和回滚均保持单一生产路径。

## 16. 完成门槛与结论

- 目标开放 Server 的 `add/get/list` 与官方 CLI 一致显示可连接，40-tool inventory 回归通过。
- `login` 对未广告 OAuth 的 Server 返回明确安全错误，而不是通用失败。
- 规范 401/403/metadata、取消、网络和 early-exit 均有稳定分类与无泄漏测试。
- HTTP/stdio、tools/resources/prompts、旧/新 session 语义及 Dream resume 均无回归。
- 实现 diff 局限于最小文件集合，未复制 OAuth/Agent 状态机，未触碰排除分支。
- 文件头、目录合同、命令与进程测试回执已同步更新；本分支实现状态为“已实现并验证”，但没有取得发布/部署授权。

## 17. 规范依据

- [Anthropic：Model Context Protocol 介绍](https://www.anthropic.com/news/model-context-protocol)
- [MCP 2026-07-28 入门](https://modelcontextprotocol.io/docs/2026-07-28/getting-started/intro)
- [MCP 2026-07-28 release：Stateless Core 与 Authorization hardening](https://blog.modelcontextprotocol.io/posts/2026-07-28/)
- [MCP 2026-07-28 Authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)
- [MCP 2026-07-28 Transports](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports)
- [Claude Code MCP 官方文档](https://code.claude.com/docs/en/mcp)

这些链接定义目标设计的安全边界；目标 Server 的实际兼容基线仍是本轮验证到的 MCP `2025-06-18` 握手。

## 18. 实现与验证回执

### 18.1 最小实现

- `management-cli/storage.ts` 的普通 HTTP add 不再制造 `oauth:true`；历史 marker 只作为 hint 继续兼容。
- `registry.ts` 删除 pre-connect OAuth 阻断：无凭证先匿名连接，有已绑定凭证才构造 provider；连接结果同时报告 transport、authentication、inventory 与安全 failure code。
- `management-cli/index.ts` 的 get/list 以真实有界探测为依据，稳定输出 `Status`、`Authentication`、`Transport` 与可选 `Failure-Code`；list 继续每个 Server 一行，避免破坏 Dream parser。
- 主动 login 对匿名可用且未要求 OAuth 的 Server 返回 `auth_not_required`，不打开浏览器、不创建 token；规范 401 challenge 继续进入既有 SDK provider。
- cancel 只清理本轮 pending operation，保留既有可工作 token；logout 清理凭证后重新探测并投影 anonymous 或 required。
- SDK 公共 API、MCP JSON-RPC、stdio、SSE、Dream session/resume 与 OAuth provider 状态机均未复制或修改。

### 18.2 自动化

| 命令/范围 | 回执 |
|---|---|
| `npm test` | 99 total：97 pass、2 个显式 official OAuth fixture skip、0 fail，exit 0 |
| `npm run lint` | 194 TypeScript + 15 JSON 文件检查通过，exit 0 |
| focused MCP | management/OAuth/registry 17/17；config-free `mcp --help` 与 management 5/5 |
| compat | 46 pass、6 skip、0 fail |

覆盖 stdio、authless HTTP、规范 OAuth HTTP、tools/resources/prompts inventory、带冒号 name、tool call/result、callback、login/logout/cancel、旧配置、session/reconnect、401/403/404、timeout/network、invalid metadata、process exit 和错误无凭证泄漏。

### 18.3 真实与差分

- 目标匿名 Server：官方 CLI `2.1.220` 与本分支 `add/get/list` 均 exit 0 且 Connected；本分支额外报告 anonymous，发现 40 tools、0 resources/prompts。官方主动 login 因 OAuth discovery 404 exit 1；本分支返回 `auth_not_required`，不打开浏览器。
- 规范 OAuth Server `https://cloud.comfy.org/mcp`：匿名请求实测 401 Bearer challenge，Protected Resource Metadata 有效；通过 Dream 公开 API 和已有授权账户完成 callback/token exchange，连接为 authenticated，发现 41 tools；cancel、两轮 Chat、resume、logout 后 required、remove 均通过。
- 自定义 Runtime 的 `diag:target` 冒号名称全生命周期通过；官方 CLI 拒绝该名称，因此它是有测试保护的兼容扩展，不冒充官方等同行为。
- 本地 darwin-arm64 candidate SHA-256 为 `2759e7ec3ef40473d95527ef6289c77972b94d031646745344977e200fe8384e`，仅用于本机验收；未发布 npm、未部署，也未覆盖已发布 0.1.0 artifact。
