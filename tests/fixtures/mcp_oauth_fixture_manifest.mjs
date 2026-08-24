// [Input] Official MCP Python SDK checkout supplied explicitly by the qualification environment.
// [Output] Pin the exact SDK revision, example path, and installed distribution expected by the OAuth CLI contract.
// [Pos] Provider-fixture provenance manifest; contains no credentials, tokens, or runtime configuration.
// [Sync] 2026-08-24: pin the official 2.0.0 legacy combined authorization/resource-server fixture.

export default Object.freeze({
  repository: "https://github.com/modelcontextprotocol/python-sdk.git",
  commit: "6f69a3758ebf2ee55ce050f58b470ce11af71133",
  fixturePath: "examples/servers/simple-auth",
  distribution: "mcp",
  version: "2.0.0",
});
