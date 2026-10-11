// [Sync] 2026-10-11: exact canonical source receipt comparison replaces a stale fixed-count npm gate.
// [Input] Exact original src target hashes plus contents after the existing headless/MCP transforms.
// [Output] Marker-checked child/model projection and original compact image/input/output compatibility.
// [Pos] Extension of the existing source compiler, not a duplicate module tree.
// [Sync] 2026-09-13: keep original module names, directories and file bytes unchanged.
// [Sync] 2026-10-11: bind compact-only media copies and completion to the original modules; preserve source/history bytes.
// [Sync] 2026-10-11: keep compact completion text identical without ANSI formatting in the headless SDK path.

export const DREAM_SOURCE_TARGETS = [
  { path: "src/utils/subprocessEnv.ts", sha256: "519bf73db39e33c449f00be33710e3ead5ff2e48cc5e187b6fd324ac3b10a4f6" },
  { path: "src/utils/Shell.ts", sha256: "ff0375ff87ce31ca0478b1d46048ded218330625b17035729781a17afc2c73d6" },
  { path: "src/services/mcp/client.ts", sha256: "787bba952e1f37dead67afab114b4ee71f66c95e8dba4559afa55679b113b8d2" },
  { path: "src/utils/sandbox/sandbox-adapter.ts", sha256: "7a69378764884ce8bd042e6286ee24468a77c18bb2582aa007bc4b3fd799bfcb" },
  { path: "src/utils/context.ts", sha256: "30959dbb7d41ea7cb211af6b46e0ae8ea8a73102c4f4a5d2abfc5249ba857be8" },
  { path: "src/utils/effort.ts", sha256: "0bb9ccf6afc3de0472266de1811dc6b44918abdc58ccf03ceb90d2c44c623104" },
  { path: "src/services/compact/compact.ts", sha256: "80af045d9247de7dda0cbe7aab653329d0b7c8b62a2cdadfd86238305df71f53" },
  { path: "src/utils/processUserInput/processSlashCommand.tsx", sha256: "56b12ed45c20c6afe2968b8510609515edbd065c0e7fa4a5edf9f0118bb45182" },
  { path: "src/QueryEngine.ts", sha256: "7df34a6a6d106927403d49e3405dfaf70da37cae5b644b658ebaf0b877988af6" },
  { path: "src/commands/compact/compact.ts", sha256: "c33d640823d01966cfcd04fa9af395217add1160e439693248e981ba1027b442" },
] as const;

/** Build/publication only: require the canonical path/SHA and applied-path receipts. */
export function matchesDreamSourceTargets(receipt: unknown): boolean {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) return false;
  const value = receipt as { requiredTargets?: unknown; appliedSourcePaths?: unknown };
  const targets = value.requiredTargets;
  const paths = value.appliedSourcePaths;
  if (!Array.isArray(targets) || !Array.isArray(paths) ||
      targets.length !== DREAM_SOURCE_TARGETS.length || paths.length !== DREAM_SOURCE_TARGETS.length) return false;
  const expectedPaths = DREAM_SOURCE_TARGETS.map(entry => entry.path).sort();
  return targets.every((entry, index) => entry && typeof entry === "object" && !Array.isArray(entry) &&
    Object.keys(entry).length === 2 && entry.path === DREAM_SOURCE_TARGETS[index].path &&
    entry.sha256 === DREAM_SOURCE_TARGETS[index].sha256) && paths.every((entry, index) => entry === expectedPaths[index]);
}

function replaceOnce(source: string, oldValue: string, newValue: string): string {
  if (source.split(oldValue).length !== 2) throw new Error("Dream source transform marker missing or ambiguous");
  const result = source.replace(oldValue, newValue);
  if (result.split(newValue).length !== 2 || (!newValue.includes(oldValue) && result.includes(oldValue))) {
    throw new Error("Dream source transform postcondition failed");
  }
  return result;
}

