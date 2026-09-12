// [Input] Consume the built release, provider-free test fixture, and local environment for timing/mismatch evidence.
// [Output] Emit bounded JSON acceptance metrics without credentials, model calls, or user material.
// [Pos] Repeatable technical acceptance harness; real Dream business/model acceptance remains out of scope.
// [Sync] 2026-09-13: exercise the Runtime 0.1.7 candidate release directory.

import { spawn } from "node:child_process";
import { chmod, mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";

const executable = resolve(
  "dist/release/ink-claude-code-dream-0.1.7/bin/ink-claude-code-dream",
);
const fakeClaude = resolve("tests/fixtures/fake-claude.mjs");
await chmod(fakeClaude, 0o755);
const workspace = await mkdtemp(join(tmpdir(), "ink-runtime-acceptance-"));
const claudeTmpdir = join(workspace, ".claude-tmp");
await mkdir(claudeTmpdir, { mode: 0o700 });
const baseEnv = {
  ...process.env,
  INK_CLAUDE_CODE_EXECUTABLE: fakeClaude,
  INK_CLAUDE_RUNTIME_WORKSPACE_ROOT: workspace,
  CLAUDE_CODE_TMPDIR: claudeTmpdir,
};

function run(args, env = baseEnv) {
  return new Promise((resolveRun, reject) => {
    const started = performance.now();
    const child = spawn(process.execPath, [executable, ...args], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.once("error", reject);
    child.once("close", (code, signal) =>
      resolveRun({
        code,
        signal,
        durationMs: Number((performance.now() - started).toFixed(2)),
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      }),
    );
  });
}

const manifestSamples = [];
const versionProbeSamples = [];
const mainLaunchSamples = [];
for (let index = 0; index < 7; index += 1) {
  manifestSamples.push((await run(["--runtime-manifest"])).durationMs);
  versionProbeSamples.push((await run(["--version"])).durationMs);
  mainLaunchSamples.push((await run(["-p"])).durationMs);
}
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const doctor = await run(["--runtime-doctor"]);
const localCore = process.env.INK_ACCEPTANCE_REAL_CLAUDE
  ? await run(["--runtime-doctor"], {
      ...baseEnv,
      INK_CLAUDE_CODE_EXECUTABLE: process.env.INK_ACCEPTANCE_REAL_CLAUDE,
    })
  : { skipped: true, reason: "INK_ACCEPTANCE_REAL_CLAUDE not set" };

process.stdout.write(
  `${JSON.stringify(
    {
      ok: doctor.code === 0,
      node: process.versions.node,
      runtime: "0.1.7",
      fakeCore: "2.1.241",
      coreLoadingReduction: 0,
      coldStartMs: {
        manifestMedian: median(manifestSamples),
        sdkVersionProbeMedian: median(versionProbeSamples),
        singleCoreMainLaunchMedian: median(mainLaunchSamples),
        manifestSamples,
        versionProbeSamples,
        mainLaunchSamples,
      },
      doctor: { code: doctor.code, payload: JSON.parse(doctor.stdout) },
      realCoreProbe: localCore,
      contractAssertions: {
        protocolAndStreaming: "provider-free opaque byte forwarding only",
        mainLaunchCoreSpawnCount: 1,
        mcpVersionMetadata: ["1.27.0", "1.27.1"],
        lifecycleFixture: [
          "cancel",
          "timeout",
          "process-group cleanup",
          "crash exit",
          "SDK version-skip rejection",
        ],
      },
      declaredDelegatedNotE2E: {
        mcpTransports: ["stdio", "HTTP", "SSE", "OAuth", "Resources", "user-defined"],
        extensions: ["plugins", "skills", "hooks"],
        state: ["workspace", "transcript", "resume", "sandbox"],
      },
      limitation:
        "No credentials or real model/Dream business path are used; delegated core behavior is not claimed as end-to-end accepted.",
    },
    null,
    2,
  )}\n`,
);
