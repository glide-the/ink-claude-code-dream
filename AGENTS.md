<!-- [Input] Dream repository governance and the Runtime's current source, build, release and integration contracts. -->
<!-- [Output] Mandatory instructions for coding agents maintaining this Runtime repository. -->
<!-- [Pos] Root repository governance; nested folder contracts refine their own scope. -->
<!-- [Sync] 2026-09-13: adapt Dream AGENTS to the unique original-module Runtime and npm ownership. -->
<!-- [Sync] 2026-09-13: require precise programming terminology and remove obsolete designs from current documentation. -->

# Runtime AGENTS Instructions

本仓库维护独立 Claude Code Runtime，不是 Dream 后端、Python SDK 或 MCP Apps 前端宿主。变更前先阅读本文件、[README](README.md)、[根目录合同](.folder.md)及受影响目录的 `.folder.md`。

## 职责与事实来源

- `src/` 是唯一运行实现；入口为 `src/entrypoints/cli.tsx`。[source-layout](runtime/source-layout.json)与 [source-provenance](runtime/source-provenance.json)管理原始目录、文件、权限和字节合同。
- `compat/mcp-auth/`、`compat/dream-runtime/`及 `runtime/`管理 source-bound 构建变换、裁剪、隔离和发布门禁；不得成为第二套 Agent 实现。
- `package/`管理 npm selector；根 `package.json` 是私有构建工作区，不可直接发布。
- [发布与 Dream 接入设计](docs/design/single-source-release-and-dream-adoption.md)、[构建文档](docs/build/README.md)、[测试文档](docs/test/README.md)描述操作流程；CI 的实际触发条件以 `.github/workflows/`为准。
- Python SDK 由 `glide-the/ink-claude-dream-agent-sdk-python`维护；Dream 的线程、笔记、数据库映射、权限及宿主 UI 由 `glide-the/im-dream`维护；共享 PostgreSQL schema 仅由 Admin Drizzle 管理。本仓库不新增业务 schema、数据库 fallback 或 Dream DTO。
- 历史报告不是当前运行规范。当前版本从项目、selector、manifest 与发布计划读取，不从旧进度表、环境标签或口头状态推断。

## 单一源码与最小变更

- 复用现有模块和变换，先用 `rg`查找再新增。需要设计评审的实现/架构变更，方案包含“背景与问题、目标与边界、概念与规则”；小型文档修正无需新增设计稿，只解决已证实的缺口。
- 保持原 `claude-code-sourcemap`模块目录、包路径、文件名、权限和初始字节。不得重新设计 `src`、恢复重复源码树、新增第二套运行实现或包装实现、批量格式化原源码或通过修改 provenance 掩盖差异。
- 现有政策在构建层实施；变更必须说明绑定的原模块、预期替换、验证及失败边界。修改原始字节或源码合同必须另获用户明确批准，并评审完整影响范围。
- 外部授权源码根仅提供已验证的依赖及平台资产，不得偷换成本仓库外的另一份运行实现。
- 不按 development/test/production 等标签分叉业务行为；fixture、fake provider、clock 和隔离资源只存在于测试或明确命名的验证脚本中，并调用公开生产入口。
- 不硬编码业务 ID、服务 host、用户路径或随意政策值；使用已有显式配置与 capability。已符合目标时只修正文档、状态语义和缺口测试，不制造代码改动。

## 协议与安全边界

- 评估 JSON/JSONL、control/cancel、tool permissions、MCP/OAuth/resources、plugins/Skills/hooks、子进程隔离、session/resume 和 Dream resolver 的受影响面；不得复制 parser、状态机或通用重试机制。
- Dream note session ID、业务 thread ID 与 Claude session ID 不可互换。业务映射与 fresh/resume 决策归 Dream；Runtime 保留真实 cwd/home 项目存储和原 resume 合同，不广搜历史替代严格定位，不重放已经发送的查询或工具。
- Notion 凭证只允许进入已绑定的原生 Notion Bash 路径；generic shell、hooks 和 stdio MCP 子进程不得继承。不得为修复 PATH/config 错误放宽 native shadow 检查、全局改 PATH 或泄漏 config 内容。
- 接入 Dream 时，cwd/home/tmp、sandbox 和服务端模型配置遵守 Dream composition root 的显式绑定。不得放行整个 `/tmp`、绕过精确 thread 临时目录，或用 ambient env、插件、workspace、浏览器输入覆盖服务端所有的 effort/context/max-output。
- 配置缺失、digest/manifest/capability 不匹配或权限未知必须在对应边界 fail closed；不得自动切换到 SDK 内置 CLI、ambient `claude`或其他版本。诊断只输出安全的字段级差异，不输出秘密和正文。

## 版本与发布

