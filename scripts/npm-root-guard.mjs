#!/usr/bin/env node
// [Input] npm lifecycle invocation against the private repository orchestration package.
// [Output] Fail closed before npm can pack or publish the historical legacy envelope.
// [Pos] Root-package safety guard; generated scoped packages use their own verified prepack gate.

throw new Error(
  "[npm-root-guard] 禁止打包或发布仓库根包：它是 private/UNLICENSED 的 legacy envelope，不是 qualified minimal core。请使用 npm:stage 和 npm:smoke；当前 publicationAllowed/redistributionAllowed 为 false 时它们也会明确阻断。",
);
