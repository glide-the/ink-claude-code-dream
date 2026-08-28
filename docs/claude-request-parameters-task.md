<!-- [Input] 用户关于 Messages max_tokens/output_config.effort 缺失的原始要求、只读历史任务 ID、CLI 仓库状态与验证回执。 -->
<!-- [Output] 一个限定在 clean-room CLI 内的 Codex 实现任务记录。 -->
<!-- [Pos] 本地任务台账；不授权发布、部署、推送或修改 Dream/Admin/Gateway。 -->
<!-- [Sync] 2026-08-28: 建立请求参数恢复任务并绑定设计、分支、文件所有权和验收命令。 -->

# Claude Messages 请求参数恢复任务

## 原始需求

补回本地 Claude Code 精简版在 Anthropic Messages 最终请求中遗漏或错误实现的 `max_tokens` 与 `output_config.effort`。以 `/Users/dmeck/project/claude-code-sourcemap` 中 `@anthropic-ai/claude-code@2.1.88` 的公开 sourcemap 还原结果作为只读版本/行为线索，并用 Anthropic 当前公开协议交叉确认；不得复制还原源码，不得修改 Dream、Admin、Gateway、状态机、SSE 或生产环境。

## 责任与工作区

- 负责人：Codex Goal `01a046e3-1ccf-7d42-840d-19ef033a91f2`
- CLI 仓库绝对路径：`/Users/dmeck/project/ink-claude-code-dream`
- 当前分支：`codex/claude-request-fields`（从 `main` 创建）
- 当前 CLI 包版本：`ink-claude-code-dream@0.1.2`
- 兼容版本标识：Claude Code `2.1.241`
- 构建入口：`src/cleanroom/cli.ts`，由 Bun `1.4.0` 生成 `dist/cleanroom/claude` 和四平台 npm 候选产物
- 文件所有权：`src/cleanroom/request.ts`、`src/cleanroom/argv.ts`、`src/cleanroom/protocol.ts`、`src/cleanroom/settings/settings.ts`、对应 `.folder.md`、`tests/cleanroom-request-parameters.test.mjs`、`tests/.folder.md`、本任务记录与设计稿

## 只读证据

- 历史任务/日志 ID：
  - `01a03829-ebb2-7721-be04-15bc47780e9b`
  - `01a027e0-df26-7b33-b939-1f44c0928245`
  - `01a0242b-53ef-7752-935a-1d9f6219c033`
  - `01a019c1-fd56-7943-96c9-1370db9a2160`
  - `01a019f0-7487-70a3-b889-a2727faf77b7`
- 上游映射参考：`/Users/dmeck/project/claude-code-sourcemap`，commit `a8a678cb6244e6770e1e421767ff0987a1d95549`，还原包 `@anthropic-ai/claude-code@2.1.88`
- 映射仓库声明：非官方、从公开 npm source map 的 `sourcesContent` 还原、仅供研究，不代表 Anthropic 内部仓库结构
- 对照文件：`restored-src/src/utils/context.ts`、`restored-src/src/utils/effort.ts`、`restored-src/src/services/api/claude.ts`、`restored-src/src/main.tsx`
- 当前官方发行交叉检查：`@anthropic-ai/claude-code@2.1.250`，仅以本地 provider-free 传输拦截和官方公开 API 文档核验行为

历史 ID 对应的本地 Codex rollout 仅能证明当时任务上下文中的 effort 选择，不能单独证明 Claude Messages HTTP body；不得把其中正文或凭证复制到测试/文档。最终 wire 证据必须来自本 CLI 的本地 transport fixture。

## 状态

- 当前状态：实现、provider-free 自动化测试和 Dream 真实链路预验收完成；正在执行主分支合并与 0.1.2 发布
- 设计稿：`docs/design/claude-request-parameter-recovery.md`
- 已确认根因：精简 CLI 的参数解析器识别但丢弃 `--effort`，settings 类型不读取 `effortLevel`，协议层没有 `output_config`；`max_tokens` 则使用错误的旧变量 `ANTHROPIC_MAX_TOKENS` 和固定 `4096` fallback，而不是模型能力加 `CLAUDE_CODE_MAX_OUTPUT_TOKENS` 的有界策略
- 最新版对照：官方 `2.1.250` 的 provider-free 最终 HTTP 拦截确认未知模型 32,000、Opus 4.6 为 64,000/128,000、当前高输出模型族默认 64,000、`xhigh` 的模型降级、settings 持久化范围和 env 优先级。本地实现遵循用户要求，在没有显式 effort 时省略字段，不采用官方模型默认 effort 注入。
- 阻断项：无。仓库没有独立 TypeScript typecheck script；本任务对新增/修改的参数解析模块执行了 TypeScript 5.9.2 strict semantic typecheck，协议接入由 Bun production compile 和最终 HTTP fixture 覆盖。直接临时检查整个 `protocol.ts` 依赖图仍会报告若干任务前已存在的 MCP/sandbox 类型错误，本任务没有越界修改它们。

## 验证计划与结果

所有 provider 测试均指向本地 SSE fixture，不调用真实收费模型。下列结果均来自最终实现。

| 命令 | 预期 | 当前结果 |
| --- | --- | --- |
| `node --test --test-concurrency=1 tests/cleanroom-request-parameters.test.mjs` | 最终 HTTP JSON 覆盖 effort、max tokens、stream、tool follow-up | exit 0；6/6 通过 |
| `node --test --test-concurrency=1 tests/cleanroom-protocol.test.mjs tests/cleanroom-tool-loop.test.mjs tests/cleanroom-runtime-integration.test.mjs` | 相关 CLI 回归 | exit 0；7/7 通过（随后也包含于最终全量） |
| `npx --yes --package typescript@5.9.2 tsc --noEmit --strict --allowImportingTsExtensions ... argv.ts request.ts settings.ts` | 本次参数解析模块 strict typecheck | exit 0 |
| `npm run lint` | 文件头、clean-room、manifest 与敏感材料门禁 | exit 0；218 files / 15 JSON |
| `npm test` | 全量 build 与测试 | exit 0；117 tests，113 通过，4 条外部 fixture 条件跳过，0 失败 |
| `npm run cleanroom:build:targets` | 四平台 production build | exit 0；4/4 target |
| `npm run cleanroom:npm:package` | 最终五包构建/打包合同 | exit 0；0.1.2 的 5/5 package/tarball |
| `npm run cleanroom:npm:verify` | 最终五包格式、digest 与 no-map 验证 | exit 0；0.1.2 的 5/5 verified |
| `git diff --check` | 无补丁格式错误 | exit 0 |

## 回滚

本任务未发布、未部署、未推送、未重启服务。回滚边界是删除新增的请求策略/测试/文档文件并逐项撤销本分支对 `argv.ts`、`protocol.ts`、`settings.ts` 和对应目录说明的变更；不得使用会覆盖其他工作区改动的 destructive git 命令。
