// [Input] Exact original src target hashes plus contents after the existing headless/MCP transforms.
// [Output] Marker-checked in-memory deltas for Dream child isolation and explicit model projection.
// [Pos] Extension of the existing source compiler, not a duplicate module tree.
// [Sync] 2026-09-13: keep original module names, directories and file bytes unchanged.

export const DREAM_SOURCE_TARGETS = [
  { path: "src/utils/subprocessEnv.ts", sha256: "519bf73db39e33c449f00be33710e3ead5ff2e48cc5e187b6fd324ac3b10a4f6" },
  { path: "src/utils/Shell.ts", sha256: "ff0375ff87ce31ca0478b1d46048ded218330625b17035729781a17afc2c73d6" },
  { path: "src/services/mcp/client.ts", sha256: "787bba952e1f37dead67afab114b4ee71f66c95e8dba4559afa55679b113b8d2" },
  { path: "src/utils/sandbox/sandbox-adapter.ts", sha256: "7a69378764884ce8bd042e6286ee24468a77c18bb2582aa007bc4b3fd799bfcb" },
  { path: "src/utils/context.ts", sha256: "30959dbb7d41ea7cb211af6b46e0ae8ea8a73102c4f4a5d2abfc5249ba857be8" },
  { path: "src/utils/effort.ts", sha256: "0bb9ccf6afc3de0472266de1811dc6b44918abdc58ccf03ceb90d2c44c623104" },
] as const;

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
    default: throw new Error("Unknown Dream source transform target");
  }
  return `import { ${imports.join(", ")} } from "ink:dream-compat";\n${result}`;
}
