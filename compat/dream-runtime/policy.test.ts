// [Input] Disposable private workspace, synthetic native headers and explicit environments.
// [Output] Deterministic fail-closed Notion/model policy and exact-source transform tests.
// [Pos] Provider-free mechanical validation; no credentials or operator settings are read.
// [Sync] 2026-09-13: verify original src remains byte-identical and deltas cannot be applied twice.

import { test, expect } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { explicitEffort, explicitPositiveInteger, notionBashEnvironment, notionProjection, NOTION_KEYS, stripNotionEnvironment } from "./policy.ts";
import { applyDreamSourceTransform, DREAM_SOURCE_TARGETS } from "./source-transforms.ts";

test("Notion is confined to validated native Bash children, never generic children", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ink-dream-policy-")));
  try {
    const workspace = join(root, "workspace");
    const home = join(workspace, ".notion-home");
    const bin = join(root, "bin");
    mkdirSync(home, { recursive: true, mode: 0o700 });
    chmodSync(home, 0o700);
    mkdirSync(bin);
    const executable = join(bin, "ntn");
    writeFileSync(executable, Buffer.from("7f454c4600000000", "hex"), { mode: 0o755 });
    const workers = join(home, "workers.json");
    writeFileSync(workers, "{}\n", { mode: 0o600 });
    const source = { PATH: bin, NOTION_HOME: home, NOTION_API_TOKEN: "fixture-token", NOTION_KEYRING: "1", NOTION_WORKERS_CONFIG_FILE: workers };
    const projected = notionProjection(workspace, source);
    expect(projected.environment).toEqual({ NOTION_HOME: home, NOTION_API_TOKEN: "fixture-token", NOTION_WORKERS_CONFIG_FILE: workers, NOTION_KEYRING: "0" });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("Notion rejects broad homes, symlinks, writable/script executables and partial injections", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ink-dream-policy-")));
  try {
    const workspace = join(root, "workspace");
    const home = join(workspace, ".notion-home");
    const bin = join(root, "bin");
    mkdirSync(home, { recursive: true, mode: 0o700 }); chmodSync(home, 0o700); mkdirSync(bin);
    const executable = join(bin, "ntn");
    writeFileSync(executable, Buffer.from("feedfacf00000000", "hex"), { mode: 0o755 });
    const source = { PATH: bin, NOTION_HOME: home, NOTION_API_TOKEN: "fixture-token", NOTION_KEYRING: "1" };
    expect(notionProjection(workspace, source).allowedDomains).toEqual(["api.notion.com:443", "developers.notion.com:443", "ntn.dev:443"]);
    expect(notionProjection(workspace, source).allowRead).toEqual([home, executable]);
    const candidate = { ...source, KEEP: "retained" };
    expect(stripNotionEnvironment(candidate)).toEqual({ PATH: bin, KEEP: "retained" });
    expect(candidate.NOTION_API_TOKEN).toBe("fixture-token");
    for (const key of NOTION_KEYS) expect({ ...candidate, ...stripNotionEnvironment(candidate) }[key]).toBeUndefined();
    expect(notionBashEnvironment({ PATH: bin, NOTION_API_TOKEN: "overlay-poison" }, workspace, source).NOTION_API_TOKEN).toBe("fixture-token");
    expect(notionBashEnvironment({ NOTION_API_TOKEN: "overlay-poison" }, workspace, source).NOTION_API_TOKEN).toBeUndefined();
    const shadow = join(root, "shadow"); mkdirSync(shadow);
    writeFileSync(join(shadow, "ntn"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    expect(notionBashEnvironment({ PATH: shadow + ":" + bin }, workspace, source).NOTION_API_TOKEN).toBeUndefined();
    expect(notionBashEnvironment({ PATH: ".:" + bin }, workspace, source).NOTION_API_TOKEN).toBeUndefined();
    for (const value of [undefined, root, home + "/", "relative"]) {
      expect(notionProjection(workspace, { ...source, NOTION_HOME: value }).environment).toEqual({});
    }
    chmodSync(home, 0o755); expect(notionProjection(workspace, source).environment).toEqual({}); chmodSync(home, 0o700);
    chmodSync(executable, 0o777); expect(notionProjection(workspace, source).environment).toEqual({}); chmodSync(executable, 0o755);
    writeFileSync(executable, "#!/bin/sh\nexit 0\n"); expect(notionProjection(workspace, source).environment).toEqual({});
    writeFileSync(executable, Buffer.from("feedfacf00000000", "hex"));
    expect(notionProjection(workspace, { ...source, NOTION_API_TOKEN: " token\n" }).environment.NOTION_API_TOKEN).toBeUndefined();
    expect(notionProjection(workspace, { ...source, NOTION_WORKERS_CONFIG_FILE: join(root, "workers.json") }).environment.NOTION_WORKERS_CONFIG_FILE).toBeUndefined();
    const alias = join(root, "alias"); symlinkSync(workspace, alias);
    expect(notionProjection(alias, { ...source, NOTION_HOME: join(alias, ".notion-home") }).environment).toEqual({});
    for (const key of NOTION_KEYS) expect(stripNotionEnvironment({ [key]: "poison" })[key]).toBeUndefined();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("model carriers are strict, optional, and independent of model names", () => {
  expect(explicitPositiveInteger(undefined, "limit")).toBeUndefined();
  for (const value of ["1", "1000", "128000"]) expect(explicitPositiveInteger(value, "limit")).toBe(Number(value));
  for (const value of ["", "0", "-1", "1.5", "1000x", "01", "9007199254740992"]) expect(() => explicitPositiveInteger(value, "limit")).toThrow();
  expect(explicitEffort(undefined)).toBeUndefined();
  expect(explicitEffort("auto")).toBeUndefined();
  expect(explicitEffort("unset")).toBeUndefined();
  for (const value of ["low", "medium", "high", "xhigh", "max"]) expect(explicitEffort(value)).toBe(value);
  expect(() => explicitEffort("invalid")).toThrow();
});

test("all six original targets have exact hashes, unique markers and valid transformed syntax", () => {
  const root = resolve(import.meta.dir, "../..");
  for (const target of DREAM_SOURCE_TARGETS) {
    const original = readFileSync(join(root, target.path), "utf8");
    expect(createHash("sha256").update(original).digest("hex")).toBe(target.sha256);
    const transformed = applyDreamSourceTransform(target.path, original);
    expect(() => new Bun.Transpiler({ loader: "ts" }).transformSync(transformed)).not.toThrow();
    expect(() => applyDreamSourceTransform(target.path, transformed)).toThrow();
    expect(readFileSync(join(root, target.path), "utf8")).toBe(original);
  }
});
