// [Input] Clean-room runtime callers requiring session persistence or temp-directory checks.
// [Output] Stable exports for the independently implemented session subsystem.
// [Pos] Public module boundary for src/cleanroom/session.
// [Sync] 2026-08-24: export paths, transcript storage, and session selection.

export {
  prepareProjectTranscriptDirectory,
  requireCanonicalAbsolutePath,
  requireRealDirectory,
  validateClaudeCodeTmpdir,
} from "./paths.ts";
export {
  openSession,
  SessionTranscript,
  validateSessionId,
} from "./store.ts";
export type { SessionMessage, SessionSelection } from "./store.ts";
