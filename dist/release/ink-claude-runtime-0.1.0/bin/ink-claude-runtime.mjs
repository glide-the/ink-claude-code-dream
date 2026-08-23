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
    const { readManifestEnvelope } = await import("../lib/manifest-C2MWZTPA.mjs");
    const envelope = await readManifestEnvelope();
    process.stdout.write(`${JSON.stringify(envelope)}
`);
    return;
  }
  if (command === "--runtime-doctor") {
    if (args.length !== 1) throw new Error("runtime doctor command takes no arguments");
    const { doctor } = await import("../lib/launcher-UUPMEHFP.mjs");
    process.stdout.write(`${JSON.stringify(await doctor())}
`);
    return;
  }
  if (command && CONTROL_FLAGS.has(command)) {
    throw new Error("unsupported runtime control command");
  }
  const { conventionalSignalExitCode, launchOfficialCli } = await import("../lib/launcher-UUPMEHFP.mjs");
  const result = await launchOfficialCli(args);
  if (result.signal) {
    process.exitCode = conventionalSignalExitCode(result.signal);
    return;
  }
  process.exitCode = result.exitCode ?? 70;
}
main().catch((error) => {
  process.stderr.write(`ink-claude-runtime: ${safeErrorMessage(error)}
`);
  process.exitCode = 70;
});
