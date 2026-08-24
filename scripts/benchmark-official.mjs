// [Input] INK_ACCEPTANCE_REAL_CLAUDE pointing to an already verified official Claude Code executable.
// [Output] Compare direct versus envelope version latency and verify --help bytes/exit stay identical.
// [Pos] Optional local performance/difference evidence; it makes no model call and changes no installation.

import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access, readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";

const core = process.env.INK_ACCEPTANCE_REAL_CLAUDE
  ? resolve(process.env.INK_ACCEPTANCE_REAL_CLAUDE)
  : null;
if (!core) throw new Error("INK_ACCEPTANCE_REAL_CLAUDE is required");
await access(core, fsConstants.X_OK);
const releaseRoot = resolve("dist/release/ink-claude-code-dream-0.1.0");
const wrapper = join(releaseRoot, "bin", "ink-claude-code-dream.mjs");
await access(wrapper, fsConstants.X_OK);

function run(executable, args, env = process.env) {
  return new Promise((resolveRun, reject) => {
    const started = performance.now();
    const child = spawn(executable, args, { env, stdio: ["ignore", "pipe", "pipe"] });
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
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
      }),
    );
  });
}

const envelopeEnv = { ...process.env, INK_CLAUDE_CODE_EXECUTABLE: core };
for (let warmup = 0; warmup < 2; warmup += 1) {
  await run(core, ["--version"]);
  await run(wrapper, ["--version"], envelopeEnv);
}
const directSamples = [];
const envelopeSamples = [];
for (let sample = 0; sample < 9; sample += 1) {
  directSamples.push((await run(core, ["--version"])).durationMs);
  envelopeSamples.push(
    (await run(wrapper, ["--version"], envelopeEnv)).durationMs,
  );
}
const median = (values) => [...values].sort((left, right) => left - right)[4];
const directMedian = median(directSamples);
const envelopeMedian = median(envelopeSamples);
const directHelp = await run(core, ["--help"]);
const envelopeHelp = await run(wrapper, ["--help"], envelopeEnv);
const digest = (body) => createHash("sha256").update(body).digest("hex");

async function filesUnder(root) {
  const results = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const absolute = join(root, entry.name);
    if (entry.isDirectory()) results.push(...(await filesUnder(absolute)));
    else if (entry.isFile()) results.push(absolute);
  }
  return results;
}

const helpEquivalent =
  directHelp.code === envelopeHelp.code &&
  directHelp.signal === envelopeHelp.signal &&
  digest(directHelp.stdout) === digest(envelopeHelp.stdout) &&
  digest(directHelp.stderr) === digest(envelopeHelp.stderr);
if (!helpEquivalent) throw new Error("wrapper changed official --help output or exit semantics");
process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      directVersionMedianMs: directMedian,
      envelopeVersionMedianMs: envelopeMedian,
      envelopeDeltaMs: Number((envelopeMedian - directMedian).toFixed(2)),
      envelopeDeltaPercent: Number(
        (((envelopeMedian - directMedian) / directMedian) * 100).toFixed(1),
      ),
      directSamples,
      envelopeSamples,
      helpEquivalent,
      helpStdoutSha256: digest(directHelp.stdout),
      envelopeReleaseFileCount: (await filesUnder(releaseRoot)).length,
      coreLoadingReduction: 0,
      interpretation:
        "The envelope adds a Node process and release-file loading; it is not a cold-start or memory optimization.",
    },
    null,
    2,
  )}\n`,
);
