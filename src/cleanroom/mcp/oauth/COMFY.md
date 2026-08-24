<!-- [Input] Public cloud.comfy.org MCP endpoint and the clean-room token-free probe/headless flow. -->
<!-- [Output] Reproducible discovery evidence and bounded manual authorization instructions. -->
<!-- [Pos] Operator note for Comfy MCP interoperability; it contains no token or user credential. -->
<!-- [Sync] 2026-08-24: record unauthenticated discovery and explicit headless login boundary. -->

# Comfy MCP OAuth 验证

只读探测命令：

```bash
./node_modules/.bin/bun -e 'import { probeUnauthenticatedMcpOAuth } from "./src/cleanroom/mcp/oauth/index.ts"; console.log(JSON.stringify(await probeUnauthenticatedMcpOAuth("https://cloud.comfy.org/mcp"), null, 2))'
```

2026-08-24 的无凭据回执为 `401 Bearer`，资源元数据位于 `https://cloud.comfy.org/mcp/.well-known/oauth-protected-resource`，发现的授权、Token 和动态注册端点分别为 `/oauth/authorize`、`/oauth/token`、`/oauth/register`。

交互授权必须由调用方显式完成：创建 `PersistentOAuthClientProvider` 时传入绝对、规范、非符号链接的 `CLAUDE_CONFIG_DIR` 和回调 URL；调用 `HeadlessMcpOAuthFlow.begin()` 获取 `authorizationUrl` 与 `state`；用户在外部浏览器完成登录后，把回调中的 `code` 和原始 `state` 传给 `completeCallback()`。Runtime 不自动启动浏览器，也不得把 Token、完整授权回调或配置目录内容写入日志或提交到 Git。
