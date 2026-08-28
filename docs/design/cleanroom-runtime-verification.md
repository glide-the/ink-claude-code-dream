<!-- [Input] Clean-room policies, source/build manifests, provider-free tests, five npm tarballs, and host measurements. -->
<!-- [Output] 给出版本/能力矩阵、真实业务回执边界、内存观测、正式制品摘要和 registry 发布证据。 -->
<!-- [Pos] Clean-room Runtime 的 digest-bound 技术、发布资格与 registry 回下载记录。 -->
<!-- [Sync] 2026-08-28：记录 0.1.2 请求参数修复、Dream 真实链路回执、main qualification、五包发布与公共 registry 回验。 -->

# Clean-room Runtime 技术验证

## 结论边界

仓库自有 `src/cleanroom/`、兼容许可证依赖和四个平台制品已通过 provider-free 技术合同。
Dream 本轮验收使用既有真实账户和业务数据，经 Dream、Admin、Gateway、本机真实
PostgreSQL 的公开生产入口完成同一普通 Thread 的两轮对话。Gateway 的正文无关投影记录两次
成功请求均为 `max_tokens=32000`、配置的 `effort=low`、`stream=true` 且 Authorization 已脱敏；
Admin 正常页面确认请求与账本可见。回执经隐私删减后固定在
`runtime/attestations/dream-real-business-acceptance-0.1.2.json`，SHA-256 为
`16a4782a8829c11a9cf899e2b021e40de8eb02f8aa23317f7b6bf492809051fc`。此前 `0.1.1`
的 MCP/OAuth/Server 与 resume 回执继续作为未改变能力的历史证据。

因此三个 artifact gate 和 `npmPublishAllowed` 均已显式置为 true，正式 package prepack 通过。
darwin-arm64 是真实宿主业务与 native execution 资格；darwin-x64、linux-arm64、linux-x64 的
true 表示 cross-build native format、精确 inventory、verifier 与复现性资格，不虚构为相应宿主
上的 live execution。npm registry 回下载证据现已补齐。

## 版本与协议矩阵

| 层 | 固定版本/合同 | 权威来源 | 当前验证 |
| --- | --- | --- | --- |
| clean-room npm Runtime | `0.1.2`，MIT | `runtime/cleanroom-{artifact,npm}-policy.json` | 五包身份一致 |
| Claude Code 兼容输出 | `2.1.241 (Claude Code)` | `src/cleanroom/cli.ts`、package tests | host native 与两个 selector alias 通过 |
| Dream Agent SDK | `ink-claude-dream-agent-sdk==0.2.144` | release manifest integration | `ClaudeAgentOptions.cli_path` resolver 通过 |
| SDK 进程协议 | `claude-code-stream-json/v1` | release manifest、`protocol.ts` | initialize/control/SSE/tool/result/interrupt 通过 |
| clean-room 编译器 | Bun `1.4.0` | npm policy、四份 build manifest | 四 target exact pin 通过 |
| 根仓库编排器 | Bun `1.2.20` | `packageManager` | frozen install 与 legacy comparator build 通过 |
| selector Node | `>=22 <25`；CI 固定 `24.13.0` | generated package、workflow | 本机工具为 Node `26.4.0`，不作为 selector 支持证据 |
| Anthropic Messages SDK | `@anthropic-ai/sdk@0.74.0`，MIT | lockfile、license policy/SBOM | identity/license/hash evidence 通过 |
| MCP SDK | `@modelcontextprotocol/sdk@1.30.0`，MIT | lockfile、license policy/SBOM | stdio/HTTP/resources/OAuth contracts 通过 |
| production sandbox | `@anthropic-ai/sandbox-runtime@0.0.73`，Apache-2.0 | sandbox policy/SBOM | macOS arm64 `sandbox-exec` 真实执行；其他目标以 native-format/前置条件 fail-closed 资格发布 |
| 平台 | darwin/linux × arm64/x64；Windows/musl 不支持 | npm policy | 四种 native magic 通过 |

## 13 项能力矩阵

状态“技术通过”表示至少一个进程级 provider-free 测试通过，并被五包
`manifest/capabilities.json` 精确列出；发布授权另由 digest-bound 真实业务回执决定。

