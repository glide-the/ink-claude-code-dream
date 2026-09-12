<!-- [Input] Original source inventory, native CI/npm digests, local Dream adoption and operator-reported business acceptance. -->
<!-- [Output] Current completed 0.1.9 release/adoption status, historical candidate distinction and remaining Docker boundary. -->
<!-- [Pos] Current 0.1.9 release status; historical receipts remain immutable. -->
<!-- [Sync] 2026-09-13: synchronize completed publication/adoption, user acceptance and bounded publisher-only follow-up. -->

# Runtime 0.1.9

唯一实现为 `src`，原始 1,902 文件/35 模块/30,382,832 字节保持不变。
重复 `restored-src` 的 1,905 个 tracked 文件已删除，可从 `a40037a` 恢复；
来源信息保存在 `runtime/source-provenance.json`。只读 `npm run source:verify`
检查文件、模式、内容和完整目录摘要，不再同步或复制双树。

已验证：Node 24.13.0/Bun 1.4.0，原始源构建零缺口、DCE passed；52 项
MCP 兼容检查无跳过；官方 2.1.241 与候选的 SDK、stdio/HTTP MCP differential
通过；实际 Dream MCP 管理 driver 的隔离身份/colon lifecycle/脱敏通过；精确
官方 MCP SDK v2.0.0 示例的 OAuth pipe/PTY 合同通过。

发布前本机 Darwin ARM64 candidate 两次材料化完全一致，共 63 个文件，qualified local-core
artifact tree SHA-256 为 `cf28677c948855bc372881fdd4f1791fa5b077701318adfb893d10c544a227bc`。
核心入口 SHA-256 为 `c8188a9249574352327ed8fde4b1703c9b389cc1a83d8d601beb44103bace675`；
源/恢复依赖摘要为 `470ca57d6390e2f9df5e2bb0a6f32b8b62c64f262ae3d02a31349488a08c228e`。
这是隔离技术合同验证，不是使用真实账户/模型的业务验收。

用户明确确认已有来源授权并要求公开 npm/GitHub CI，记录为操作方声明，
不是独立法律核验或 MIT 改授权。原始版权声明随 checksummed 制品保留。

CI 已由失败占位流程改为 main 上四原生 host 构建、fresh process qualification、
平台 smoke、选择器聚合，再自动传递同 SHA 的五个 tarball 给发布流程。
发布流程不重建、平台先于选择器，并核对公开 npm sha512；同版本只允许
确认完全相同字节，不覆盖已有版本。公开 npm 和本机 Dream 采用均已完成，
证据与后续进程状态见下文；后续文档/发布工具提交不重新绑定已发布制品的来源 SHA。

`compat/dream-runtime` 以完整原文件 sha256 与唯一 marker 在编译内存中补齐
真实 Dream 的 Notion API-token/workers-file 投影、native/PATH/home 门禁、
泛用环境 execa 继承防护、命令 hook/final stdio MCP 凭据隔离，以及 server-owned
max-output/context/五档 effort；六个原始模块的文件字节均未改动。
4 项策略测试（71 assertions）及实际 candidate SDK/MCP 进程检查通过，
观测 native Bash 投影、hook/stdin MCP 无凭据、max_tokens=1000/effort=xhigh。
新的 digest-bound Dream receipt 已纳入 full qualification，六项 gate 全部 exit 0。
Notion capability 只在这些资格满足后标记 qualified；选择器还必须验证四个
平台包的实际 capability/qualification 证据，不能只凭模板声明放行。

## 公开发布与本机 Dream 采用（已完成）

