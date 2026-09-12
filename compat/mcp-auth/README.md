<!-- [Input] MCP headers helper 与 transient reconnect 的兼容需求、恢复源码哈希和官方 changelog。 -->
<!-- [Output] 可执行 source transformer、独立策略模块、证据边界和 artifact 应用条件。 -->
<!-- [Pos] compat/mcp-auth 的审查入口；区分内存 transform 可执行与 artifact 尚未应用。 -->
<!-- [Sync] 2026-08-24: 增加 executable transforms、虚拟模块解析与 headless reachability 合同。 -->
# MCP Auth Compatibility Policies

这是一个仓库自行编写、绑定确切来源摘要的策略与可执行 source transformer 模块；该技术来源说明不构成许可证或再分发结论。它补齐 headers helper 的安全启动环境/cwd/trust，以及 MCP 重连时对认证错误、限流、服务端故障和超时的有界重试；同时为 stdio initialize ordering、disabled inventory、`mcp list/get` 和 print/SDK `setMcpServers` reconcile 提供精确源码断言与 postcondition。

模块不启动 helper、不建立 MCP 连接、不实现 OAuth/DCR/PKCE、不保存 token，也不复制现有 Agent/MCP 状态机。`patch-manifest.json` 固定为 `wired: true`、`applied: false`、`status: wired-build-required`；只有逐项证明 source assertions 和 transform 均已应用的 artifact receipt 才能派生 `applied: true`。

## 使用

```ts
import { buildHeadersHelperLaunchPolicy } from "./src/headers-helper-policy.ts";
import { runWithReconnectRetry } from "./src/reconnect-policy.ts";
import {
  applyMcpCompatibilityTransforms,
  MCP_COMPATIBILITY_VIRTUAL_MODULE_RESOLUTIONS,
} from "./src/patch-spec.ts";
import { buildHeadlessMcpCompatibilityArtifactReceipt } from "./src/artifact-receipt.ts";
import { verifyAuthorizedSourceTargets } from "./src/source-identity.ts";
```

`buildHeadersHelperLaunchPolicy` 采用环境变量 allowlist，不会把调用进程的凭证环境透传给 helper。`project/local` 要求明确的 trust 回执并使用来源 cwd；`user/managed/claudeai` 固定使用 Claude 配置目录；`dynamic/plugin/enterprise/unknown` fail closed。

`runWithReconnectRetry` 的 `maxAttempts` 表示包含首次调用在内的总尝试次数。401/403 立即失败，429、5xx 和 timeout 可重试；退避参数和 sleep 都可注入，便于核心 Runtime 采用自身策略与测试时钟。

`applyMcpCompatibilityTransforms(path, source, { transformIds })` 先验证整文件 sha256 和所有 original-source exact markers，再按清单顺序执行同路径复合变换并验证 postcondition，返回 `{ contents, appliedIds, assertions }`。它只返回内存文本，不写入恢复源码。生成结果引用 `ink:mcp-auth/*` 稳定虚拟 module ID；构建器可使用 `MCP_COMPATIBILITY_VIRTUAL_MODULE_RESOLUTIONS` 将这些 ID 解析到本目录的三个仓库自有 helper 文件。

artifact reachability 分为两类：headless 只包含 `headersHelper.ts`、`client.ts`、`print.ts`；`useManageMCPConnections.ts` 和 `cli/handlers/mcp.tsx` 是 interactive-only。headless receipt 若声称后二者已应用必须拒绝。`disabled-central-inventory-v1` 是已存在合同的精确断言，不修改源码；其余条目执行 exact-marker replacement。

artifact builder 可把逐路径 transformer `appliedIds` 与 canonical reachable source paths，或 bundle metafile 的 output-level `inputs[].bytesInOutput`，交给 `buildHeadlessMcpCompatibilityArtifactReceipt`。只有三个 required headless source class 均进入产物、全部 headless transform 均已应用且没有 interactive-only 声明时，helper 才返回顶层 `applied: true`；仅存在 declarative spec、metafile 顶层扫描记录或零字节 tree-shaken input 都不成立。

## 验证

```bash
bun test tests
```

默认测试直接读取本仓库 canonical src 原始模块，不假设存在 sibling checkout 或环境选择的另一套 src。52 项测试包含来源哈希、精确断言和实际内存变换：

```bash
bun test tests
```

来源检查拒绝 symlink、验证 containment、计算每个 canonical 原始目标的 sha256 和 exact assertions；随后变换五个实际模块的内存副本，用 Bun parser 检查 TS/TSX、关键顺序和旧 marker。默认不跳过这六项 source tests；任一身份或内容不一致都必须重新审查，不能自动套用。

## 证据边界

`patch-manifest.json` 记录的恢复源码版本是只读目标，不代表官方 Claude Code 对应版本源码。官方 2.1.238/2.1.239 行为依据来自 immutable tag 的 changelog；本目录仅实现这些行为所需的最小策略原语和 source-bound composition points。
