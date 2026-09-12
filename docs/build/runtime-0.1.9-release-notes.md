<!-- [Input] Unique original source verification, real SDK/MCP/OAuth qualifications and candidate package receipt. -->
<!-- [Output] Separate completed local packaging from pending four-host npm release and Dream adoption. -->
<!-- [Pos] Current 0.1.9 release status; historical receipts remain immutable. -->
<!-- [Sync] 2026-09-13: delete the redundant restored-src tree and restore real GitHub CI publishing. -->

# Runtime 0.1.9

唯一实现为 `src`，原始 1,902 文件/35 模块/30,382,832 字节保持不变。
重复 `restored-src` 的 1,905 个 tracked 文件已删除，可从 `a40037a` 恢复；
来源信息保存在 `runtime/source-provenance.json`。只读 `npm run source:verify`
检查文件、模式、内容和完整目录摘要，不再同步或复制双树。

已验证：Node 24.13.0/Bun 1.4.0，原始源构建零缺口、DCE passed；52 项
MCP 兼容检查无跳过；官方 2.1.241 与候选的 SDK、stdio/HTTP MCP differential
通过；实际 Dream MCP 管理 driver 的隔离身份/colon lifecycle/脱敏通过；精确
官方 MCP SDK v2.0.0 示例的 OAuth pipe/PTY 合同通过。

Darwin ARM64 candidate 两次材料化完全一致，共 63 个文件，qualified local-core
artifact tree SHA-256 为 `cf28677c948855bc372881fdd4f1791fa5b077701318adfb893d10c544a227bc`。
核心入口 SHA-256 为 `c8188a9249574352327ed8fde4b1703c9b389cc1a83d8d601beb44103bace675`；
源/恢复依赖摘要为 `470ca57d6390e2f9df5e2bb0a6f32b8b62c64f262ae3d02a31349488a08c228e`。
这是隔离技术合同验证，不是使用真实账户/模型的业务验收。

用户明确确认已有来源授权并要求公开 npm/GitHub CI，记录为操作方声明，
不是独立法律核验或 MIT 改授权。原始版权声明随 checksummed 制品保留。

CI 已由失败占位流程改为 main 上四原生 host 构建、fresh process qualification、
平台 smoke、选择器聚合，再自动传递同 SHA 的五个 tarball 给发布流程。
发布流程不重建、平台先于选择器，并核对公开 npm sha512；同版本只允许
确认完全相同字节，不覆盖已有版本。公开 npm 和本机 Dream 采用尚未完成。

`compat/dream-runtime` 以完整原文件 sha256 与唯一 marker 在编译内存中补齐
真实 Dream 的 Notion API-token/workers-file 投影、native/PATH/home 门禁、
泛用环境 execa 继承防护、命令 hook/final stdio MCP 凭据隔离，以及 server-owned
max-output/context/五档 effort；六个原始模块的文件字节均未改动。
4 项策略测试（71 assertions）及实际 candidate SDK/MCP 进程检查通过，
观测 native Bash 投影、hook/stdin MCP 无凭据、max_tokens=1000/effort=xhigh。
新的 digest-bound Dream receipt 已纳入 full qualification，六项 gate 全部 exit 0。
Notion capability 只在这些资格满足后标记 qualified；选择器还必须验证四个
平台包的实际 capability/qualification 证据，不能只凭模板声明放行。

实施/交互设计见 [唯一源码与采用方案](../design/single-source-release-and-dream-adoption.md)。