发布来源为 `820be726b5c9011a493bbb14a84a97fe548d58bd`，
[四原生 host 资格与五包聚合](https://github.com/glide-the/ink-claude-code-dream/actions/runs/34710677422)
全部通过；[CI 自动发布](https://github.com/glide-the/ink-claude-code-dream/actions/runs/34711405353)
的 attempt 5 成功。前四次遇到 registry 传播超过原 30 秒窗口，只重试相同
SHA/归档，未重建或覆盖版本。selector 与四个平台包 `0.1.9` 全部公开，
selector `latest=0.1.9`；匿名下载的五个归档与原 CI 字节和 SHA-512 integrity 相等。

| 包（均以 `@glide-the/ink-claude-code-dream` 为前缀） | 公开归档 SHA-256 |
| --- | --- |
| selector | `b8bc59639e269a885d3b9ad781381acbce146da7a194f935d32f33f9ed58ca6a` |
| `-darwin-arm64` | `448b8be16ef9c6e1388b7975d1050286d6c9346444d003a3666476eaa88ed3cc` |
| `-darwin-x64` | `70f27a95c857bc107fc3c456bbc5c65532907f3bf6643562982e38df352824dd` |
| `-linux-arm64` | `465b04f451a2d60e8f1eb90666f1027e42a57a16e7f7c957c9f6d7f72b678bce` |
| `-linux-x64` | `7dfe4be34832fa5da493a25570c82505002ea6e219b310269426f9715c55af64` |

本机正常 PATH 已安装并验证 `0.1.9`，两个 alias 解析到同一 package-root
`cli.js`，实际选中的 Darwin ARM64 payload 与公开 CI 归档一致，14 项 capability
及零 `.map` 均通过。已发布 native core 摘要为
`e680a4d90fcd26a65d1fa820860a37ad5f96fbcb25c79e8f87ad3b706273a3cb`，
不同于上面发布前的本机 candidate 摘要；不能混用两份收据。

Dream backend/frontend 项目版本为 `0.1.3`/`0.0.3`，SDK 保持 `0.2.145`，
CLI 兼容 `2.1.241`，API schema 保持 `2.0.0`。Dream 回归 151 passed / 17 subtests，
另有实际已安装 Runtime 的 native Notion sandbox 合同 1 passed / 0 skipped；
这些均是隔离技术测试。受控本机启动的 health 返回 `ok`/`0.1.3`，启动身份明确
选用 `dream_runtime`/`0.1.9` 和上述 SDK。该任务启动的后端随后按用户要求停止，
本次收尾不重新启动，不把历史 health 写成当前服务仍在运行。

用户于 2026-09-13 明确确认已验证真实用户模型对话及真实 Notion 端到端流程。
这是用户提供的业务验收结果，与自动化/fake provider 回执分别记录；本次不读取或
公开真实正文、凭据和 Notion 内容。Docker daemon 未启动，因此镜像构建仍未验收；
AutoDL 与远程生产环境未操作。详细 Dream 接入记录见
[Dream 当前说明](https://github.com/glide-the/im-dream/blob/develop/docs/deploy/runtime-0.1.9-release-and-local-dream-adoption.md)。

## 发布工具收尾

`publish-qualified-npm.mjs` 的公开元数据查询使用 `--prefer-online`，禁用隐式 fetch
重试。上传被接受后，对真实 E404 每 5 秒重查，包含查询耗时的总等待上限为 5 分钟；
超时报告“尚未可见”，不报告“摘要不一致”。已有版本完全相同则跳过上传；任何
真实摘要差异、非 E404 查询失败或无效元数据均立即停止。失败上传不自动重试，
诊断只保留包/版本、退出码及结构化错误码，不输出 npm 原始正文或环境凭据。

隔离测试注入传输与虚拟时钟，覆盖超过 30 秒的传播、截止时间、不可变摘要、
平台先于 selector、失败阻断及 token/OIDC 隔离；不是合成 Runtime 的资格证明。
文档/folder/publisher-only main 改动仍走常规 CI，但不触发重新生成同版本制品。
资格 workflow 本身和真实构建输入仍受原四平台门禁约束；未修改版本/Runtime 模块，
不重发 `0.1.9`、升级 SDK 或新增部署框架。

首次落地的补丁还修改 qualification workflow 自身，所以该次 main 合并仍会触发
资格任务；交付时仅取消本次精确 merge SHA 的冗余资格 run，常规 CI 保留并等待通过。
已有 `0.1.9` 原始模块、构建变换和制品字节不变，复用上面的四平台资格，不启动
自动发布。后续纯 docs/publisher-only 提交才由路径过滤自动跳过；真正构建输入或
qualification 命令变更仍须重新资格，不使用这一例外绕过门禁。

实施/交互设计见 [唯一源码与采用方案](../design/single-source-release-and-dream-adoption.md)。
