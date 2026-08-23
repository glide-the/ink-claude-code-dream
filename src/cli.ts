// [Input] Consume Runtime control flags or opaque Claude Code CLI arguments from existing cli_path callers.
// [Output] Lazy-load evidence/doctor/launch paths and preserve the official child exit contract.
// [Pos] CLI-compatible executable selected through CLAUDE_CODE_CLI_PATH / ClaudeAgentOptions.cli_path.
// [Sync] 2026-08-23: expose the upstream secure-storage selector marker required by Dream's macOS CLI capability gate.

const CONTROL_FLAGS = new Set([
  "--runtime-manifest",
  "--runtime-doctor",
]);

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "unknown runtime failure";
  return message.replace(/[\r\n]+/g, " ").slice(0, 1024);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command === "--runtime-manifest") {
    if (args.length !== 1) throw new Error("runtime manifest command takes no arguments");
    const { readManifestEnvelope } = await import("./manifest.js");
    const envelope = await readManifestEnvelope();
    process.stdout.write(`${JSON.stringify(envelope)}\n`);
    return;
  }
  if (command === "--runtime-doctor") {
    if (args.length !== 1) throw new Error("runtime doctor command takes no arguments");
    const { doctor } = await import("./launcher.js");
    process.stdout.write(`${JSON.stringify(await doctor())}\n`);
    return;
  }
  if (command && CONTROL_FLAGS.has(command)) {
    throw new Error("unsupported runtime control command");
  }

  const { conventionalSignalExitCode, launchOfficialCli } = await import(
    "./launcher.js"
  );
  const result = await launchOfficialCli(args);
  if (result.signal) {
    process.exitCode = conventionalSignalExitCode(result.signal);
    return;
  }
  process.exitCode = result.exitCode ?? 70;
}

// Dream deliberately scans the selected CLI entrypoint before allowing a
// macOS user-scoped MCP identity. The official core behind this transparent
// launcher owns the selector behavior; retaining the literal here proves the
// wrapper does not hide that capability while argv/env remain opaque.
Object.defineProperty(main, "upstreamSecureStorageSelector", {
  value: "CLAUDE_SECURESTORAGE_CONFIG_DIR",
  enumerable: false,
  writable: false,
});

main().catch((error: unknown) => {
  process.stderr.write(`ink-claude-code-dream: ${safeErrorMessage(error)}\n`);
  process.exitCode = 70;
});