| 能力 | 主要实现 | 主要证据 | 状态 |
| --- | --- | --- | --- |
| `extensions.plugins` | `extensions/skills.ts` | `cleanroom-session-extensions`、`cleanroom-runtime-integration` | 技术通过 |
| `lifecycle.cancel` | `protocol.ts`、sandbox process adapter | `cleanroom-protocol`、`cleanroom-tools-sandbox` | 技术通过 |
| `mcp.http` | `mcp/registry.ts` | `cleanroom-mcp`、`cleanroom-tool-loop` | 技术通过 |
| `mcp.management.identity` | `mcp/management-cli/` | `cleanroom-mcp-management-cli`、runtime integration | 技术通过 |
| `mcp.oauth` | `mcp/oauth/` | `cleanroom-mcp-oauth`、management/tool-loop | 技术通过 |
| `mcp.stdio` | `mcp/registry.ts` | `cleanroom-mcp`、runtime integration | 技术通过 |
| `protocol.control.bidirectional` | `protocol.ts` | `cleanroom-protocol`、permission control test | 技术通过 |
| `protocol.streaming` | `protocol.ts` | `cleanroom-protocol`、`cleanroom-tool-loop` | 技术通过 |
| `sandbox` | `sandbox/production.ts` | `cleanroom-production-sandbox` | macOS arm64 真实执行；其他目标缺前置条件时 fail closed |
| `session.resume` | `session/store.ts` | `cleanroom-session-extensions`、runtime integration | 技术通过 |
| `tmpdir.thread-local` | `session/paths.ts` | session/integration/production-sandbox tests | 技术通过 |
| `transcript.jsonl` | `session/store.ts` | session extensions、fresh/resume/fork integration | 技术通过 |
| `workspace.cwd` | `tools/workspace.ts`、production sandbox | tools/sandbox/integration tests | 技术通过 |

## 源与制品证据

干净构建从空的 `dist/cleanroom-targets` 与 `dist/cleanroom-npm` 开始。四份 build manifest
记录同一份 source inventory：48 个文件、290,209 字节，source-tree SHA-256
`6e36ce5c67f05d7e752a117bfb3ed097dc9611c4a0aa0b3c5f675f9ea984a090`，lockfile SHA-256
`a934ea1ebc506af2edead95cee392717f1560983ea55fc7c97894deb90db3b55`。

| target/package | executable bytes / format | executable SHA-256 | tgz bytes | tgz SHA-256 |
| --- | ---: | --- | ---: | --- |
| selector | Node launcher | `df77ddf569a7f035e868716360d8ee94874c73fbf67a84a60f681224a1aa7d30` | 18,357 | `a8301b7202ddfb9c6a2d0bee7bdfd9574092cf036ff472f7d9f005807fd4ed17` |
| darwin-arm64 | 64,901,234 / Mach-O arm64 | `44eb30d48c27641092a23aeaa96e9bba706cf39cf5fd50cef93729df3d3fef54` | 26,196,496 | `fc8b751f6b15fd22b400d83c1c060fce8aa033ad3a81ced17c6b35950d5543f4` |
| darwin-x64 | 71,687,584 / Mach-O x64 | `7cca5a5d6a5eb46d42556a33666b19287e8790136c6d5bd6e060640e1c109104` | 28,755,509 | `6709605d041f9623fc88d1a13ee450c153b9d13b7c03efdfa0bc415a75257769` |
| linux-arm64 | 83,478,520 / ELF arm64 | `54c1d1a606a9cef78e538e292e367c6a1f414f6ee0b4bba6f2dc07b28ac7cf04` | 36,878,319 | `2e24e323bdace7ecff5cdeb29f6f5b8e78ebeda56951bb94ea7a81b8d993c559` |
| linux-x64 | 83,522,760 / ELF x64 | `4026dfa9092eeb6f808cc9357ea8ccb03b200a1d6656a4f97884abd689d3e2f7` | 36,883,730 | `f21ac90cc6ec3665300f843f50e3c330be99805d6ed809730937d864d20bac76` |

表中的 tgz 是发布前本机最终候选，不含 fixture 字段。main commit
`c3e4d4e2f74960c75b42b1cd48adedf90345a10b` 的 qualification run `33149053281` 重新生成、验证并
上传同 SHA 精确五包；publish run `33151128000` 下载 qualification artifact、再次验证并发布，两个
workflow 均为 `success`。五个 generated prepack
均要求三个 artifact gate、目标资格、回执 digest 和 npm 授权精确为 true。Dream 实际验收使用
回执内固定的前一候选 tgz；其 source tree 与四个 executable digest 与正式候选一致，正式 tgz
仅因加入开放门和回执 attestation 而改变摘要。两次完整四目标编译与该五包打包后，四个 executable SHA 文件和聚合
`SHA256SUMS` 均由 `cmp` 判定逐字节相同。每个 tgz 都包含 CycloneDX 1.5 SBOM、22 个锁定
第三方组件、MIT 根许可证、逐依赖许可证文本摘要和 `THIRD_PARTY_NOTICES.txt`；verifier
同时检查 exact inventory、native magic、Dream manifest、capability、checksum 和可执行位。

