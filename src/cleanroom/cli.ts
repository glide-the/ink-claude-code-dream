// [Input] Bun process argv plus newline-delimited SDK frames on stdin.
// [Output] Claude Code version text or clean-room SDK-compatible JSONL on stdout.
// [Pos] Standalone executable entrypoint and lifecycle owner for the clean-room Runtime.
// [Sync] 2026-08-24: emit bounded initialization-stage diagnostics while keeping underlying errors private.

import { createInterface } from "node:readline";
import { parseRuntimeArgv } from "./argv.ts";
import { runMcpManagementCli } from "./mcp/index.ts";
import { CleanroomInitializationError, CleanroomProtocol } from "./protocol.ts";

const VERSION_TEXT = "2.1.241 (Claude Code)";
const argv = process.argv.slice(2);

if (argv.includes("--version") || argv.includes("-v")) {
  process.stdout.write(`${VERSION_TEXT}\n`);
  process.exit(0);
}

const mcpExitCode = await runMcpManagementCli(argv);
if (mcpExitCode !== undefined) {
  process.exit(mcpExitCode);
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
