<!-- [Input] Independently reviewed compact-image design, unchanged original source inventory and new-version release gates. -->
<!-- [Output] Runtime 0.1.12 candidate qualification, publication and Dream adoption receipts. -->
<!-- [Pos] Current compact-image release record; older immutable release records remain history. -->
<!-- [Sync] 2026-10-11: candidate implemented; validation, publication and real recovery remain pending. -->

# Runtime 0.1.12 图片历史摘要兼容

## 背景与问题、目标与边界

真实图片成功后后续消息超限，原compact遗漏assistant内置图片、当前素材绑定与可见完成反馈。独立实际稿复核关闭两项P2及摘要计费措辞后实施。仅通过既有compat纯函数与三个原文件精确SHA构建变换，保留原src/provenance、历史/文件/receipt/账本、boundary parent、取消/恢复/SSE与权限；不提高Gateway限制。原SDK0.2.145、CLI2.1.241及原生依赖映射不变。

## 概念与规则

历史摘要副本用保留真实调用身份的text代替原生图片协议块。local compact复用已创建userMessage的当前素材，经immutable context副本供同一summaryRequest使用，fallback清理历史后追加当前摘要请求，Gateway原绑定校验保持。原QueryEngine落盘成功后仅实际compact_boundary加非空stdout使用原assistant输出原语，失败/取消/普通空success不产生成功反馈。摘要是新的文字模型请求，正常Token结算；不重放旧图片。

[正式设计](../design/single-source-release-and-dream-adoption.md)与[Dream专项记录](/Users/dmeck/project/ink-dream-memory/docs/exec/image-model-call-division-20261010.md)区分源码、技术fixture、四平台资格、生产发布、正常采用和真实账户验收。

## 当前门禁

| 阶段 | 状态 |
|---|---|
| 五包候选版本前检 | 全部latest0.1.11，0.1.12不存在；registry只读命令exit0 |
| 实际稿独立评审 | 两项P2和计费措辞已关闭，无剩余P1/P2 |
| Source-bound实现 | 已实现，未验证；原src禁止修改 |
| 本机技术资格、实际CLI compact | 待执行，不复用旧字节回执 |
| 同源四平台CI、五包发布 | 待执行 |
| 精确公开制品/正常Dream采用 | 待执行 |
| 原账户同会话完整业务重验 | 待执行，五项图片的前轮成功不代表新Runtime验收 |

源码复审新增一项P2：SessionMemory旧stdout导致唯一性误判，已改为原push前按历史UUID排除旧boundary/stdout；原落盘后投影规则保持，新增新旧并存及仅旧输出回归。新资格待执行。
