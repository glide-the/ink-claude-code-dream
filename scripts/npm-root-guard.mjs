#!/usr/bin/env node
// [Input] npm lifecycle invocation against the private repository orchestration package.
// [Output] Fail closed before npm can pack or publish the private repository orchestrator.
// [Pos] Root-package safety guard; generated scoped packages use their own verified prepack gate.
// [Sync] 2026-08-24: retain the legacy-envelope diagnostic contract while naming the clean-room five-package path.

throw new Error(
  "[npm-root-guard] 禁止打包或发布仓库根包或 legacy envelope：它是 private 的构建编排包，不是五包发布产物。请使用 clean-room qualification、npm:stage 和 npm:smoke；publicationAllowed/productionEligible 未通过时必须阻断。",
);
