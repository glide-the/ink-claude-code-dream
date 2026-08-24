<!-- [Input] Clean-room policies, source/build manifests, provider-free tests, five npm tarballs, and host measurements. -->
<!-- [Output] 给出版本/能力矩阵、真实业务回执边界、内存观测、正式制品摘要和发布前命令证据。 -->
<!-- [Pos] Clean-room Runtime 的 digest-bound 技术与发布资格记录；registry 回下载仍是发布后证据。 -->
<!-- [Sync] 2026-08-24：绑定最终 Dream 真实业务回执并记录开放发布门后的正式五包摘要。 -->

# Clean-room Runtime 技术验证

## 结论边界

仓库自有 `src/cleanroom/`、兼容许可证依赖和四个平台制品已通过 provider-free 技术合同。
Dream 最终验收又使用既有真实账户和业务数据，经 Dream、Admin、Gateway、本机真实
PostgreSQL 的公开生产入口完成两轮同 Thread 对话、refresh/resume、Comfy 浏览器 OAuth、
两次 `get_server_info`、tool confirmation、`output-available`、logout/remove；回执经隐私删减后
固定在 `runtime/attestations/dream-real-business-acceptance-0.1.0.json`，SHA-256 为
`ce3b2db654acf1fb2c3d8d1060eb2afce9dc14c0ee391fbb45697d0b4b52ac16`。

因此三个 artifact gate 和 `npmPublishAllowed` 均已显式置为 true，正式 package prepack 通过。
darwin-arm64 是真实宿主业务与 native execution 资格；darwin-x64、linux-arm64、linux-x64 的
true 表示 cross-build native format、精确 inventory、verifier 与复现性资格，不虚构为相应宿主
上的 live execution。npm registry 回下载是发布后证据，必须在首次发布后补齐。

## 版本与协议矩阵

| 层 | 固定版本/合同 | 权威来源 | 当前验证 |
| --- | --- | --- | --- |
| clean-room npm Runtime | `0.1.0`，MIT | `runtime/cleanroom-{artifact,npm}-policy.json` | 五包身份一致 |
| Claude Code 兼容输出 | `2.1.241 (Claude Code)` | `src/cleanroom/cli.ts`、package tests | host native 与两个 selector alias 通过 |
| Dream Agent SDK | `ink-claude-dream-agent-sdk==0.2.143` | release manifest integration | `ClaudeAgentOptions.cli_path` resolver 通过 |
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
记录同一份 source inventory：47 个文件、250,859 字节，source-tree SHA-256
`2e5f2059db618ae499fee12346d53f13bf0f1460ed600bae602c75b1c60a66ec`，lockfile SHA-256
`a934ea1ebc506af2edead95cee392717f1560983ea55fc7c97894deb90db3b55`。

| target/package | executable bytes / format | executable SHA-256 | tgz bytes | tgz SHA-256 |
| --- | ---: | --- | ---: | --- |
| selector | Node launcher | `df77ddf569a7f035e868716360d8ee94874c73fbf67a84a60f681224a1aa7d30` | 18,362 | `72a29df28f5a6515f5a86fd4cbc080c22b70a58d915382c3e20539ffb49b58e9` |
| darwin-arm64 | 64,868,210 / Mach-O arm64 | `04372c5b48d0e49cb2a908401dfb7bd0b8b7cb18e030f2ca4bfeb9949d0d22be` | 26,190,521 | `0409827b14b8ac5c728694c7db3e6ec9d6d1a425e6ef80a98579f3a709eb8faf` |
| darwin-x64 | 71,654,816 / Mach-O x64 | `9a9a86c053ab97944550792efc90b76a0161c1b98bb624be9e7d7e140bd9a6ee` | 28,749,371 | `33d696c4f0d6666c36c46c158253a9b945b796f4e185e1436c21b467193500a1` |
| linux-arm64 | 83,412,984 / ELF arm64 | `c876c14f0d4803af6132ab5a37414a97467ea60e106a3b80b88338e100544884` | 36,871,439 | `b6ed4fbf6087efacb72af2170e03f7ac8a5e83a2deaa637b1df0f6cec1cb8dc9` |
| linux-x64 | 83,498,184 / ELF x64 | `3d90ec6af53a753fa2c49bb740451243fd79dd37edd198181e90b8ca260426fd` | 36,877,788 | `d400b2e5ce05c7dacfa238f29834a6530f5e59a27d5feb115b3e12936de55f82` |

表中的 tgz 是绑定最终回执 digest 的正式发布候选，不含 fixture 字段；五个 generated prepack
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

发布前证据已齐并得到显式公共 npm 授权。发布顺序固定为四个平台包逐一成功并可从 registry
读取后，再发布 selector；版本不可覆盖。首次 bootstrap 使用账号 2FA 和同一 main commit 的
qualification 制品，随后为五包配置 Trusted Publisher。发布后必须从 registry 全新安装、执行
两个 alias、核对 manifest/attestation/no-map，并调用 Dream 的真实 resolver；该结果是唯一剩余的
`postPublicationEvidence`。
