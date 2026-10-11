// [Input] Disposable private workspace, synthetic native headers and explicit environments.
// [Output] Deterministic fail-closed Notion/model policy and exact-source transform tests.
// [Pos] Provider-free mechanical validation; no credentials or operator settings are read.
// [Sync] 2026-09-13: verify original src remains byte-identical and deltas cannot be applied twice.
// [Sync] 2026-10-11: exercise compact image copies, current materials, completion guards and all ten exact source targets.

import { test, expect } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { bindCompactSummaryRequest, compactCompletionOutput, explicitEffort, explicitPositiveInteger, nativeImageCompactMessage, notionBashEnvironment, notionProjection, NOTION_KEYS, stripNotionEnvironment, withCompactInputContext } from "./policy.ts";
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

test("all original targets have exact hashes, unique markers and valid transformed syntax", () => {
  const root = resolve(import.meta.dir, "../..");
  for (const target of DREAM_SOURCE_TARGETS) {
    const original = readFileSync(join(root, target.path), "utf8");
    expect(createHash("sha256").update(original).digest("hex")).toBe(target.sha256);
    const transformed = applyDreamSourceTransform(target.path, original);
    expect(() => new Bun.Transpiler({ loader: target.path.endsWith(".tsx") ? "tsx" : "ts" }).transformSync(transformed)).not.toThrow();
    expect(() => applyDreamSourceTransform(target.path, transformed)).toThrow();
    expect(readFileSync(join(root, target.path), "utf8")).toBe(original);
  }
});

test("native compact copies omit binaries/protocol pairs while retaining actual IDs and ordinary blocks", () => {
  const text = Object.freeze({ type: "text", text: "The original image was blue." });
  const tool = Object.freeze({ type: "tool_use", id: "bash_actual", name: "Bash", input: { command: "pwd" } });
  const source = Object.freeze({ type: "base64", media_type: "image/png", data: "large-binary-fixture" });
  const original = Object.freeze({ type: "assistant", uuid: "assistant_actual", message: Object.freeze({
    content: Object.freeze([text, Object.freeze({ type: "server_tool_use", name: "image_generation", id: "ig_actual", gateway_request_id: "req_actual" }),
      Object.freeze({ type: "image_generation_tool_result", tool_use_id: "ig_actual", response_id: "resp_actual", gateway_request_id: "req_actual", content: [{ type: "image", source }] }), tool]),
  }) });
  const before = JSON.stringify(original), projected = nativeImageCompactMessage(original);
  expect(JSON.stringify(original)).toBe(before);
  expect(projected).not.toBe(original);
  expect(projected.uuid).toBe(original.uuid);
  expect(projected.message.content[0]).toBe(text);
  expect(projected.message.content[3]).toBe(tool);
  const encoded = JSON.stringify(projected);
  for (const value of ["ig_actual", "req_actual", "resp_actual"]) expect(encoded).toContain(value);
  for (const value of [source.data, "server_tool_use", "image_generation_tool_result"]) expect(encoded).not.toContain(value);
  expect(nativeImageCompactMessage(projected)).toBe(projected);
  for (const message of [{ type: "user", message: { content: [tool] } }, { type: "assistant", message: { content: [text, tool] } }]) {
    expect(nativeImageCompactMessage(message)).toBe(message);
  }
});

test("compact request carries current processed materials without changing history, UUID or original inputs", () => {
  const history = Object.freeze([{ uuid: "old_parent" }]);
  const context = Object.freeze({ messages: history, abortController: new AbortController() });
  const marker = Object.freeze({ type: "text", text: "[Ink image materials: turn_current message_current]" });
  const image = Object.freeze({ type: "image", source: { type: "base64", media_type: "image/png", data: "current-only" } });
  const label = Object.freeze({ type: "text", text: "Reference image for editing: file:current" });
  const input = Object.freeze({ type: "user", uuid: "command_actual", message: Object.freeze({ content: Object.freeze([marker, image, label, { type: "text", text: "<command-name>/compact</command-name>" }]) }) });
  const bound = withCompactInputContext(context, input);
  expect(bound).not.toBe(context);
  expect(bound.messages).toBe(history);
  expect(bound.abortController).toBe(context.abortController);
  const request = Object.freeze({ type: "user", uuid: "summary_actual", message: Object.freeze({ content: "Summarize the actual conversation." }) });
  const summary = bindCompactSummaryRequest(request, bound) as unknown as { uuid: string; message: { content: unknown[] } };
  expect(summary.uuid).toBe(request.uuid);
  expect(summary.message.content).toEqual([marker, image, label, { type: "text", text: request.message.content }]);
  expect(summary.message.content[1]).toBe(image);
  expect(request.message.content).toBe("Summarize the actual conversation.");
  expect(bindCompactSummaryRequest(request, context)).toBe(request);
  expect(JSON.stringify(context)).not.toContain("turn_current");
  expect(JSON.stringify(summary)).not.toContain("<command-name>");
  for (const content of [[], [{ type: "text", text: "/compact" }], [marker, marker, { type: "text", text: "/compact" }]]) {
    expect(withCompactInputContext(context, { type: "user", message: { content } })).toBe(context);
  }
});

test("compact feedback requires this command's actual boundary and one nonempty stdout", () => {
  const boundary = { type: "system", subtype: "compact_boundary", uuid: "actual_boundary" };
  const stdout = { type: "user", uuid: "actual_stdout", message: { content: "<local-command-stdout>Compacted successfully</local-command-stdout>" } };
  expect(compactCompletionOutput([boundary, stdout], [])).toEqual({ content: stdout.message.content, uuid: stdout.uuid });
  for (const messages of [[stdout], [boundary], [boundary, stdout, stdout],
    [boundary, { ...stdout, message: { content: "<local-command-stdout>  </local-command-stdout>" } }],
    [boundary, { ...stdout, message: { content: "<local-command-stderr>Compaction canceled</local-command-stderr>" } }],
    [{ type: "result", subtype: "success" }, stdout]]) {
    expect(compactCompletionOutput(messages, [])).toBeUndefined();
  }
  const oldStdout = { ...stdout, uuid: "previous_stdout" };
  const previous = Object.freeze([oldStdout, { ...boundary, uuid: "previous_boundary" }]);
  expect(compactCompletionOutput([boundary, oldStdout, stdout], previous)).toEqual({ content: stdout.message.content, uuid: stdout.uuid });
  expect(compactCompletionOutput([boundary, oldStdout], previous)).toBeUndefined();
  expect(compactCompletionOutput([...previous, stdout], previous)).toBeUndefined();
});
