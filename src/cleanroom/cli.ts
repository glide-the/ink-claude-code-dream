// [Input] Bun process argv plus newline-delimited SDK frames on stdin.
// [Output] Claude-compatible help/version text or clean-room SDK-compatible JSONL on stdout.
// [Pos] Standalone executable entrypoint and lifecycle owner for the clean-room Runtime.
// [Sync] 2026-08-24: emit bounded initialization-stage diagnostics while keeping underlying errors private.
// [Sync] 2026-09-12: restore a truthful package CLI help surface for the supported headless contract.

import { createInterface } from "node:readline";
import { parseRuntimeArgv } from "./argv.ts";
import { runMcpManagementCli } from "./mcp/index.ts";
import { CleanroomInitializationError, CleanroomProtocol } from "./protocol.ts";

const VERSION_TEXT = "2.1.241 (Claude Code)";
const HELP_TEXT = `Usage: claude [options] [command]

Dream-compatible Claude CLI. Interactive Ink UI is not included; use -p/--print
with the Claude Agent SDK stream-json transport.

Options:
  --allowedTools, --allowed-tools <tools...>        Allow listed tool names
  --append-system-prompt <prompt>                   Append to the system prompt
  --disallowedTools, --disallowed-tools <tools...> Deny listed tool names
  --effort <level>                                  Effort level
  --fork-session                                    Fork when resuming
  -h, --help                                        Display help
  --include-partial-messages                        Emit streaming deltas
  --input-format <format>                           Must be stream-json
  --mcp-config <configs...>                         Load explicit MCP servers
  --model <model>                                   Select the model
  --output-format <format>                          Must be stream-json
  --permission-mode <mode>                          Select permission behavior
  --plugin-dir <path>                               Load a plugin directory
  -p, --print                                       Use non-interactive mode
  -r, --resume <session-id>                         Resume a session
  --session-id <uuid>                               Use a session ID
  --setting-sources <sources>                       Select settings sources
  --settings <file-or-json>                         Load settings
  --strict-mcp-config                               Ignore ambient MCP config
  --system-prompt <prompt>                          Replace the system prompt
  --tools <tools...>                                Select built-in tools
  -v, --version                                     Output the version

Commands:
  mcp                                               Configure and inspect MCP servers
`;
const argv = process.argv.slice(2);

if (argv.includes("--version") || argv.includes("-v")) {
  process.stdout.write(`${VERSION_TEXT}\n`);
  process.exit(0);
}

const mcpExitCode = await runMcpManagementCli(argv);
if (mcpExitCode !== undefined) {
  process.exit(mcpExitCode);
}

if (argv.includes("--help") || argv.includes("-h")) {
  process.stdout.write(HELP_TEXT);
  process.exit(0);
}

let runtime: CleanroomProtocol | undefined;
let forcedExit: ReturnType<typeof setTimeout> | undefined;
try {
  runtime = await CleanroomProtocol.create(parseRuntimeArgv(argv), argv);
  const lines = createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY });

  let terminating = false;
  const terminate = (): void => {
    if (terminating) return;
    terminating = true;
    runtime?.abortActiveTurn();
    lines.close();
    process.stdin.pause();
    forcedExit = setTimeout(() => process.exit(0), 2_500);
  };
  process.once("SIGTERM", terminate);
  process.once("SIGINT", terminate);

  for await (const line of lines) {
    if (!line.trim()) continue;
    await runtime.handleFrame(JSON.parse(line) as unknown);
  }
  await runtime.drain();
} catch (error) {
  const stage = error instanceof CleanroomInitializationError
    ? ` [stage=${error.stage}${error.detail ? `:${error.detail}` : ""}]`
    : "";
  process.stderr.write(`ink-claude-code-dream: Runtime initialization or execution failed${stage}\n`);
  runtime?.abortActiveTurn();
  process.exitCode = 1;
} finally {
  await runtime?.close().catch(() => undefined);
  if (forcedExit) clearTimeout(forcedExit);
}
