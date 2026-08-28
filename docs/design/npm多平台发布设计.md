<!-- [Input] Clean-room npm/artifact policies, five-package build/verifier, GitHub workflows, and npm registry checks. -->
<!-- [Output] 定义 restored-source-free 五包拓扑、正式资格、首次 2FA bootstrap 与后续 Trusted Publishing。 -->
<!-- [Pos] 当前公共 npm 发布设计；授权由 checked Dream 回执固定，历史恢复源码永不成为公共输入。 -->
<!-- [Sync] 2026-08-28：记录 0.1.3 opaque 模型能力修复的同 SHA qualification、五包发布和公共 registry 回验。 -->

# Clean-room Runtime 的 npm 多平台发布设计

## 当前结论

仓库根包只是私有编排器，不是 npm 交付物；根 `prepack`/`prepublishOnly` 必须拒绝打包。
唯一允许走向公共 registry 的实现来源是 `src/cleanroom/`。历史
`dist/core-local`、`dist/core-package-local`、恢复源码和它们的衍生 bundle 只保留为本地
研究/回滚证据，不得进入本拓扑。

最终 Dream 真实业务验收和显式公共 npm 授权已固定为 checked、隐私删减的 digest-bound
回执。`runtime/cleanroom-artifact-policy.json` 当前为：

- `productionEligible=true`；
- `publicationAllowed=true`；
- `redistributionAllowed=true`；
- Dream v2 真实业务回执 SHA-256 为 `2e7da1f41a41af3b229b79080085e587cdae39e664d7630ed209592ec8c73d4b`；
- 四个 target qualification 均为 true，且每个资格基础单独记录；
- `runtime/cleanroom-npm-policy.json#publication.npmPublishAllowed=true`。

formal publication 模式禁用旧的 provider-free fixture 注入。每个 tarball 的
`npm-publication-attestation.json` 都绑定同一真实业务回执 digest；prepack 和最终 verifier
任一处发现门、target、entrypoint、fixture、map 或 digest 漂移即失败。

## 五包与平台矩阵

| target | npm 包 | Bun target | native format | 发布资格基础 |
| --- | --- | --- | --- | --- |
| selector | `@glide-the/ink-claude-code-dream` | Node launcher | 按 `platform-arch` 选择 | n/a |
| darwin-arm64 | `@glide-the/ink-claude-code-dream-darwin-arm64` | `bun-darwin-arm64` | Mach-O arm64 | 真实业务 + 本机 native execution |
| darwin-x64 | `@glide-the/ink-claude-code-dream-darwin-x64` | `bun-darwin-x64` | Mach-O x64 | cross-build format + inventory + verifier + reproducibility |
| linux-arm64 | `@glide-the/ink-claude-code-dream-linux-arm64` | `bun-linux-arm64` | ELF arm64 | cross-build format + inventory + verifier + reproducibility |
| linux-x64 | `@glide-the/ink-claude-code-dream-linux-x64` | `bun-linux-x64` | ELF x64 | cross-build format + inventory + verifier + reproducibility |

selector 用四个同版本 `optionalDependencies`，同时暴露 `claude` 和
`ink-claude-code-dream`。Windows 与 Linux musl 没有进入 policy，必须 fail closed。
四个 standalone 由仓库锁定的 Bun `1.4.0` 从同一份 source inventory 交叉编译；native
magic 不冒充相应宿主 live execution；Linux 缺 `bubblewrap`/`rg` 时继续 fail closed。

## 精确包结构

```text
@glide-the/ink-claude-code-dream
  bin/ink-claude-code-dream
  release-manifest.json
  manifest/{artifact-manifest,capabilities,dependency-licenses,sbom.cdx}.json
  runtime-manifest.json
  SHA256SUMS
  LICENSE
  THIRD_PARTY_NOTICES.txt
  npm-publication-attestation.json

@glide-the/ink-claude-code-dream-<target>
  runtime/bin/ink-claude-code-dream
  runtime/release-manifest.json
  runtime/manifest/{artifact-manifest,capabilities,dependency-licenses,sbom.cdx}.json
  runtime-manifest.json
  SHA256SUMS
  LICENSE
  THIRD_PARTY_NOTICES.txt
  npm-publication-attestation.json
```

