#!/usr/bin/env node
// [Input] Clean-room session/extensions TypeScript and disposable provider-free filesystem fixtures.
// [Output] Evidence for path confinement, JSONL resume/fork, Skill allowlisting, and pure hook selection.
// [Pos] Provider-free contract test for the second clean-room Runtime slice.
// [Sync] 2026-08-24: prove an empty Skill allowlist avoids unrelated materialized symlink traversal.

import assert from "node:assert/strict";
import { chmod, lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  openSession,
  validateClaudeCodeTmpdir,
  validateSessionId,
} from "../src/cleanroom/session/index.ts";
import {
  loadSkillCatalog,
  normalizeHookConfiguration,
  parseSkillDocument,
  selectHookCallbackIds,
} from "../src/cleanroom/extensions/index.ts";

const SESSION_A = "018f0f5e-7b8d-7c1a-8a2b-1234567890ab";
const SESSION_B = "018f0f5e-7b8d-7c1a-8a2b-1234567890ac";

async function fixture(t) {
  const created = await mkdtemp(path.join(os.tmpdir(), "ink-cleanroom-session-"));
  const root = await realpath(created);
  t.after(() => rm(root, { recursive: true, force: true }));
  const cwd = path.join(root, "workspace");
  const configDir = path.join(root, "actor-config");
  const tmpdir = path.join(cwd, ".claude-tmp");
  await mkdir(tmpdir, { recursive: true, mode: 0o700 });
  await chmod(tmpdir, 0o700);
  return { configDir, cwd, root, tmpdir };
}

async function writeSkill(file, name, description, markdown = `# ${name}\n\nBody\n`) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(
    file,
    `---\nname: ${name}\ndescription: ${description}\n---\n${markdown}`,
    { mode: 0o600 },
  );
}

test("session store keeps one private JSONL transcript and supports resume/fork", async (t) => {
  const f = await fixture(t);
  assert.equal(await validateClaudeCodeTmpdir(f), f.tmpdir);

  const fresh = await openSession({
    configDir: f.configDir,
    cwd: f.cwd,
    sessionId: SESSION_A.toUpperCase(),
  });
  assert.equal(fresh.transcript.id, SESSION_A);
  assert.deepEqual(fresh.history, []);
  assert.equal(path.extname(fresh.transcript.file), ".jsonl");
  assert.equal(path.relative(f.configDir, fresh.transcript.file).startsWith(".."), false);
  assert.equal((await lstat(path.dirname(fresh.transcript.file))).mode & 0o777, 0o700);
  assert.equal((await lstat(fresh.transcript.file)).mode & 0o777, 0o600);

  await Promise.all([
    fresh.transcript.appendMessage("user", "first"),
    fresh.transcript.appendMessage("assistant", [{ type: "text", text: "answer" }]),
  ]);
  const firstBytes = await readFile(fresh.transcript.file, "utf8");
  assert(firstBytes.endsWith("\n"));
  assert.equal(firstBytes.trimEnd().split("\n").length, 2);
  const stored = firstBytes.trimEnd().split("\n").map(JSON.parse);
  assert.equal(stored[0].type, "user");
  assert.equal(stored[0].message.role, "user");
  assert.equal(stored[0].message.content, "first");
  assert.equal(typeof stored[0].uuid, "string");
  assert.equal(stored[0].parentUuid, null);
  assert.equal(stored[1].parentUuid, stored[0].uuid);
  assert.equal(stored[1].sessionId, SESSION_A);

  const resumed = await openSession({ configDir: f.configDir, cwd: f.cwd, resume: SESSION_A });
  assert.equal(resumed.transcript.id, SESSION_A);
  assert.deepEqual(resumed.history.map((record) => record.role), ["user", "assistant"]);
  assert.equal(resumed.history[0].content, "first");

  const forked = await openSession({
    configDir: f.configDir,
    cwd: f.cwd,
    resume: SESSION_A,
    forkSession: true,
    generateId: () => SESSION_B,
  });
  assert.equal(forked.transcript.id, SESSION_B);
  assert.deepEqual(forked.history, resumed.history);
  assert.notEqual(forked.transcript.file, resumed.transcript.file);
  await forked.transcript.appendMessage("user", "fork-only");
  assert.equal((await resumed.transcript.readMessages()).length, 2);
  assert.equal((await forked.transcript.readMessages()).length, 3);

  await assert.rejects(
    openSession({ configDir: f.configDir, cwd: f.cwd, sessionId: SESSION_A }),
    /already exists/,
  );
  await assert.rejects(
    openSession({ configDir: f.configDir, cwd: f.cwd, resume: "../../escape" }),
    /canonical UUID/,
  );
  assert.throws(() => validateSessionId("not-a-uuid"), /canonical UUID/);
});

