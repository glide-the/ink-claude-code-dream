// [Input] Production publisher with injected npm transport/clock and disposable five-archive fixtures.
// [Output] Offline evidence for exact-byte retries, propagation deadlines, ordering and credential-safe failure.
// [Pos] Provider-free publication-tool regression; never contacts npm or qualifies synthetic Runtime archives.
// [Sync] 2026-09-13: cover delayed/fractional-clock visibility without republishing or weakening immutable integrity checks.
// [Sync] 2026-09-13: verify AGENTS-only updates skip packaging while workflow updates do not.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { publishQualifiedNpm } from "../scripts/publish-qualified-npm.mjs";

const policy = JSON.parse(await readFile(new URL("../runtime/npm-release-policy.json", import.meta.url), "utf8"));
const names = [...Object.values(policy.platforms).map(platform => platform.package), policy.metaPackage];
const missing = { status: 1, stdout: JSON.stringify({ error: { code: "E404" } }), stderr: "npm error code E404\n" };
const secret = "offline-only-sensitive-diagnostic";

test("docs/publisher-only changes skip packaging, never source or qualification changes", async () => {
  const workflow = await readFile(new URL("../.github/workflows/qualify-npm-runtime.yml", import.meta.url), "utf8");
  const block = workflow.match(/paths-ignore:\n((?:      - [^\n]+\n)+)/)?.[1];
  assert.ok(block);
  const patterns = block.trim().split("\n").map(line => line.trim().slice(2).replace(/^['"]|['"]$/g, ""));
  const ignored = file => patterns.some(pattern => path.matchesGlob(file, pattern));
  for (const file of ["AGENTS.md", "README.md", ".folder.md", "scripts/.folder.md", "docs/build/runtime-0.1.9-release-notes.md",
    "scripts/publish-qualified-npm.mjs", "tests/publish-qualified-npm.test.mjs"]) assert.equal(ignored(file), true, file);
  for (const file of ["src/entrypoints/cli.tsx", "compat/dream-runtime/policy.ts", "runtime/source-provenance.json",
    "scripts/build-core-prune.ts", "scripts/npm-release.mjs", "tests/fixtures/mcp_server.py", "package.json", "bun.lock",
    ".github/workflows/qualify-npm-runtime.yml", ".github/workflows/publish-npm.yml"]) assert.equal(ignored(file), false, file);
  const ci = await readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  assert.match(ci, /pull_request:/);
  assert.match(ci, /run: npm test/);
});

async function fixture(t, behavior = () => undefined, env = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), "ink-npm-publisher-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const integrities = new Map();
  const filenames = new Map();
  for (const name of names) {
    const body = Buffer.from(`Synthetic transport fixture: ${name}`);
    const file = path.join(directory, `${name.replace(/^@/, "").replace("/", "-")}-${policy.version}.tgz`);
    await writeFile(file, body, { mode: 0o600 });
    filenames.set(name, file);
    integrities.set(name, `sha512-${createHash("sha512").update(body).digest("base64")}`);
  }
  const calls = [];
  const waits = [];
  const logs = [];
  let elapsed = 0;
  const options = {
    env: { GITHUB_ACTIONS: "true", ...env },
    now: () => elapsed,
    sleep: async ms => {
      assert.ok(ms > 0 && ms <= 5000);
      waits.push(ms);
      elapsed += ms;
    },
    log: value => logs.push(JSON.parse(value)),
    run: (command, args, config) => {
      const op = command === process.execPath ? "verify" : args[0];
      assert.ok(command === process.execPath || command === "npm");
      const name = op === "view" ? names.find(value => args[1] === `${value}@${policy.version}`)
        : op === "publish" ? names.find(value => args[1] === filenames.get(value)) : undefined;
      const call = { op, name, args, config };
      calls.push(call);
      if (op === "verify") {
        assert.equal(args[0], path.resolve(import.meta.dirname, "../scripts/verify-npm-tarball.mjs"));
        assert.deepEqual([...args.slice(1)].sort(), [...filenames.values()].sort());
      } else {
        assert.ok(name);
        assert.equal(calls[0].op, "verify");
        assert.ok(args.includes("--registry=https://registry.npmjs.org"));
        if (op === "view") {
          assert.ok(Number.isInteger(config.timeout) && config.timeout > 0 && config.timeout <= 180000);
          assert.ok(args.includes("--prefer-online"));
          assert.ok(args.includes("--fetch-retries=0"));
          assert.ok(args.includes(`--fetch-timeout=${config.timeout}`));
        }
      }
      const result = behavior({ ...call, calls, elapsed, expected: integrities.get(name),
        advance: ms => { elapsed += Math.min(ms, config.timeout); } });
      return result ?? { status: 0, stdout: op === "view" ? JSON.stringify(integrities.get(name)) : "", stderr: "" };
    },
  };
  return { directory, options, calls, waits, logs, elapsed: () => elapsed };
}

test("CI-only guard and exact release verification precede any npm operation", async t => {
  const f = await fixture(t);
  await assert.rejects(publishQualifiedNpm(f.directory, { ...f.options, env: {} }), /CI-only/);
  assert.equal(f.calls.length, 0);
  const rejected = await fixture(t, ({ op }) => op === "verify" ? { status: 1, stderr: secret } : undefined);
  await assert.rejects(publishQualifiedNpm(rejected.directory, rejected.options), error => {
    assert.match(error.message, /Release set verification failed/);
    assert.ok(!error.message.includes(secret));
    return true;
  });
  assert.deepEqual(rejected.calls.map(call => call.op), ["verify"]);
});

test("identical existing packages are verified without upload or unnecessary polling", async t => {
  const f = await fixture(t);
  await publishQualifiedNpm(f.directory, f.options);
  assert.deepEqual(f.calls.filter(call => call.op === "view").map(call => call.name), names);
  assert.equal(f.calls.filter(call => call.op === "publish").length, 0);
  assert.equal(f.waits.length, 0);
  assert.deepEqual(f.logs.map(log => log.published), names.map(() => false));
});

test("four platforms publish and verify before selector; token and OIDC modes remain isolated", async t => {
  for (const tokenMode of [true, false]) {
    await t.test(tokenMode ? "token" : "OIDC", async t => {
      const uploaded = new Set();
      const env = { ACTIONS_ID_TOKEN_REQUEST_URL: secret, ACTIONS_ID_TOKEN_REQUEST_TOKEN: secret,
        ...(tokenMode ? { NODE_AUTH_TOKEN: secret } : {}) };
      const f = await fixture(t, ({ op, name }) => {
        if (op === "publish") uploaded.add(name);
        if (op === "view" && !uploaded.has(name)) return missing;
      }, env);
      await publishQualifiedNpm(f.directory, f.options);
      assert.deepEqual(f.calls.filter(call => call.op === "publish").map(call => call.name), names);
      assert.deepEqual(f.calls.filter(call => call.op !== "verify").map(call => call.op), names.flatMap(() => ["view", "publish", "view"]));
      for (const call of f.calls.filter(call => call.op !== "verify")) {
        assert.equal(Object.hasOwn(call.config.env, "ACTIONS_ID_TOKEN_REQUEST_TOKEN"), !tokenMode);
        assert.equal(Object.hasOwn(call.config.env, "ACTIONS_ID_TOKEN_REQUEST_URL"), !tokenMode);
        if (call.op === "publish") assert.ok(call.args.includes(`--provenance=${!tokenMode}`));
      }
      assert.equal(env.ACTIONS_ID_TOKEN_REQUEST_TOKEN, secret);
      assert.ok(!JSON.stringify(f.logs).includes(secret));
      assert.deepEqual(f.logs.map(log => log.published), names.map(() => true));
    });
  }
});

test("new package can become visible after 190 seconds without a second upload", async t => {
  const f = await fixture(t, ({ op, name, elapsed }) => op === "view" && name === names[0] && elapsed < 190000 ? missing : undefined);
  await publishQualifiedNpm(f.directory, f.options);
  assert.equal(f.elapsed(), 190000);
  assert.equal(f.calls.filter(call => call.op === "publish").length, 1);
  assert.equal(f.logs.length, 5);
});

test("persistent E404 times out as visibility, not integrity failure, and blocks selector", async t => {
  const f = await fixture(t, ({ op }) => op === "view" ? missing : undefined);
  await assert.rejects(publishQualifiedNpm(f.directory, f.options), error => {
    assert.match(error.message, /Registry visibility timed out after 300000ms/);
    assert.match(error.message, /retry only the identical qualified archive set/);
    assert.doesNotMatch(error.message, /integrity mismatch/);
    return true;
  });
  assert.equal(f.elapsed(), 300000);
  assert.equal(f.calls.filter(call => call.op === "publish").length, 1);
  assert.equal(f.logs.length, 0);
});

test("fractional monotonic clock values still produce valid integer npm/subprocess timeouts", async t => {
  const f = await fixture(t, ({ op, name, elapsed, advance }) => {
    if (op === "view" && name === names[0] && elapsed < 190000) {
      advance(0.25);
      return missing;
    }
  });
  await publishQualifiedNpm(f.directory, f.options);
  assert.ok(f.elapsed() >= 190000 && f.elapsed() < 195000);
  assert.equal(f.calls.filter(call => call.op === "publish").length, 1);
  assert.equal(f.logs.length, 5);
});

test("registry-query duration counts toward the five-minute visibility deadline", async t => {
  const f = await fixture(t, ({ op, calls, advance }) => {
    if (op !== "view") return;
    if (calls.some(call => call.op === "publish")) advance(12000);
    return missing;
  });
  await assert.rejects(publishQualifiedNpm(f.directory, f.options), /visibility timed out/);
  assert.equal(f.elapsed(), 300000);
  assert.ok(f.calls.filter(call => call.op === "view").at(-1).config.timeout < 12000);
});

test("different existing bytes stop immediately without publication", async t => {
  const f = await fixture(t, ({ op }) => op === "view" ? { status: 0, stdout: JSON.stringify("sha512-different"), stderr: "" } : undefined);
  await assert.rejects(publishQualifiedNpm(f.directory, f.options), /Immutable registry version has different bytes/);
  assert.equal(f.calls.filter(call => call.op === "publish").length, 0);
  assert.equal(f.waits.length, 0);
});

test("different post-upload bytes stop immediately, without waiting or further packages", async t => {
  const f = await fixture(t, ({ op, calls }) => op === "view"
    ? calls.some(call => call.op === "publish") ? { status: 0, stdout: JSON.stringify("sha512-different"), stderr: "" } : missing
    : undefined);
  await assert.rejects(publishQualifiedNpm(f.directory, f.options), /Public registry integrity mismatch/);
  assert.equal(f.calls.filter(call => call.op === "publish").length, 1);
  assert.equal(f.waits.length, 0);
});

test("only actual E404 means absence; other lookup errors stop with safe diagnostics", async t => {
  for (const code of ["E401", "E403", "E429", "ENETWORK"]) {
    await t.test(code, async t => {
      const f = await fixture(t, ({ op }) => op === "view"
        ? { status: 1, stdout: JSON.stringify({ error: { code, summary: `${secret} E404` } }), stderr: `${secret} E404` } : undefined);
      await assert.rejects(publishQualifiedNpm(f.directory, f.options), error => {
        assert.match(error.message, /Registry lookup failed/);
        assert.ok(error.message.includes(`code=${code}`));
        assert.ok(!error.message.includes(secret));
        return true;
      });
      assert.equal(f.calls.filter(call => call.op === "publish").length, 0);
      assert.equal(f.waits.length, 0);
    });
  }
});

test("invalid successful metadata is not treated as an unpublished version", async t => {
  for (const stdout of ["null", "{}", "\"\"", secret]) {
    await t.test(stdout === secret ? "non-JSON" : stdout, async t => {
      const f = await fixture(t, ({ op }) => op === "view" ? { status: 0, stdout, stderr: secret } : undefined);
      await assert.rejects(publishQualifiedNpm(f.directory, f.options), error => {
        assert.match(error.message, /Invalid registry integrity metadata/);
        assert.ok(!error.message.includes(secret));
        return true;
      });
      assert.equal(f.calls.filter(call => call.op === "publish").length, 0);
    });
  }
});

test("failed upload is never automatically retried and npm bodies remain private", async t => {
  const f = await fixture(t, ({ op }) => op === "view" ? missing : op === "publish"
    ? { status: 1, stdout: JSON.stringify({ error: { code: "E403", summary: secret } }), stderr: secret } : undefined);
  await assert.rejects(publishQualifiedNpm(f.directory, f.options), error => {
    assert.match(error.message, /npm publication failed.*code=E403.*no automatic upload retry/);
    assert.ok(!error.message.includes(secret));
    return true;
  });
  assert.equal(f.calls.filter(call => call.op === "publish").length, 1);
  assert.equal(f.waits.length, 0);
  assert.equal(f.logs.length, 0);
});
