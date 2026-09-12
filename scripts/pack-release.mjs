// [Input] Consume a checksum-verified release directory, fixed SOURCE_DATE_EPOCH, and pinned archive Node/zlib toolchain.
// [Output] Create a deterministic tar.gz with sorted entries, fixed metadata/gzip header, and SHA-256 sidecar.
// [Pos] Reproducible archive packer; the external Claude core is intentionally absent.
// [Sync] 2026-09-13: bind deterministic archive names to Runtime 0.1.7.

import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import { pack as createTarPack } from "tar-stream";

const releaseRoot = resolve("dist/release/ink-claude-code-dream-0.1.7");
const releaseId = basename(releaseRoot);
const archive = resolve("dist/ink-claude-code-dream-0.1.7.tar.gz");
const packageJson = JSON.parse(await readFile(resolve("package.json"), "utf8"));
const requiredNode = packageJson.inkBuild?.archiveNode;
if (!requiredNode || process.versions.node !== requiredNode) {
  throw new Error(
    `archive packing requires Node ${requiredNode || "<missing pin>"}; received ${process.versions.node}`,
  );
}
const epochSeconds = Number(process.env.SOURCE_DATE_EPOCH || "1787443200");
if (!Number.isSafeInteger(epochSeconds) || epochSeconds <= 0) {
  throw new Error("SOURCE_DATE_EPOCH must be a positive integer");
}

async function filesUnder(root) {
  const results = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const absolute = join(root, entry.name);
    if (entry.isDirectory()) results.push(...(await filesUnder(absolute)));
    else if (entry.isFile()) results.push(absolute);
  }
  return results;
}

const tarPack = createTarPack();
const gzip = createGzip({ level: 9, mtime: 0 });
const pipelinePromise = pipeline(tarPack, gzip, createWriteStream(archive, { mode: 0o644 }));
for (const path of (await filesUnder(releaseRoot)).sort((left, right) =>
  relative(releaseRoot, left).localeCompare(relative(releaseRoot, right)),
)) {
  const info = await stat(path);
  const body = await readFile(path);
  await new Promise((resolveEntry, reject) => {
    tarPack.entry(
      {
        name: `${releaseId}/${relative(releaseRoot, path)}`,
        size: body.length,
        mode: info.mode & 0o111 ? 0o755 : 0o644,
        uid: 0,
        gid: 0,
        uname: "root",
        gname: "root",
        mtime: new Date(epochSeconds * 1000),
        type: "file",
      },
      body,
      (error) => (error ? reject(error) : resolveEntry()),
    );
  });
}
tarPack.finalize();
await pipelinePromise;
const digest = createHash("sha256").update(await readFile(archive)).digest("hex");
await writeFile(`${archive}.sha256`, `${digest}  ${basename(archive)}\n`);
process.stdout.write(`${JSON.stringify({ archive, sha256: digest })}\n`);