test("config and CLAUDE_CODE_TMPDIR reject aliases, symlinks, escape, and broad modes", async (t) => {
  const f = await fixture(t);
  const other = path.join(f.cwd, "nested", ".claude-tmp");
  await mkdir(other, { recursive: true, mode: 0o700 });
  await chmod(other, 0o700);
  await assert.rejects(validateClaudeCodeTmpdir({ cwd: f.cwd, tmpdir: other }), /exact/);

  await chmod(f.tmpdir, 0o755);
  await assert.rejects(validateClaudeCodeTmpdir(f), /0700/);
  await chmod(f.tmpdir, 0o700);

  const linkedConfig = path.join(f.root, "linked-config");
  await mkdir(f.configDir, { mode: 0o700 });
  await symlink(f.configDir, linkedConfig, "dir");
  await assert.rejects(
    openSession({ configDir: linkedConfig, cwd: f.cwd, sessionId: SESSION_A }),
    /real directory|symlink/,
  );
  await assert.rejects(
    openSession({ configDir: "relative-config", cwd: f.cwd, sessionId: SESSION_A }),
    /absolute normalized/,
  );
});

test("project and plugin Skills require an explicit allowlist and keep definitions separate", async (t) => {
  const f = await fixture(t);
  const projectSkill = path.join(f.cwd, ".claude", "skills", "project-one", "SKILL.md");
  const ignoredSkill = path.join(f.cwd, ".claude", "skills", "ignored", "SKILL.md");
  const pluginRoot = path.join(f.root, "plugin");
  const pluginSkill = path.join(pluginRoot, "bundle", "skills", "plugin-one", "SKILL.md");
  await writeSkill(projectSkill, "project-one", "Project skill");
  await writeSkill(ignoredSkill, "ignored", "Not allowlisted");
  await writeSkill(pluginSkill, "plugin-one", '"Plugin: skill"', "# Plugin\n\nSecret body\n");

  const catalog = await loadSkillCatalog({
    cwd: f.cwd,
    pluginDirectories: [pluginRoot],
    allowedSkills: ["plugin-one", "project-one"],
  });
  assert.deepEqual(
    catalog.definitions.map(({ name, description, source }) => ({ name, description, source })),
    [
      { name: "plugin-one", description: "Plugin: skill", source: "plugin" },
      { name: "project-one", description: "Project skill", source: "project" },
    ],
  );
  assert.equal(Object.hasOwn(catalog.content, "ignored"), false);
  assert.match(catalog.content["plugin-one"].markdown, /Secret body/);
  assert.equal(JSON.stringify(catalog.definitions).includes("Secret body"), false);

  await assert.rejects(
    loadSkillCatalog({ cwd: f.cwd, pluginDirectories: [pluginRoot], allowedSkills: ["missing"] }),
    /was not found/,
  );
  assert.throws(
    () => parseSkillDocument("---\nname: bad\ndescription: okay\nextra: no\n---\nbody"),
    /not allowed/,
  );
});

test("Skill discovery rejects symlinks and oversized files", async (t) => {
  const f = await fixture(t);
  const skills = path.join(f.cwd, ".claude", "skills");
  const external = path.join(f.root, "external-skill.md");
  await writeSkill(external, "escaped", "Escaped skill");
  await mkdir(path.join(skills, "escaped"), { recursive: true });
  await symlink(external, path.join(skills, "escaped", "SKILL.md"));
  const unused = await loadSkillCatalog({ cwd: f.cwd, allowedSkills: [] });
  assert.deepEqual(unused.definitions, []);
  assert.deepEqual(Object.keys(unused.content), []);
  await assert.rejects(
    loadSkillCatalog({ cwd: f.cwd, allowedSkills: ["escaped"] }),
    /symlink/,
  );
  await rm(path.join(skills, "escaped"), { recursive: true, force: true });

  const large = path.join(skills, "large", "SKILL.md");
  await writeSkill(large, "large", "Large skill", "x".repeat(70_000));
  await assert.rejects(
    loadSkillCatalog({ cwd: f.cwd, allowedSkills: ["large"] }),
    /64 KiB/,
  );
});

test("initialize hook matching is pure, bounded, ordered, and de-duplicated", () => {
  const raw = {
    PreToolUse: [
      { matcher: "^(Bash|Write)$", hookCallbackIds: ["policy", "audit"], timeout: 2 },
      { matcher: "Bash", hookCallbackIds: ["audit", "artifact"] },
      { hookCallbackIds: ["always"] },
    ],
    Stop: [{ hookCallbackIds: ["finish"] }],
  };
  const before = structuredClone(raw);
  const hooks = normalizeHookConfiguration(raw);
  assert.deepEqual(raw, before);
  assert.equal(hooks.PreToolUse[0].timeoutMs, 2_000);
  assert.deepEqual(selectHookCallbackIds(hooks, "PreToolUse", "Bash"), [
    "policy",
    "audit",
    "artifact",
    "always",
  ]);
  assert.deepEqual(selectHookCallbackIds(hooks, "PreToolUse", "Read"), ["always"]);
  assert.deepEqual(selectHookCallbackIds(hooks, "Stop", ""), ["finish"]);
  assert.deepEqual(normalizeHookConfiguration(null), {});
  assert.throws(
    () => normalizeHookConfiguration({ PreToolUse: [{ matcher: "(?=Bash)", hookCallbackIds: ["x"] }] }),
    /unsupported regex/,
  );
});
