// [Input] Checked-in target/version policy and an explicit isolated package/install tree.
// [Output] Exact native dependency maps and a self-contained Bun image dependency probe.
// [Pos] Shared npm staging, archive and installation dependency contract; no Runtime behavior.

import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";

export function platformRuntimeDependencies(policy, target) {
  const platform = policy.platforms?.[target];
  const image = policy.imageProcessing;
  if (!platform || !["darwin", "linux"].includes(platform.os) ||
      !["arm64", "x64"].includes(platform.cpu) || target !== `${platform.os}-${platform.cpu}` ||
      policy.bun?.package !== "bun" || !/^\d+\.\d+\.\d+$/.test(policy.bun?.version ?? "") ||
      !/^\d+\.\d+\.\d+$/.test(image?.sharpVersion ?? "") ||
      !/^\d+\.\d+\.\d+$/.test(image?.libvipsVersion ?? "")) {
    throw new Error("invalid npm Runtime dependency policy/target");
  }
  return {
    [policy.bun.package]: policy.bun.version,
    [`@img/sharp-${target}`]: image.sharpVersion,
    [`@img/sharp-libvips-${target}`]: image.libvipsVersion,
  };
}

export function dependenciesMatch(actual, expected) {
  return actual !== null && typeof actual === "object" && !Array.isArray(actual) &&
    Object.keys(actual).length === Object.keys(expected).length &&
    Object.entries(expected).every(([name, version]) => Object.hasOwn(actual, name) && actual[name] === version);
}

export function platformDependenciesMatch(pkg, expected) {
  // npm optionalDependencies override same-named required dependencies.
  return dependenciesMatch(pkg.dependencies, expected) &&
    (pkg.optionalDependencies === undefined || dependenciesMatch(pkg.optionalDependencies, {}));
}

// This function is serialized into prepack and executed by Bun, never by the Node parent.
export function nativeImageProbe(config, require) {
  const fs = require("node:fs");
  const path = require("node:path");
  const { createRequire } = require("node:module");
  const root = fs.realpathSync(config.dependencyRoot);
  function contained(file, boundary = root) {
    const resolved = fs.realpathSync(file);
    const relative = path.relative(boundary, resolved);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error("npm image dependency resolved outside isolated tree");
    }
    return resolved;
  }
  const coreRoot = contained(config.coreRoot);
  const core = contained(config.corePath, coreRoot);
  if (!fs.statSync(core).isFile()) throw new Error("npm image probe core anchor is not a file");
  const r = createRequire(core);
  const [os, cpu] = config.target.split("-");
  if (process.platform !== os || process.arch !== cpu) throw new Error("npm image probe target mismatch");
  const sharpName = `@img/sharp-${config.target}`;
  const vipsName = `@img/sharp-libvips-${config.target}`;
  for (const name of [sharpName, vipsName]) {
    const metadata = r(contained(r.resolve(`${name}/package`)));
    if (metadata.name !== name || metadata.version !== config.expected[name] ||
        metadata.os?.length !== 1 || metadata.os[0] !== os ||
        metadata.cpu?.length !== 1 || metadata.cpu[0] !== cpu) {
      throw new Error("npm image dependency metadata mismatch");
    }
  }
  // Resolve every export before loading native code so tree escapes cannot pass the probe.
  const nativePath = contained(r.resolve(`${sharpName}/sharp.node`));
  const versionsPath = contained(r.resolve(`${vipsName}/versions`));
  const libExport = contained(r.resolve(`${vipsName}/lib`));
  const libDirectory = contained(r(libExport));
  const visited = new Set();
  function checkLibraries(file) {
    const resolved = contained(file);
    if (visited.has(resolved)) return;
    visited.add(resolved);
    if (fs.statSync(resolved).isDirectory()) {
      for (const child of fs.readdirSync(resolved)) checkLibraries(path.join(resolved, child));
    }
  }
  checkLibraries(libDirectory);
  const native = r(nativePath);
  const versions = r(versionsPath);
  const loadedVips = native.libvipsVersion();
  const vipsVersion = loadedVips.semver;
  if (loadedVips.isGlobal || loadedVips.isWasm || typeof vipsVersion !== "string" || !vipsVersion || versions.vips !== vipsVersion) {
    throw new Error("npm image native libvips version mismatch");
  }
  return { status: "native-image-dependencies-verified", target: config.target,
    sharpVersion: config.expected[sharpName], libvipsPackageVersion: config.expected[vipsName], vipsVersion };
}

export function probeNativeImageDependencies(config) {
  const root = realpathSync(config.dependencyRoot);
  const bun = realpathSync(config.bunPath);
  const relative = path.relative(root, bun);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Bun resolved outside isolated dependency tree");
  }
  const version = spawnSync(bun, ["--version"], { encoding: "utf8", timeout: 30_000 });
  if (version.status !== 0 || version.stdout.trim() !== config.expected.bun) throw new Error("exact Bun dependency version mismatch");
  const program = `process.stdout.write(JSON.stringify((${nativeImageProbe.toString()})(${JSON.stringify(config)},require))+'\\n')`;
  const probe = spawnSync(bun, ["-e", program], { encoding: "utf8", timeout: 30_000 });
  if (probe.status !== 0) throw new Error(`Bun native image dependency probe failed: ${probe.stderr}`);
  return JSON.parse(probe.stdout);
}
