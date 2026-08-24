// [Input] Tokens following the clean-room Runtime executable name.
// [Output] A strict MCP management command without altering colon-bearing names.
// [Pos] Untrusted argv boundary for the Dream-compatible MCP management CLI.
// [Sync] 2026-08-24: implement the bounded list/get/add/remove/login/logout grammar.

export type McpManagementCommand =
  | { kind: "help"; subject?: "add" | "remove" | "login" | "logout" }
  | { kind: "list" }
  | { kind: "get"; serverName: string }
  | { kind: "add"; serverName: string; serverUrl: string }
  | { kind: "remove"; serverName: string }
  | { kind: "login"; serverName: string }
  | { kind: "logout"; serverName: string };

function requireServerName(value: string | undefined): string {
  const name = value?.trim();
  if (!name || name.length > 2_048 || /[\u0000-\u001f\u007f]/u.test(name)) {
    throw new Error("MCP server name is invalid");
  }
  return name;
}

function helpSubject(value: string | undefined): McpManagementCommand {
  if (value === "add" || value === "remove" || value === "login" || value === "logout") {
    return { kind: "help", subject: value };
  }
  return { kind: "help" };
}

export function parseMcpManagementArgv(argv: string[]): McpManagementCommand | undefined {
  if (argv[0] !== "mcp") return undefined;
  const command = argv[1];
  if (!command || command === "help" || command === "--help" || command === "-h") {
    return helpSubject(argv[2]);
  }
  if (argv.includes("--help") || argv.includes("-h")) return helpSubject(command);

  if (command === "list" && argv.length === 2) return { kind: "list" };
  if (command === "get" && argv.length === 3) {
    return { kind: "get", serverName: requireServerName(argv[2]) };
  }
  if (command === "login") {
    const tail = argv.slice(2);
    if (tail.length === 2 && tail[1] === "--no-browser") {
      return { kind: "login", serverName: requireServerName(tail[0]) };
    }
    throw new Error("mcp login requires <name> --no-browser");
  }
  if (command === "logout" && argv.length === 3) {
    return { kind: "logout", serverName: requireServerName(argv[2]) };
  }
  if (command === "add") {
    const expected = argv.slice(2, 6);
    if (
      argv.length === 8 &&
      expected[0] === "--transport" && expected[1] === "http" &&
      expected[2] === "--scope" && expected[3] === "user"
    ) {
      return {
        kind: "add",
        serverName: requireServerName(argv[6]),
        serverUrl: argv[7]!,
      };
    }
    throw new Error("mcp add supports only --transport http --scope user <name> <url>");
  }
  if (command === "remove") {
    if (argv.length === 5 && argv[2] === "--scope" && argv[3] === "user") {
      return { kind: "remove", serverName: requireServerName(argv[4]) };
    }
    throw new Error("mcp remove supports only --scope user <name>");
  }
  throw new Error("unsupported mcp command");
}
