<!-- [Input] 用户关于 Messages max_tokens/output_config.effort 缺失的原始要求、只读历史任务 ID、CLI 仓库状态与验证回执。 -->
<!-- [Output] 一个限定在 clean-room CLI 内的 Codex 实现任务记录。 -->
<!-- [Pos] CLI 请求参数修复、发布和 Dream 验收任务台账；不授权修改 Dream/Admin/Gateway 业务语义。 -->
<!-- [Sync] 2026-08-28: 重新打开任务，修复认证目录 max_output_tokens 未到达 opaque Gateway alias 请求的问题。 -->

# Claude Messages 请求参数恢复任务

## 原始需求

补回本地 Claude Code 精简版在 Anthropic Messages 最终请求中遗漏或错误实现的 `max_tokens` 与 `output_config.effort`。以 `/Users/dmeck/project/claude-code-sourcemap` 中 `@anthropic-ai/claude-code@2.1.88` 的公开 sourcemap 还原结果作为只读版本/行为线索，并用 Anthropic 当前公开协议交叉确认；不得复制还原源码，不得修改 Dream、Admin、Gateway、状态机、SSE 或生产环境。

## 责任与工作区

- 负责人：Codex Goal `01a046e3-1ccf-7d42-840d-19ef033a91f2`
- CLI 仓库绝对路径：`/Users/dmeck/project/ink-claude-code-dream`
- 基础实现分支：`codex/claude-request-fields`；已通过 PR #13 合并到 `main`
- opaque capability 跟进分支：`codex/opaque-model-max-output`；Draft PR #15
- 基础 main 合并提交：`c3e4d4e2f74960c75b42b1cd48adedf90345a10b`
- 当前候选 CLI 包版本：`ink-claude-code-dream@0.1.3`
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

- 当前状态：完成。实现已合并，`0.1.2` selector 与四个平台包已公开发布，公共 registry fresh install 和 Dream 真实链路验收均通过
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
| GitHub `Qualify clean-room npm Runtime` | main 同 SHA 全量资格 | run `33149053281`，exit 0；job `98776545177` 通过 |
| GitHub `Publish clean-room npm Runtime` | qualification 制品原样复验并按平台包优先发布 | run `33151128000`，exit 0；validate/publish 均通过 |
| `python3 scripts/verify_claude_registry_release.py --sdk-version 0.2.144 --runtime-version 0.1.2 --expected-cli-version '2.1.241 (Claude Code)'`（Dream 仓库） | 公共 PyPI/npm fresh install，不调用模型 | exit 0；status `passed`、provider-free、5/5 npm 包、wheel/sdist 双路径 |
| `git diff --check` | 无补丁格式错误 | exit 0 |

## 回滚

`0.1.2` 已发布且 npm 版本不可覆盖。代码回滚应以新的前向版本恢复上一条已验证策略，或让 Dream 的显式绝对 `CLAUDE_CODE_CLI_PATH` 指回官方 CLI；不得 unpublish、不得覆盖 Git 历史，也不得改动 Dream 状态机。发布使用的 npm granular token 只拥有五个 Runtime 包的读写权限、无 organization 权限，保存在 GitHub `npm` Environment 的 `NPM_TOKEN`，按用户要求保留；本地明文中转副本已删除。

## 2026-08-28 opaque Gateway alias 跟进

- 触发证据：当前已安装 Runtime 为 `0.1.2`；只读业务记录显示已选 Gateway alias 的 Admin `max_output_tokens` 与最终请求 `max_tokens=32000` 不一致，同时 `effort=low`、`stream=true` 正常。
- 直接原因：Dream 选模已保留完整 `GatewayModel`，但 `claude_code_runtime_env()` 只投影 compact/context；CLI 对无法按名称识别的 alias 按上游 unknown 规则使用 32,000/64,000。
- 最小边界：CLI 新增通用、vendor-scoped、server-owned 模型 max-output capability；Dream 仅负责把 Admin 已有目录字段投影到该 CLI capability 并阻断 ambient/user 覆盖。Admin、Gateway、schema、状态机和 SSE 不变。
- 实现分支/提交：`codex/opaque-model-max-output` / `1175b4e`；Draft PR `#15`。Dream 配对提交为 `glide-the/im@2d803ac`，Draft PR `#35`。
- 当前状态：`0.1.3` 的 exact source/native candidate 已通过正常 Dream/Admin/Gateway/PostgreSQL 两轮真实业务验收，digest-bound v2 回执、四平台构建和五包验证均已通过；等待 main 合并、同 SHA GitHub qualification、npm 发布与公共 registry fresh-install 回验。
- 设计稿：`docs/design/claude-request-parameter-recovery.md` 第 12 节。
- 验证结果：
  - `node --test --test-concurrency=1 tests/cleanroom-request-parameters.test.mjs tests/cleanroom-runtime-integration.test.mjs tests/cleanroom-tool-loop.test.mjs`：exit 0；11/11 passed。
  - strict TypeScript 5.9.2 typecheck（request/argv/settings）：exit 0。
  - `npm run lint`：exit 0；258 files / 15 JSON（包含生成并纳入版本管理的 `0.1.3` release envelope）。
  - `npm test`：exit 0；118 tests，114 passed、4 个外部条件 fixture skipped、0 failed。
  - `INK_REAL_CLAUDE_REQUEST_FIELDS_QA=1 ... playwright test e2e/claude-runtime-request-fields-real.spec.ts`（Dream 仓库）：exit 0；1/1 passed；两条 settled `deepseek-v4-pro` 请求均为 `max_tokens=384000`、`effort=low`、`stream=true`、Authorization=`[REDACTED]`。
  - `runtime/attestations/dream-real-business-acceptance-0.1.3.json`：v2 receipt SHA-256 `2e7da1f41a41af3b229b79080085e587cdae39e664d7630ed209592ec8c73d4b`；绑定 source tree `c8d0a7ec…c87cb9` 与已执行 darwin-arm64 executable `9b109064…9d1d4`。
  - `npm run cleanroom:build:targets && npm run cleanroom:npm:package && npm run cleanroom:npm:verify`：exit 0；4/4 targets、5/5 `0.1.3` packages verified；发布前不得覆盖 registry `0.1.2`。
  - Dream `uv run --with pytest ...`：exit 0；67 passed、17 subtests passed；README 英/中 25 个 heading level 与关键 Runtime 规则一致。
