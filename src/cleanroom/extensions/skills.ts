// [Input] Canonical cwd/plugin directories and an explicit allowed Skill-name list.
// [Output] Separate bounded Skill definitions and Markdown content records.
// [Pos] Symlink-safe clean-room project/plugin Skill discovery boundary.
// [Sync] 2026-08-24: skip all Skill filesystem traversal when no Skill is explicitly allowlisted.

import { constants as fsConstants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { requireRealDirectory } from "../session/paths.ts";

const MAX_ENTRIES = 2_048;
const MAX_DEPTH = 12;
const MAX_SKILLS = 128;
const MAX_SKILL_BYTES = 65_536;
const MAX_TOTAL_SKILL_BYTES = 1_048_576;
const MAX_FRONTMATTER_BYTES = 4_096;
const SKILL_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export interface SkillDefinition {
  description: string;
  name: string;
  source: "plugin" | "project";
}

export interface SkillContent {
  markdown: string;
  name: string;
  source: "plugin" | "project";
}

export interface SkillCatalog {
  content: Readonly<Record<string, SkillContent>>;
  definitions: readonly SkillDefinition[];
}

interface Candidate {
  file: string;
  root: string;
  source: SkillDefinition["source"];
}

interface WalkBudget {
  entries: number;
  skills: number;
  totalBytes: number;
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function validateSkillName(value: string, label = "Skill name"): string {
  if (
    value !== value.trim() ||
    value !== value.normalize("NFC") ||
    !SKILL_NAME_PATTERN.test(value)
  ) {
    throw new Error(`${label} must use 1-64 letters, digits, dot, underscore, or dash`);
  }
  return value;
}

function decodeScalar(raw: string, key: string): string {
  const value = raw.trim();
  if (!value) throw new Error(`Skill frontmatter ${key} must not be empty`);
  let decoded: string;
  if (value.startsWith('"')) {
    try {
      decoded = JSON.parse(value) as string;
    } catch {
      throw new Error(`Skill frontmatter ${key} contains an invalid quoted string`);
    }
    if (typeof decoded !== "string") {
      throw new Error(`Skill frontmatter ${key} must be a string`);
    }
  } else if (value.startsWith("'")) {
    if (!value.endsWith("'") || value.length < 2) {
      throw new Error(`Skill frontmatter ${key} contains an invalid quoted string`);
    }
    decoded = value.slice(1, -1).replaceAll("''", "'");
  } else {
    if (/^[\[{&*!|>@`]/.test(value) || /[\r\n\0]/.test(value)) {
      throw new Error(`Skill frontmatter ${key} uses unsupported YAML syntax`);
    }
    decoded = value;
  }
  if (
    decoded !== decoded.normalize("NFC") ||
    /[\0-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(decoded)
  ) {
    throw new Error(`Skill frontmatter ${key} contains invalid characters`);
  }
  return decoded;
}

export function parseSkillDocument(document: string): {
  definition: Omit<SkillDefinition, "source">;
  markdown: string;
} {
  if (document.includes("\0")) throw new Error("Skill file contains a NUL byte");
  const normalized = document.replaceAll("\r\n", "\n");
  if (!normalized.startsWith("---\n")) {
    throw new Error("Skill file must begin with restricted YAML frontmatter");
  }
  const closing = normalized.indexOf("\n---\n", 4);
  if (closing < 0 || closing > MAX_FRONTMATTER_BYTES) {
    throw new Error("Skill frontmatter is missing or exceeds 4 KiB");
  }
  const values = new Map<string, string>();
  for (const line of normalized.slice(4, closing).split("\n")) {
    if (!line.trim()) continue;
    const separator = line.indexOf(":");
    if (separator <= 0) throw new Error("Skill frontmatter must use key: string lines");
    const key = line.slice(0, separator).trim();
    if (key !== "name" && key !== "description") {
      throw new Error(`Skill frontmatter key is not allowed: ${key}`);
    }
    if (values.has(key)) throw new Error(`Skill frontmatter repeats ${key}`);
    values.set(key, decodeScalar(line.slice(separator + 1), key));
  }
  const name = validateSkillName(values.get("name") ?? "");
  const description = values.get("description") ?? "";
  if (!description || description.length > 512) {
    throw new Error("Skill description must contain 1-512 characters");
  }
  const markdown = normalized.slice(closing + 5);
  if (!markdown.trim()) throw new Error("Skill Markdown content must not be empty");
  return { definition: { name, description }, markdown };
}

async function readSkillFile(file: string, root: string, budget: WalkBudget): Promise<string> {
  if (!isInside(root, file)) throw new Error("Skill path escaped its declared root");
  const status = await lstat(file);
  if (!status.isFile() || status.isSymbolicLink()) {
    throw new Error("SKILL.md must be a real regular file, not a symlink");
  }
  if (status.size > MAX_SKILL_BYTES) throw new Error("SKILL.md exceeds the 64 KiB limit");
  budget.totalBytes += status.size;
  if (budget.totalBytes > MAX_TOTAL_SKILL_BYTES) {
    throw new Error("selected Skill files exceed the 1 MiB aggregate limit");
  }
  const resolved = await realpath(file);
  if (resolved !== file || !isInside(root, resolved)) {
    throw new Error("Skill path contains a symlink or escaped its declared root");
  }
  const handle = await open(file, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.size !== status.size) {
      throw new Error("SKILL.md changed while it was being opened");
    }
    const bytes = await handle.readFile();
    if (bytes.byteLength > MAX_SKILL_BYTES) throw new Error("SKILL.md exceeds the 64 KiB limit");
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } finally {
    await handle.close();
  }
}

async function walkForSkills(input: {
  budget: WalkBudget;
  candidates: Candidate[];
  directory: string;
  insideSkills: boolean;
  root: string;
  source: Candidate["source"];
  depth?: number;
}): Promise<void> {
  const depth = input.depth ?? 0;
  if (depth > MAX_DEPTH) throw new Error("Skill discovery exceeded the maximum depth");
  if (!isInside(input.root, input.directory)) throw new Error("Skill traversal escaped its root");
  const resolved = await realpath(input.directory);
  if (resolved !== input.directory || !isInside(input.root, resolved)) {
    throw new Error("Skill directory contains a symlink or escaped its root");
  }
  const entries = await readdir(input.directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
  for (const entry of entries) {
    input.budget.entries += 1;
    if (input.budget.entries > MAX_ENTRIES) {
      throw new Error("Skill discovery exceeded the entry limit");
    }
    const child = path.join(input.directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error("Skill discovery rejects symlinks");
    if (entry.isDirectory()) {
      await walkForSkills({
        ...input,
        directory: child,
        insideSkills: input.insideSkills || entry.name === "skills",
        depth: depth + 1,
      });
      continue;
    }
    if (entry.isFile() && input.insideSkills && entry.name === "SKILL.md") {
      input.budget.skills += 1;
      if (input.budget.skills > MAX_SKILLS) {
        throw new Error("Skill discovery exceeded the 128-file limit");
      }
      input.candidates.push({ file: child, root: input.root, source: input.source });
    }
  }
}

export async function loadSkillCatalog(input: {
  allowedSkills: readonly string[];
  cwd: string;
  pluginDirectories?: readonly string[];
}): Promise<SkillCatalog> {
  if (!Array.isArray(input.allowedSkills)) {
    throw new Error("an explicit Skill allowlist is required");
  }
  const allowed = new Set(input.allowedSkills.map((name) => validateSkillName(name, "allowed Skill")));
  if (allowed.size !== input.allowedSkills.length) {
    throw new Error("Skill allowlist contains duplicate names");
  }
  if (allowed.size === 0) {
    return { definitions: Object.freeze([]), content: Object.freeze({}) };
  }
  const cwd = await requireRealDirectory("cwd", input.cwd);
  const candidates: Candidate[] = [];
  const budget: WalkBudget = { entries: 0, skills: 0, totalBytes: 0 };
  const projectRoot = path.join(cwd, ".claude", "skills");
  const projectStatus = await lstat(projectRoot).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (projectStatus) {
    await requireRealDirectory("project skills directory", projectRoot);
    await walkForSkills({
      budget,
      candidates,
      directory: projectRoot,
      insideSkills: true,
      root: projectRoot,
      source: "project",
    });
  }

  for (const rawPluginRoot of input.pluginDirectories ?? []) {
    const pluginRoot = await requireRealDirectory("--plugin-dir", rawPluginRoot);
    await walkForSkills({
      budget,
      candidates,
      directory: pluginRoot,
      insideSkills: path.basename(pluginRoot) === "skills",
      root: pluginRoot,
      source: "plugin",
    });
  }

  const definitions: SkillDefinition[] = [];
  const content: Record<string, SkillContent> = Object.create(null) as Record<string, SkillContent>;
  const discovered = new Set<string>();
  for (const candidate of candidates) {
    const parsed = parseSkillDocument(
      await readSkillFile(candidate.file, candidate.root, budget),
    );
    if (discovered.has(parsed.definition.name)) {
      throw new Error(`duplicate Skill name: ${parsed.definition.name}`);
    }
    discovered.add(parsed.definition.name);
    if (!allowed.has(parsed.definition.name)) continue;
    definitions.push({ ...parsed.definition, source: candidate.source });
    content[parsed.definition.name] = {
      name: parsed.definition.name,
      markdown: parsed.markdown,
      source: candidate.source,
    };
  }
  const missing = [...allowed].filter((name) => !Object.hasOwn(content, name));
  if (missing.length > 0) throw new Error(`allowed Skill was not found: ${missing.join(", ")}`);
  definitions.sort((left, right) => left.name.localeCompare(right.name, "en"));
  return { definitions, content };
}