export function applyDreamSourceTransform(path: string, source: string): string {
  if (source.includes('from "ink:dream-compat"')) throw new Error("Dream source transform already applied");
  let result = source;
  let imports: string[];
  switch (path) {
    case "src/utils/subprocessEnv.ts":
      imports = ["stripNotionEnvironment"];
      result = replaceOnce(result,
        "    return Object.keys(proxyEnv).length > 0\n      ? { ...process.env, ...proxyEnv }\n      : process.env",
        "    return stripNotionEnvironment(Object.keys(proxyEnv).length > 0\n      ? { ...process.env, ...proxyEnv }\n      : process.env)");
      result = replaceOnce(result, "  return env\n", "  return stripNotionEnvironment(env)\n");
      break;
    case "src/utils/Shell.ts":
      imports = ["notionBashEnvironment"];
      result = replaceOnce(result, "    const childProcess = spawn(spawnBinary, shellArgs, {\n      env: {", "    const childProcess = spawn(spawnBinary, shellArgs, {\n      env: notionBashEnvironment({");
      result = replaceOnce(result, "          : {}),\n      },\n      cwd,", "          : {}),\n      }, getOriginalCwd(), process.env),\n      cwd,");
      break;
    case "src/services/mcp/client.ts":
      imports = ["stripNotionEnvironment"];
      result = replaceOnce(result, "          env: {\n            ...subprocessEnv(),\n            ...serverRef.env,\n          } as Record<string, string>,", "          env: stripNotionEnvironment({\n            ...subprocessEnv(),\n            ...serverRef.env,\n          }) as Record<string, string>,");
      break;
    case "src/utils/sandbox/sandbox-adapter.ts":
      imports = ["notionProjection"];
      result = replaceOnce(result, "  const allowRead: string[] = []", "  const allowRead: string[] = [];\n  const dreamNotion = notionProjection(getOriginalCwd(), process.env);\n  allowRead.push(...dreamNotion.allowRead);\n  allowWrite.push(...dreamNotion.allowWrite);\n  allowedDomains.push(...dreamNotion.allowedDomains)");
      break;
    case "src/utils/context.ts":
      imports = ["explicitPositiveInteger"];
      result = replaceOnce(result, "): number {\n  // Allow override via environment variable (ant-only)", "): number {\n  const dreamContext = explicitPositiveInteger(process.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS, 'CLAUDE_CODE_MAX_CONTEXT_TOKENS');\n  if (dreamContext !== undefined) return dreamContext;\n  // Allow override via environment variable (ant-only)");
      result = replaceOnce(result, "} {\n  let defaultTokens: number\n  let upperLimit: number", "} {\n  const dreamMaxOutput = explicitPositiveInteger(process.env.INK_CLAUDE_CODE_MODEL_MAX_OUTPUT_TOKENS, 'INK_CLAUDE_CODE_MODEL_MAX_OUTPUT_TOKENS');\n  if (dreamMaxOutput !== undefined) return { default: Math.min(MAX_OUTPUT_TOKENS_DEFAULT, dreamMaxOutput), upperLimit: dreamMaxOutput };\n  let defaultTokens: number\n  let upperLimit: number");
      break;
    case "src/utils/effort.ts":
      imports = ["explicitEffort"];
      result = replaceOnce(result, "  'high',\n  'max',", "  'high',\n  'xhigh',\n  'max',");
      result = replaceOnce(result, "export function modelSupportsEffort(model: string): boolean {", "export function modelSupportsEffort(model: string): boolean {\n  if (explicitEffort(process.env.CLAUDE_CODE_EFFORT_LEVEL) !== undefined) return true;");
      result = replaceOnce(result, "export function modelSupportsMaxEffort(model: string): boolean {", "export function modelSupportsMaxEffort(model: string): boolean {\n  if (explicitEffort(process.env.CLAUDE_CODE_EFFORT_LEVEL) === 'max') return true;");
      break;
    case "src/services/compact/compact.ts":
      imports = ["nativeImageCompactMessage", "bindCompactSummaryRequest"];
      result = replaceOnce(result,
        "export function stripImagesFromMessages(messages: Message[]): Message[] {\n  return messages.map(message => {",
        "export function stripImagesFromMessages(messages: Message[]): Message[] {\n  return messages.map(message => {\n    if (message.type === 'assistant') return nativeImageCompactMessage(message)");
      result = replaceOnce(result,
        "  // When prompt cache sharing is enabled, use forked agent to reuse the",
        "  summaryRequest = bindCompactSummaryRequest(summaryRequest, context)\n  // When prompt cache sharing is enabled, use forked agent to reuse the");
      result = replaceOnce(result,
        "          stripImagesFromMessages(\n            stripReinjectedAttachments([\n              ...getMessagesAfterCompactBoundary(messages),\n              summaryRequest,\n            ]),\n          ),",
        "          [\n            ...stripImagesFromMessages(stripReinjectedAttachments(getMessagesAfterCompactBoundary(messages))),\n            summaryRequest,\n          ],");
      break;
    case "src/utils/processUserInput/processSlashCommand.tsx":
      imports = ["withCompactInputContext"];
      result = replaceOnce(result, "            const result = await mod.call(args, context);",
        "            const result = await mod.call(args, command.name === 'compact' ? withCompactInputContext(context, userMessage) : context);");
      break;
    case "src/QueryEngine.ts":
      imports = ["compactCompletionOutput"];
      result = replaceOnce(result,
        "    // Push new messages, including user input and any attachments\n    this.mutableMessages.push(...messagesFromUserInput)",
        "    const compactOutput = compactCompletionOutput(messagesFromUserInput, this.mutableMessages)\n    // Push new messages, including user input and any attachments\n    this.mutableMessages.push(...messagesFromUserInput)");
      result = replaceOnce(result,
        "      yield {\n        type: 'result',\n        subtype: 'success',",
        "      if (compactOutput) yield localCommandOutputToSDKAssistantMessage(compactOutput.content, compactOutput.uuid)\n\n      yield {\n        type: 'result',\n        subtype: 'success',");
      break;
    case "src/commands/compact/compact.ts":
      imports = [];
      result = replaceOnce(result,
        "  return chalk.dim('Compacted ' + dimmed.join('\\n'))",
        "  return 'Compacted ' + dimmed.join('\\n')");
      break;
    default: throw new Error("Unknown Dream source transform target");
  }
  return imports.length ? `import { ${imports.join(", ")} } from "ink:dream-compat";\n${result}` : result;
}