`src/cleanroom/` 对 `restored-src`、`core-package-local`、`claude-code-sourcemap` 和
`LicenseRef-Anthropic-All-Rights-Reserved` 的扫描为零命中；Git inventory 没有顶层
`restored-src/` 或 `vendor/`。tarball verifier 还对禁止路径段和禁止字节模式逐文件扫描。
这证明当前构建没有恢复实现输入；它不否认仓库还保留不进入该编译图的历史本地研究脚本。

## 内存观测

观测主机为 macOS `15.7.4` / Darwin `24.6.0` / Apple arm64，直接执行上述 digest 的
darwin-arm64 standalone，不包含 selector Node 进程。`/usr/bin/time -l` 连续五次观测：

| 场景 | 样本 | 最大 RSS 中位数 | 样本范围 | 语义 |
| --- | ---: | ---: | ---: | --- |
| `--version` | 5 | 47,267,840 B（45.08 MiB） | 47,218,688–47,513,600 B | Bun standalone 启动与版本输出 |
| provider-free initialize 后 EOF | 5 | 52,920,320 B（50.47 MiB） | 52,690,944–53,051,392 B | 精确 cwd/tmpdir/config，输出 control success + system init 两帧 |

这些数字是当前主机观测，不是跨平台阈值，也不代表 Provider streaming、MCP 子进程、
大型 tool output 或长会话峰值。发布门不能用这组观测替代目标宿主容量测试。

## 测试与剩余门

本轮技术验证命令及结果：

- `bun install --frozen-lockfile`：exit 0，160 installs / 219 packages，无变更；
- `npm run lint`：exit 0；
- `npm test`：exit 0，94 tests，92 passed，2 个显式 official OAuth fixture 测试 skipped；
- permission focused regression：exit 0，8/8；显式 PreToolUse allow 不再产生第二个 `can_use_tool`，无 decision 才产生，deny 不执行工具；
- OAuth focused regression：OAuth registry 6/6、management + OAuth 9/9；过期投影 access token 能刷新，旋转后的 refresh token 跨两个 Runtime 进程继续可用；不可恢复的 `invalid_grant` 删除旧投影并进入 `needs-auth`；超时后的迟到 discovery 不得重建凭据文件；
- `npm run cleanroom:build:targets`：exit 0，Bun 1.4.0 四目标；
- `npm run cleanroom:npm:package`：exit 0，正式五包与回执 attestation；
- `npm run cleanroom:npm:verify`：exit 0，五包/SBOM/license/checksum/no-map 通过；
- 两轮 executable/tarball `cmp`：exit 0；
- `find dist/cleanroom-targets dist/cleanroom-npm -name '*.map'`：零输出。

`0.1.0` 发布后回执：四个平台包先完成 `PUT 200`，并分别由 npm visibility API 确认为 public；selector
随后完成 `PUT 200`。五个公共 packument 均返回 `0.1.0`、MIT 和 tarball URL，其 SHA-512
integrity 与 qualification tgz 逐包一致。使用 Node `24.13.0`、npm `11.6.2`、空安装目录、
全新 cache 且 `npm_config_userconfig=/dev/null` 的匿名 registry 安装 exit 0，只安装 selector 与
darwin-arm64 可选包；`claude --version` 和 `ink-claude-code-dream --version` 均输出
`2.1.241 (Claude Code)`，安装树零 `.map`，Dream 真实 Python resolver 成功解析 selector 的
`release-manifest.json`。版本不可覆盖，后续版本需配置五包 Trusted Publisher。

`0.1.2` 已在同一 main SHA 的 qualification 成功后，使用显式最小权限 token fallback 按平台包
优先、selector 最后的固定顺序发布。公共 registry provider-free acceptance exit 0：五包版本均为
`0.1.2`，当前平台 fresh install 的两个 CLI alias 均输出 `2.1.241 (Claude Code)`，manifest 配对
SDK `0.2.144`；SDK wheel/sdist 两条隔离安装路径均通过，`modelInvoked=false`、
`modelProviderCredentialEnvironmentForwarded=false`、`packageRegistryTokenEnvironmentForwarded=false`。

公共 registry 下载摘要：selector `0d6ed5371614b478b57fe192ff5555537279d790ae552818cd4b0b307e24ddc3`；
darwin-arm64 `2c39bf8146ebcc65f3f1ecb55d969b722ad9779473398d41c784cb88caa8eeb2`；
darwin-x64 `7050576a5b809e6662bc791138efb28a04fa56d053d220cfb892034b4b36f8e9`；
linux-arm64 `abc209eccd9ace4ad20050db9f04d587959560e48fc3373f5b478288c5f80da2`；
linux-x64 `0af763146bf0f5656baa552445e8953de18cec7650938a5060d1d6cd62bdd53b`。