- 当前待发布合同为 Runtime `0.1.10`、SDK `0.2.145`、CLI compatibility `2.1.241`；已发布 `0.1.9` 的范围保留在 [0.1.9 回执](docs/build/runtime-0.1.9-release-notes.md)，`0.1.10` 必须由新一轮四平台 CI 资格与发布回执确认。源码 provenance 版本不是 Runtime 发行版本；后续升级同步受影响合同，不将本段当作永久版本常量。
- 版本变化时，原子同步事实确实变化的受影响合同，包括根项目、selector、四个平台、manifest/计划/门禁、安装验证、README 与相关设计，并在 Dream 同步相关精确 pin、resolver、Docker 和依赖/接入记录；不为同步而改动未受影响的文件。npm 不安装 Python SDK，`uv sync`不安装 Runtime。
- 普通 PR CI 通过不等于完成四平台原生资格化或公开发布。按当前 workflow 检查确切源 SHA、平台构建、许可证/授权、SBOM、checksum、无 `.map`及生产 gate，复用仍有效的同字节验收。
- 先发布四个精确平台包，再发布 selector；发布仅通过已配置的 CI/OIDC 与保护门禁，不从私有根目录执行 `npm publish`。文档变更不自动授权版本递增、重新资格化或发布。
- 已存在版本先核对公开制品身份与摘要，不覆盖、不删除重传、不移动不可变标签；registry 延迟不能授权重新构建不同字节。必要修复使用经审核的新版本。
- 原始版权和 `runtime/source-authorization.json`授权边界保持不变；selector 的 MIT 不覆盖原模块。本文件不授予新的再分发权，也不改变现有授权。

## 文档同步

### 通用产品设计原则与用语（强制）

- 不得增加“可信”“不可信”“物化”等含糊概念标签或抽象符号；它们没有定义具体程序行为，只会增加理解成本。已有描述必须按语境改为身份认证、权限/schema 校验、调用关联、数据转换、文件生成、持久化等专业用语，并明确模块、输入输出、条件和失败处理。
- 相关项目的功能变更必须同步受影响设计稿，采用“背景与问题、目标与边界、概念与规则”，规则对应实际业务约束；写清正常流程、状态转换、失败反馈、影响范围与验收，不把技术常量当产品限制，不新增无决策价值的说明、确认或架构。
- 配置型设计明确 default、desired、effective、revision 和转换条件。沿用具体代码/协议标识符及官方名称，不因文档用语清理重命名接口；正文、表格和时序图描述同一行为。
- 已废弃方案从当前设计稿和索引删除；历史追溯使用 Git 或已有执行回执，不把废弃架构留作当前设计的一部分。

- 功能、架构、路径、命令、版本或权限变化必须同轮更新 README、受影响 `.folder.md`、文件头和设计/验证状态。原始 `src`文件头也是字节合同，改动说明写入变换层及文档，不为满足同步规则修改原始头。
- 新文档注明职责和适用状态；独立执行回执标明日期与版本，不改写历史验收结果，不把用户确认、fixture 或旧启动记录写成当前自动化成功或服务存活。
- 不为本仓库凭空新增 Dream 的中文 README 镜像合同；现有多语言文档若被修改，保持相同事实、命令和边界。

## 影响评估与验证

- 测试前列出受影响入口、消费者、权限和发布面。文档-only 验证 Markdown 路径/命令/版本事实与 `git diff --check`；不重复昂贵构建或真实模型调用。
- 有意义的实现变更按范围运行 `npm run lint`、`npm test`、`npm run source:verify`、`npm run test:mcp-auth-compat`、`npm run test:dream-compat`；需要编译时按 README 提供授权依赖/资产根。
- 涉及 SDK、MCP 或打包时增加相应 `test:upstream-sdk`、`test:mcp-source`、`test:acceptance`、`test:reproducible`或 npm gate/install smoke。不得用仅覆盖报错点的测试代替受影响业务完整流程。
- Provider-free 技术验证使用明确命名的自有隔离 home/workspace/provider。用户要求真实业务验收时走本机正常 Dream/Admin/Gateway/PostgreSQL、指定现有账户及业务实体，保留正常 Admin 可查的业务与结算回执；隔离账本或假模型不是实际业务成功。
- 浏览器优先复用已安装 Chrome；harness 启动失败不判定产品缺陷。缺少依赖、授权或 secret 如实报告，不改生产行为迁就测试。
- 最终报告命令、exit code、pass/skip/fail、未执行项、制品/PR/Git 状态及剩余操作；CI skipped 或未触发不能称为通过。

## 工作区与进程

- 保留用户与其他 Agent 的改动；不回退、批量格式化、force-push、强制合并或跳过检查。跨仓库修改留在对应项目，超出目标的变更先取得授权。
- 不提交 tokens、DSN、OAuth/config、transcript、Workspace 正文、下载凭证或生成包；生成物按现有忽略合同存放，不能混入源码。
- 只清理本轮创建且确认身份的进程、端口及隔离资源，不停止用户现有 Dream、Admin、MCP 或 PostgreSQL 服务。切主分支须遵守 linked worktree 占用约束，不强占另一工作树。
