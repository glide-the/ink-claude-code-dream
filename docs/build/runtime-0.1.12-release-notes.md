<!-- [Sync] 2026-10-12: public 0.1.12 adopted; six normal image/Token, settings and 19-image reopen/hash observed; image-inflight cancel remains unverified. -->
<!-- [Input] Independently reviewed compact-image design, unchanged original source inventory and new-version release gates. -->
<!-- [Output] Runtime 0.1.12 completed qualification/publication/adoption and separately scoped business receipts. -->
<!-- [Pos] Current compact-image release record; older immutable release records remain history. -->
<!-- [Sync] 2026-10-11: published exact source and normal Dream adoption verified; earlier candidate records retained below. -->

# Runtime 0.1.12 图片历史摘要兼容

## 背景与问题、目标与边界

> 历史设计起点：以下原文的“三个原文件”是当时范围，后续原命令注册/完成文案修订加入第四个原模块；当前完整事实见末节。原段落保留。

真实图片成功后后续消息超限，原compact遗漏assistant内置图片、当前素材绑定与可见完成反馈。独立实际稿复核关闭两项P2及摘要计费措辞后实施。仅通过既有compat纯函数与三个原文件精确SHA构建变换，保留原src/provenance、历史/文件/receipt/账本、boundary parent、取消/恢复/SSE与权限；不提高Gateway限制。原SDK0.2.145、CLI2.1.241及原生依赖映射不变。

## 概念与规则

历史摘要副本用保留真实调用身份的text代替原生图片协议块。local compact复用已创建userMessage的当前素材，经immutable context副本供同一summaryRequest使用，fallback清理历史后追加当前摘要请求，Gateway原绑定校验保持。原QueryEngine落盘成功后仅实际compact_boundary加非空stdout使用原assistant输出原语，失败/取消/普通空success不产生成功反馈。摘要是新的文字模型请求，正常Token结算；不重放旧图片。

[正式设计](../design/single-source-release-and-dream-adoption.md)与[Dream专项记录](/Users/dmeck/project/ink-dream-memory/docs/exec/image-model-call-division-20261010.md)区分源码、技术fixture、四平台资格、生产发布、正常采用和真实账户验收。

## 当前门禁

表中“历史五包候选版本前检”仅记录发布前事实，后续公开五包和正常采用已完成；最后完整业务门按当前进度单独记载。

| 阶段 | 状态 |
|---|---|
| 历史五包候选版本前检 | 全部latest0.1.11，0.1.12不存在；registry只读命令exit0 |
| 实际稿独立评审 | 两项P2和计费措辞已关闭，无剩余P1/P2 |
| Source-bound实现 | 已实现及技术资格通过；原src禁止修改 |
| 本机技术资格、实际CLI compact | R5/R8新回执exit0，fake loopback技术验证 |
| 同源四平台CI、五包发布 | 38149158758、38149958179均success，SHA826de967 |
| 精确公开制品/正常Dream采用 | 五个public integrity与资格一致；clean host安装、Bun native探针、正常manifest/启动identity通过 |
| 原账户同会话业务回执 | 本轮新五项图片及手动恢复第六图已交付并settled；引用理解/可见compact反馈/文字与工具名讨论控制通过，19图重开、6新图SHA与原设置刷新恢复已观察；图片执行中取消未验收 |

源码复审新增一项P2：SessionMemory旧stdout导致唯一性误判，已改为原push前按历史UUID排除旧boundary/stdout；原落盘后投影规则保持，新增新旧并存及仅旧输出回归。新资格待执行。

> 上段为该P2修订时的历史原文，“新资格待执行”已由38149158758实际完成；原失败记录不改写。

## 原命令注册门

> 历史：命令注册/display发现与候选修订阶段，不代表当前未发布或未采用。

0.1.11 headless 构建未注册原 compact；本候选只恢复原 non-interactive compact，沿原 isEnabled、SDK/slash 与取消路径。现有 session.transcript-resume 图门禁要求原命令两模块，静态 registry 回归不能代替实际 CLI 摘要/boundary 验证。初版 fixture 有 harness 错误，保留失败收据，未计资格通过。

实际CLI测试发现完成文案chalk.dim失败，候选仅源SHA绑定将该行改为同一plain text；SDK原mapper已去ANSI，原命令状态与预算不变。新产物与真实账户仍须验证，外层result success不代替压缩boundary/完成文本。

## 本轮技术资格（2026-10-11）

> 历史：R5/R8本机技术验证完成时快照。以下“尚未执行”的四平台/公开/采用后继门后来已独立完成；SDK完成文字不等于当时Dream页面可见。

最终R5：lint/source:verify/npm test/test:dream-compat/绝对候选Bun build/node verify-core-prune全部exit0。Node合同63项/58通过/5既有skip，Dream7项/124断言；原库存1902文件、40269454cd690c74d129a31699935d6db713f2958aabe4787e01617e1c92a906不变。metafile含原compact index与command，1998inputs/55outputs/88disabled features。

实际CLI+公开SDK0.2.145的最终R8 fixture exit0（隔离技术验证）：7张有效PNG旧历史解码22058939字节；真实cached摘要body29506506→413，原fallback9886→200；actual currentImageMaterials校验与4项409拒绝、0素材通过。观察init compact、真实boundary/原尾UUID、唯一clean Compacted完成文字/同session result、旧图SHA不变、Bash真实非error结果、同session resume及真实slash interrupt取消不产生boundary/完成文字。原cached预算32000/adaptive与fallback20000/disabled保持。fake loopback7请求，不是正常账户验收。

