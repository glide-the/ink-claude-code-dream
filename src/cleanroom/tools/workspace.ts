// [Input] Configured cwd and untrusted model-generated path strings.
// [Output] Canonical paths proven to remain inside the Workspace root.
// [Pos] Shared filesystem confinement boundary for every clean-room file tool.
// [Sync] 2026-08-24: reject lexical traversal, NULs, and symlink escape for reads and writes.

import { constants } from "node:fs";
import { access, lstat, realpath, stat } from "node:fs/promises";
import path from "node:path";

const MISSING_CODES = new Set(["ENOENT", "ENOTDIR"]);

function errorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

export class WorkspaceBoundaryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceBoundaryError";
  }
}

export class WorkspaceBoundary {
  readonly root: string;

  private constructor(root: string) {
    this.root = root;
  }

  static async create(cwd: string): Promise<WorkspaceBoundary> {
    if (!cwd || cwd.includes("\0")) {
      throw new WorkspaceBoundaryError("Workspace cwd must be a non-empty path");
    }
    const canonical = await realpath(path.resolve(cwd));
    const metadata = await stat(canonical);
    if (!metadata.isDirectory()) {
      throw new WorkspaceBoundaryError("Workspace cwd must resolve to a directory");
    }
    return new WorkspaceBoundary(canonical);
  }

  contains(candidate: string): boolean {
    const relative = path.relative(this.root, candidate);
    return relative === "" || (!relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative));
  }

  lexical(rawPath: string, fallback = "."): string {
    const normalized = rawPath || fallback;
    if (normalized.includes("\0")) {
      throw new WorkspaceBoundaryError("Workspace path contains a NUL byte");
    }
    const candidate = path.resolve(this.root, normalized);
    if (!this.contains(candidate)) {
      throw new WorkspaceBoundaryError("Workspace path escapes the canonical cwd");
    }
    return candidate;
  }

  async resolveExisting(rawPath: string, kind: "file" | "directory" | "any" = "any"): Promise<string> {
    const candidate = this.lexical(rawPath);
    const canonical = await realpath(candidate).catch((error: unknown) => {
      throw new WorkspaceBoundaryError(
        MISSING_CODES.has(errorCode(error) ?? "")
          ? "Workspace path does not exist"
          : "Workspace path cannot be resolved",
      );
    });
    if (!this.contains(canonical)) {
      throw new WorkspaceBoundaryError("Workspace symlink resolves outside the canonical cwd");
    }
    const metadata = await stat(canonical);
    if (kind === "file" && !metadata.isFile()) {
      throw new WorkspaceBoundaryError("Workspace path is not a regular file");
    }
    if (kind === "directory" && !metadata.isDirectory()) {
      throw new WorkspaceBoundaryError("Workspace path is not a directory");
    }
    return canonical;
  }

  async resolveWrite(rawPath: string): Promise<string> {
    const candidate = this.lexical(rawPath);
    if (candidate === this.root) {
      throw new WorkspaceBoundaryError("Workspace root cannot be replaced by a file");
    }

    try {
      const targetMetadata = await lstat(candidate);
      if (targetMetadata.isSymbolicLink()) {
        throw new WorkspaceBoundaryError("Refusing to replace a symbolic-link target");
      }
      if (targetMetadata.isDirectory()) {
        throw new WorkspaceBoundaryError("Workspace write target is a directory");
      }
    } catch (error: unknown) {
      if (error instanceof WorkspaceBoundaryError) throw error;
      if (!MISSING_CODES.has(errorCode(error) ?? "")) {
        throw new WorkspaceBoundaryError("Workspace write target cannot be inspected");
      }
    }

    const relativeParts = path.relative(this.root, path.dirname(candidate)).split(path.sep).filter(Boolean);
    let existing = this.root;
    let firstMissing = relativeParts.length;
    for (let index = 0; index < relativeParts.length; index += 1) {
      const next = path.join(existing, relativeParts[index]);
      try {
        await access(next, constants.F_OK);
        const canonical = await realpath(next);
        if (!this.contains(canonical)) {
          throw new WorkspaceBoundaryError("Workspace parent symlink resolves outside the canonical cwd");
        }
        const metadata = await stat(canonical);
        if (!metadata.isDirectory()) {
          throw new WorkspaceBoundaryError("Workspace write parent is not a directory");
        }
        existing = canonical;
      } catch (error: unknown) {
        if (error instanceof WorkspaceBoundaryError) throw error;
        if (!MISSING_CODES.has(errorCode(error) ?? "")) {
          throw new WorkspaceBoundaryError("Workspace write parent cannot be resolved");
        }
        firstMissing = index;
        break;
      }
    }

    const physicalParent = path.join(existing, ...relativeParts.slice(firstMissing));
    if (!this.contains(physicalParent)) {
      throw new WorkspaceBoundaryError("Workspace write parent escapes the canonical cwd");
    }
    return path.join(physicalParent, path.basename(candidate));
  }
}
