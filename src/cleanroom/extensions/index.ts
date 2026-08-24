// [Input] Clean-room callers requiring local Skills or SDK hook matching.
// [Output] Stable exports for extension discovery and pure hook selection.
// [Pos] Public module boundary for src/cleanroom/extensions.
// [Sync] 2026-08-24: export bounded Skills and hooks configuration APIs.

export {
  loadSkillCatalog,
  parseSkillDocument,
} from "./skills.ts";
export type {
  SkillCatalog,
  SkillContent,
  SkillDefinition,
} from "./skills.ts";
export {
  hookMatcherMatches,
  normalizeHookConfiguration,
  selectHookCallbackIds,
} from "./hooks.ts";
export type { HookConfiguration, HookMatcher } from "./hooks.ts";