保留初版错误fixture、R3测试切片、R4相对toolchain解析、R4display产品缺口及R5/6/7断言/写入时机/SSE harness失败收据，均不计通过。最终命令/完整退出与safe receipt在Dream专项执行记录引用的round30/compact-luna/r5、actual-r8目录；四平台资格、五包公开同源发布和Dream正常采用尚未执行。

## npm 收据门修订

> 历史：38148412748失败后、38149158758重新资格之前的原始状态。

main 9ecdbb0 基础CI通过；38148412748 Linux资格在 tarball gate 失败：旧6目标固定数量检查遗漏当前10目标。独立实际稿无P1/P2后复用唯一清单逐项校验path/SHA与排序应用路径，未降低任何其他门禁。新提交资格/发布待执行；失败制品未发布，正常Dream仍0.1.11。

## 公开发布与正常采用（2026-10-11）

> 发布与采用过程快照：下文“仍进行中”记录各次观察时的业务进度，最终冻结的已观察项和未验收边界以末节为准。

PR31/32合入当前source SHA `826de9672a4b5540513c2cdfa097e52ff221ebed`。同源四native平台与aggregate资格[38149158758](https://github.com/glide-the/ink-claude-code-dream/actions/runs/38149158758)全部通过；既有受控发布[38149958179](https://github.com/glide-the/ink-claude-code-dream/actions/runs/38149958179)15:20:22UTC完成，四平台先于selector，五个公开integrity与qualified归档完全匹配。没有重新构建、覆盖旧版本或本地候选回退。

本机公开selector clean install、两个alias同launcher、无map、实际core锚点Bun加载sharp0.34.5/libvips1.2.4均exit0。正常global精确0.1.12安装与SDK0.2.145/resolver/CLI2.1.241检查exit0；normal Dream backend由99460受控替换为24109，manifest SHA607b78ed958ab1ebeca31bf46c3de699215f74e289b2d020903af9e045f6cef8，正常Admin75238/前端381/PG75173保持。没有DDL或模型请求用于启动验证。

Luna Dream focused新回执resolver14、Docker3、startup3全部exit0；首次缺PYTHONPATH的harness exit4保留，不计产品缺陷或通过。原账户同Thread真实compact/图片重验仍进行中。


> 以下为五项图片完成时的历史快照，原“当前最终控制/历史重开仍在执行中”保留原文；最终回执在下一节。

当前正常Dream已另外修复原compact完整synthetic完成文字在partial模式下的消费：沿既有text callback/保存路径，无Runtime包字节变化。第二次原会话compact新boundary0d9cfe85-8ba7-4e55-ab1e-858527afa4ca、唯一Compacted可见、原9条native图保持；此前首轮UI反馈缺失仍保留。新native生成/上传编辑/草图编辑和Images生成/编辑五项已全部成功、Normal Admin对应Token流水可见，五次图片capture分别13911、17581、14191、567、2102。原SDK0.2.145与新Runtime0.1.12保持，正常消费采用后Dream59234，其他监听器保持。当前最终控制/历史重开仍在执行中。

## 当前冻结业务回执（2026-10-12）

上述公开、正常采用、第二次可见compact及五项正常图片结果属于已观察事实。引用理解、纯文字与讨论image_gen的控制已通过，未因名称出现触发图片执行；正常Admin可见流水来自既有Dmeck SUPER_ADMIN会话，无新账号、密码重置或cookie注入。普通用户cold context先前登录管理身份被拒绝是过程记录，已不构成本轮最终管理验收阻碍。

主五项Token为13911/17581/14191/567/2102，既有回执`normal-runtime12-usage-readback.json`与`admin-runtime12-visible-token-ledger.json`互相核对；四个新native Responses请求顶层`cached_tokens`均实际报告0，属于已知值。图片引擎缓存分项及完整上游图片USD仍未知，旧三条历史缓存仍缺失；平台Token结算不证明这些未知项已知。unsupported反馈后的用户手动恢复第六图已成功，真实蓝圆PNG SHA为`7e69c6620e44f03b81ee0ba10b660223e9c84734b367c38449113a2db5008750`。实际请求`req_5045b53386d14af39c24f1844f66d233` reserve237545/capture29605/release207940已在原Admin UI可见，结果与文件及账本相符。

`real-runtime12-final-history.json`及`real-runtime12-final-reopen-hashes.json`观察原13+新6=19张全恢复，6张新图逐个重新下载SHA与首次相同，唯一Compacted仍可见、会话idle。`real-runtime12-final-settings.json`观察AI `gpt-6.1-sol`恢复后刷新保持，Image `codex-gpt-image-2`保持。主执行者实际`check-runtime12-final-correlations.py` exit0：27 normal requests/81 ledger，6唯一image execution，冻结选择/source/result/native SHA/Token/可见账本逐项一致。

初次恢复helper因异步历史加载报expected1/received4，失败回执保留；图片实际成功一次，没有重发模型。early-submit Stop曾只断开连接，同turn实际running后Stop成功；普通取消通过，不能据此声明图片执行中取消通过。上述为已冻结的实际业务观察，不声明整体Goal完成或尚未合并的文档PR成功；最终交付状态由[Dream执行记录](/Users/dmeck/project/ink-dream-memory/docs/exec/image-model-call-division-20261010.md)维护。

此次只整理文档，不改变公开制品、源码/政策/包、正常服务或数据库，也不重新发布/资格化同版本。
