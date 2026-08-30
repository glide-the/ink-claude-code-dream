// [Input] Runtime parent or caller-supplied subprocess environments.
// [Output] Exact environment-name ownership plus copies safe for non-Bash child processes.
// [Pos] Clean-room process boundary preventing Dream's Notion Bash capability from reaching unrelated children.
// [Sync] 2026-08-30: reserve the actor/thread-bound NOTION_* projection exclusively for production Bash.

export const NOTION_BASH_ENV_NAMES = [
  "NOTION_API_TOKEN",
  "NOTION_HOME",
  "NOTION_KEYRING",
  "NOTION_WORKERS_CONFIG_FILE",
] as const;

const NOTION_BASH_ENV_NAME_SET = new Set<string>(NOTION_BASH_ENV_NAMES);

export function withoutNotionBashEnvironment(
  source: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(source)) {
    if (value !== undefined && !NOTION_BASH_ENV_NAME_SET.has(name)) {
      environment[name] = value;
    }
  }
  return environment;
}
