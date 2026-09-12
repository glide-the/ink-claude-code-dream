<!-- [Input] Original module recovery, duplicate source directory, GitHub npm publishing and local Dream integration. -->
<!-- [Output] Minimal implementation and interaction plan with independently verifiable release states. -->
<!-- [Pos] Current source-cleanup/release/adoption design and acceptance checklist. -->
<!-- [Sync] 2026-09-13: retain completed immutable release; scope post-release visibility/documentation fixes without redesign. -->

# 唯一源码、CI 发布与本机 Dream 更新

## 背景与问题

Runtime 已将原始恢复模块作为实际 `src` 实现。重复保存的
`restored-src/src` 不再承担实现职责，仍存在双树校验和文档引用。
实施前基线（2026-09-13 核对）：发布 workflow 是失败占位步骤，npm 最新
版本为 0.1.4。本机 Dream 的源码 pin 不等于运行进程已加载新版本。

## 目标与边界

只保留 `src`，维持原始目录、模块、路径、字节与权限。来源提交及库存摘要
移至 `runtime/source-provenance.json`，不另存完整源码副本。
通过现有 GitHub CI 发布，再更新本机 Dream。用户已确认公开 npm、已有
来源授权和本机目标，不重复询问；保留原始版权，不将原始代码改标 MIT。
不修改 SDK API、数据库、Admin/Gateway、远程服务或无关产品功能。

## 概念与规则

源码、构建、制品、发布、安装和运行是六个独立状态，只有各自证据满足才能
推进。新版本不得覆盖 npm 已有版本；历史不同实现的收据不授权当前制品。
使用现有四个平台包和选择器拓扑，平台先发布，选择器最后发布。
构建依赖与平台资源可以来自明确校验的恢复仓库，但源码始终来自 Runtime 仓库根目录 `src`，删除的也是同仓库根目录 `restored-src`。
CI 必须执行真实构建和对应制品验证，不能禁用质量门或伪造通过收据。
Ubuntu hosted CI 的 userns 宿主前提只在一次性 trusted-main job 临时准备并恢复，
先执行真实 bwrap preflight；不改变 Runtime sandbox 或本机/生产安全配置。

## 实施与交互

1. 删除前验证 1,902 个源文件、35 个顶层模块、库存摘要和原始权限。
2. 将双树同步器替换为只读单树校验器，检查原始库存并拒绝重复目录；更新
   构建收据、测试、当前文档及 CI 引用，再删除本仓库重复目录。
3. 修复现有 qualification/publish workflow 的实际依赖来源、构建与制品
   传递；保留版权和制品校验。根据现有版本管理规则更新版本，推送 scoped
   branch，经检查合并后使用 CI 发布，不手工绕过发布流程。
4. npm 上传成功后验证公开版本和摘要；本机安装精确版本，执行 manifest
   resolver/no-map smoke，再原子更新 Dream pin、锁文件与双语文档。
5. 核对本机 Dream 后端的命令、cwd 和进程身份，只重启明确属于 Dream 的
   进程；验证健康状态和 Runtime 的实际解析身份，不能用兼容 CLI 版本代替
   包版本。正常 PATH 不得被临时显式 CLI 路径掩盖。

每个阶段简短报告实际结果；有真实阻塞时给出失败字段和已完成工作，不宣称
后续状态成功。无需新增 UI、确认弹窗、通用部署器或平行 Runtime。

## 目标审查

上述修改直接服务于去歧义、真实 CI 发布与实际采用：保留现有 compiler、
packager、resolver 和部署入口；只更换失效的双树职责和发布占位步骤。
不引入新架构。生产资格缺失必须补真实证据，不通过降低门槛满足目标。

## 验收与回退

实施核对发现 npm/Dream 还要求 `sandbox.notion-cli`，而原始 local-core 的
13 项基础能力不承诺旧 cleanroom 专用隔离行为；聚合必须拒绝缺失能力。
不能以修改 manifest 或使用旧业务收据消除此阻塞。采用前也必须核对当前
server-owned 模型 max output 投影，必要兼容应位于既有 source-bound build
层，不修改原始模块库存、不新增平行实现。

