#!/usr/bin/env node
// [Input] npm lifecycle invocation against the private repository orchestration package.
// [Output] Fail closed before npm can pack or publish the private repository orchestrator.
// [Pos] Root-package safety guard; generated scoped packages use their own verified prepack gate.
// [Sync] 2026-09-13: the original-source project is one Runtime; compilation is not public redistribution authority.

throw new Error(
  "[npm-root-guard] 禁止打包或发布 private 仓库根包：Runtime 由原始 src 模块构建。请使用 npm run package 的本地制品路径；publicationAllowed/redistributionAllowed 未获单独授权时必须阻断 npm 发布。",
);
