#!/usr/bin/env node
// src/cli.ts
var CONTROL_FLAGS = /* @__PURE__ */ new Set([
  "--runtime-manifest",
  "--runtime-doctor"
]);
function safeErrorMessage(error) {
  const message = error instanceof Error ? error.message : "unknown runtime failure";
  return message.replace(/[\r\n]+/g, " ").slice(0, 1024);
}
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  if (command === "--runtime-manifest") {
    if (args.length !== 1) throw new Error("runtime manifest command takes no arguments");
    const { readManifestEnvelope } = await import("../lib/manifest-AM7I7LZW.mjs");
    const envelope = await readManifestEnvelope();
    process.stdout.write(`${JSON.stringify(envelope)}
`);
    return;
  }
  if (command === "--runtime-doctor") {
    if (args.length !== 1) throw new Error("runtime doctor command takes no arguments");
    const { doctor } = await import("../lib/launcher-DLNN5JDH.mjs");
    process.stdout.write(`${JSON.stringify(await doctor())}
`);
    return;
  }
  if (command && CONTROL_FLAGS.has(command)) {
    throw new Error("unsupported runtime control command");
  }
  const { conventionalSignalExitCode, launchOfficialCli } = await import("../lib/launcher-DLNN5JDH.mjs");
  const result = await launchOfficialCli(args);
  if (result.signal) {
    process.exitCode = conventionalSignalExitCode(result.signal);
    return;
  }
  process.exitCode = result.exitCode ?? 70;
}
Object.defineProperty(main, "upstreamSecureStorageSelector", {
  value: "CLAUDE_SECURESTORAGE_CONFIG_DIR",
  enumerable: false,
  writable: false
});
main().catch((error) => {
  process.stderr.write(`ink-claude-code-dream: ${safeErrorMessage(error)}
`);
  process.exitCode = 70;
});