兼容方案复用原 compiler：`compat/dream-runtime` 的小型策略函数只验证显式
workspace/environment；六个原始文件先校验完整 sha256，再执行唯一 marker
内存变换。生产 Bash 消费 Dream 已持有的 server-owned `NOTION_HOME`、
`NOTION_API_TOKEN`、`NOTION_KEYRING`、`NOTION_WORKERS_CONFIG_FILE`；泛用
子进程、命令 hook 和 final stdio MCP 禁止继承这四个字段。测试只使用 fake
token/config 与本地 fake provider。环境的显式 undefined 也阻止 execa 默认
继承重新注入；native ntn/PATH shadow、home 权限/路径检查 fail closed。
保留原 Sandbox deny 规则，不开放整个 `/tmp` 或用户目录。

显式 max-output/context 和五档全局 effort 只消费既有 server-owned carrier，
不通过模型 ID 猜测；没有 carrier 时保留 upstream 行为。已有 SDK/MCP
进程 harness 增加 candidate 模式，验证 native Bash、hook/stdin MCP 隔离和
本地 fake provider 的最终请求参数；full qualification 和 package gate 必须绑定该新收据。
这不是新增 UI/Runtime/Notion CLI 或一般化的策略框架，符合最小目标。

以下是验收条件，不表示各阶段已完成；完成状态以实际阶段回执为准。

- Runtime `src` 原始库存校验通过；`restored-src` 不存在；构建使用唯一源码。
- 相关测试、文档路径及 diff 检查通过，历史收据未被改写。
- GitHub CI 对当前制品成功发布，四个平台包与选择器公开版本一致。
- 本机安装身份与公开制品一致，关联重启后 backend PID/启动时间与该进程的
  resolver 身份，核对 Runtime path/package version/manifest 摘要；对同一安装
  路径执行无真实凭据的既有 Runtime/MCP smoke。health 不替代身份，启动选择
  不冒充一次真实用户/model turn。
- 回退只使用上一已验证安装和提交，不覆盖发布版本、不重绑旧收据。
  删除的重复源码可从 Git 提交 `a40037a` 恢复；原始参考仓库保持不动。

## 发布后收尾：问题、方案与目标审查

`0.1.9` 四平台资格、公开五包、正常 PATH 安装和本机启动采用均已完成，
结果见 [当前发布说明](../build/runtime-0.1.9-release-notes.md)。用户已另行确认
真实模型对话/Notion E2E；任务启动的后端随后按要求停止，不重新启动。
README、folder contract 和发布说明的 pending/旧项目版本必须同步实际状态，
保留历史基线、来源 SHA 和原始业务收据，不改写已发布制品来源。

原发布工具将上传后的 E404 可见性延迟误报为摘要差异，30 秒窗口不足以覆盖
本次 2–4 分钟传播。复用现有 npm transport：优先在线查询，每 5 秒重查真实
E404，包含请求耗时的总等待上限为 5 分钟。上限是可调整的 CI 技术等待预算，
不是业务或发布权限；超时报尚未可见，只能重试同一 qualified 归档。
不同摘要立即失败；非 E404、无效元数据或失败上传也立即失败，不能盲目再上传。
只输出包版本/退出码/结构化错误码，不记录 npm 原始正文或认证值。

为验证控制流程，只在测试中注入 transport/clock；生产 CLI 继续强制 CI-only、
真实五包 verifier、平台先于 selector、不可变完整摘要和现有认证策略。
普通 CI 增加离线回归；docs/folder/publisher-only main 提交不生成新 Runtime
制品，真正的 Runtime/构建输入及 qualification workflow 改动仍触发四平台资格。

审查结论：问题只涉及发布工具和状态文档，不改 Runtime/SDK 接口、原始模块、
版本、数据库或服务。无需新队列、状态机、部署器、UI、重发 `0.1.9` 或重跑用户
真实业务流程；重点验收延迟成功、截止时间、摘要差异立即失败、认证脱敏和路径过滤。