`runtime/cleanroom-npm-policy.json` 列出每个允许文件。verifier 解压最终 tgz 后重新检查
exact inventory、MIT license、CycloneDX 1.5 的 22 个锁定组件、逐许可证文本摘要、native
magic、os/cpu、Dream release/capability/artifact binding、可执行位、单包与五包聚合 checksum。
所有层级拒绝 `.map`、恢复源码标记、历史 core、transcript、Workspace、session、credential
和 OAuth token。

## 构建、dry-run 与安装

```sh
bun install --frozen-lockfile
npm run lint
npm test
npm run cleanroom:build:targets
npm run cleanroom:npm:package
npm run cleanroom:npm:verify
```

默认命令现在生成正式回执绑定的 tgz；设置旧 `INK_CLEANROOM_QUALIFICATION_FIXTURE` 不得在
formal 模式加入 fixture 字段。五个 stage 分别执行不带 `--ignore-scripts` 的
`npm pack --dry-run --json`，prepack 必须成功。离线安装 meta 加当前 host 平台 tgz 后，两个
alias 都必须输出 `2.1.241 (Claude Code)`，Dream 的真实 Python resolver 还必须解析到
selector 的 `release-manifest.json`。

## 发布门与 GitHub Actions

`.github/workflows/ci.yml` 在 pull request 和 main push 上运行 lint、全量 provider-free 测试、
干净四目标/正式五包验证，以及 source-map/恢复实现扫描。它没有 OIDC 权限。

`.github/workflows/qualify-npm-runtime.yml` 只能手工在 `main` 启动，并在构建前要求 checked
policy 同时满足：Dream 真实业务回执文件与 checked SHA-256 完全一致、四个 target 都为 true、三个
artifact gate 都为 true、`npmPublishAllowed=true`。它只上传精确五包和聚合 checksum，不发布。

`.github/workflows/publish-npm.yml` 再校验 qualification run 来自同仓库、指定 workflow、同一
main commit 且成功，下载后重新执行 clean-room verifier。只有 publish job 具有
`id-token: write`，并绑定 GitHub `npm` Environment；顺序固定为四个平台包后 selector，命令
使用 `--access public --provenance`。

正常路径优先使用 Trusted Publisher。若 npm 侧信任关系尚未配置，允许在手工 dispatch 时显式
选择 `npm_access_token_configured=true`，并只从 GitHub `npm` Environment 的 `NPM_TOKEN`
secret 注入短期、最小包范围的 Granular Access Token。workflow 会先执行 `npm whoami` fail closed；
token 不进入仓库、artifact、command 参数或日志。该回退不用于 npm 账户治理操作，并应在 Trusted
Publisher 验证成功后删除或轮换。

当前 GitHub 源仓库为 private，npm registry 不接受由该仓库生成的 Sigstore provenance bundle。
因此仅在 `npm_access_token_configured=true` 时设置 `NPM_CONFIG_PROVENANCE=false`，并在实际
`npm publish` 命令增加 CLI 最高优先级的 `--provenance=false`。qualified tarball 仍保留
`publishConfig.provenance=true`，不会为 token 回退修改或重打包；same-SHA qualification、五包
SHA-256、release manifest、SBOM 和 registry integrity 验证保持不变。OIDC 路径不覆盖 npm 的
provenance 行为。

npm CLI 会在 GitHub `id-token: write` 存在时优先选择 OIDC，早于传统 token。token 回退模式还必须
在同一个 publish shell 内 `unset ACTIONS_ID_TOKEN_REQUEST_URL ACTIONS_ID_TOKEN_REQUEST_TOKEN`，
否则即使 `NPM_TOKEN` 的 `npm whoami` 成功，npm 仍会尝试为 private repository 生成 provenance 并
返回 422。仅设置 `NPM_CONFIG_PROVENANCE=false` 也不足以覆盖 tarball 内的
`publishConfig.provenance=true`，所以必须同时使用上述 CLI flag。该处理只由显式 token 输入触发，
Trusted Publisher 路径继续保留 OIDC carrier 与 provenance。

外层 Dream 真实业务验收与用户显式授权已经通过；回执不包含账户标识、原始业务日志、数据库行、
OAuth 凭据、callback 或 transcript。首次名称 bootstrap 必须从通过 main 同 SHA qualification
的五个 tarball 发布，四个平台包逐个发布并从 registry 可见后才允许 selector。五个名称存在后，
为后续版本配置 Trusted Publisher，再使用同 SHA 的 `publish-npm.yml` OIDC 路径。

## npm registry 发布结果

`0.1.3` 已由 main commit `9339c9a0ff60e1b2cd6d5a23c8e795aeffff91f9` 完成同 SHA
qualification 和正式发布：qualification run `33157330350`、publish run `33157476036` 均为
`success`。发布复用了 qualification artifact，先发布四个平台包再发布 selector；GitHub `npm`
Environment 的最小五包权限 `NPM_TOKEN` fallback 验证成功并按用户要求继续保留。

公共 registry provider-free acceptance exit 0：五包均为 `0.1.3`，空目录只安装 selector 与
darwin-arm64 平台包，两个 alias 输出 `2.1.241 (Claude Code)`；SDK wheel/sdist 两路均通过，
`modelInvoked=false`、模型凭证和 registry token 均未透传。Dream 默认 resolver 与启动日志确认
production manifest 为 `0.1.3`，平台包 source tree/native executable 与真实业务 v2 回执一致。

`0.1.2` 已由 main commit `c3e4d4e2f74960c75b42b1cd48adedf90345a10b` 完成同 SHA
qualification 和正式发布：qualification run `33149053281`、publish run `33151128000` 均为
`success`。publish job 从 qualification artifact 下载并复验精确五包，按四个平台包优先、selector
最后的顺序发布，没有重新构建制品。

公共 registry 已匿名回下载五个 `0.1.2` 包；Dream 的 provider-free registry acceptance 在空目录
安装 selector 与当前 darwin-arm64 平台包，两个 SDK wheel/sdist 环境均得到
`2.1.241 (Claude Code)`，manifest 配对 SDK `0.2.144`，无 official SDK 分发包、无模型调用、无
provider 或 registry token 环境透传。Trusted Publisher 尚未配置，显式 token fallback 使用只包含
五个 Runtime 包读写权、无 organization 权限的 granular token；GitHub `npm` Environment 的
`NPM_TOKEN` 与 npm token 按用户要求保留，当前到期日为 2026-11-26。

2026-08-24 的首次发布结果：

- main commit `c4fb8df1de43d756c3bde90523cc589c8f66e837` 的 qualification run
  `32726262238` 全绿并产出精确五包；
- 账号 `glide-the` 通过 `auth-and-writes` WebAuthn 完成首次 bootstrap；
- 四个平台包按 darwin-arm64、darwin-x64、linux-arm64、linux-x64 顺序全部 `PUT 200`，
  visibility 均为 public；selector 最后 `PUT 200`；
- 五个 `npm view @glide-the/*@0.1.0` 均返回版本 `0.1.0`、MIT 与公共 tarball，registry
  integrity 与 qualification tgz 逐包一致；
- 无用户 npm 凭据、空 cache/空目录的 Node `24.13.0` 安装、两个 alias、no-map、attestation
  digest 和 Dream resolver 全部通过。

个人 scope 与账号同名，不存在另一条 organization 授权链。首次 bootstrap 因本机没有 OIDC
provider 显式关闭自动 provenance，并由 npm WebAuthn 批准；这不改变包内 receipt/SBOM/checksum。
后续版本需为五包逐个配置 repository `glide-the/ink-claude-code-dream`、workflow
`publish-npm.yml`、environment `npm` 的 Trusted Publisher；配置完成前 workflow 的
`trusted_publishers_configured` 必须保持 false。

## 回滚

npm 版本不可覆盖。出现平台问题时停止 selector 新版本、deprecate 问题版本，并让 Dream
的绝对 `CLAUDE_CODE_CLI_PATH` 指回已验证官方 CLI。常规回滚不 unpublish，不修改 Dream
状态机、数据库、transcript 或 Workspace。

精确版本、13 项能力、当前 tgz digest、内存与命令证据见
[`cleanroom-runtime-verification.md`](./cleanroom-runtime-verification.md)。
