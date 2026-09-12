#!/usr/bin/env node
// [Input] Four verified dist/cleanroom-targets builds, checked clean-room/dependency policies, and license texts.
// [Output] Five exact npm staging directories with CycloneDX/license evidence and five local tgz archives under dist/cleanroom-npm.
// [Pos] Clean-room-only npm materializer; it never publishes and has no restored/local-core input option.
// [Sync] 2026-08-24: bind Dream's canonical CLI/manifest/capability contract into all five packages.
// [Sync] 2026-08-24: make a deterministic CycloneDX SBOM part of every exact package inventory.
// [Sync] 2026-08-24: require and embed the final Dream business-receipt digest for formal publication.
// [Sync] 2026-08-30: bind Runtime 0.1.4 packages to the authorized version-bound Dream receipt.

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmod, copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const policy = JSON.parse(await readFile(path.join(repositoryRoot, "runtime", "cleanroom-npm-policy.json"), "utf8"));
const cleanroomPolicy = JSON.parse(await readFile(path.join(repositoryRoot, "runtime", "cleanroom-artifact-policy.json"), "utf8"));
const dependencyPolicy = JSON.parse(await readFile(path.join(repositoryRoot, "runtime", "cleanroom-dependency-licenses.json"), "utf8"));
const rootPackage = JSON.parse(await readFile(path.join(repositoryRoot, "package.json"), "utf8"));
const licenseBody = await readFile(path.join(repositoryRoot, "LICENSE"));
const allowedTargets = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"];
const command = process.argv[2] ?? "all";
const formalPublication = cleanroomPolicy.publicationGate?.publicationAllowed === true;
const qualificationFixture = !formalPublication &&
  process.env.INK_CLEANROOM_QUALIFICATION_FIXTURE === "provider-free-test";
const qualification = {
  productionEligible:
    cleanroomPolicy.publicationGate?.productionEligible === true || qualificationFixture,
  publicationAllowed: cleanroomPolicy.publicationGate?.publicationAllowed === true,
  redistributionAllowed:
    cleanroomPolicy.publicationGate?.redistributionAllowed === true || qualificationFixture,
};

function fail(message) {
  throw new Error(`[package-cleanroom-npm] ${message}`);
}

function sha256(body) {
  return createHash("sha256").update(body).digest("hex");
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, stableValue(child)]),
    );
  }
  return value;
}

function stableJson(value) {
  return `${JSON.stringify(stableValue(value), null, 2)}\n`;
}

async function loadBusinessAcceptance() {
  const acceptance = cleanroomPolicy.publicationGate?.businessAcceptance;
  const relative = acceptance?.receiptPath;
  if (
    typeof relative !== "string" ||
    !relative.startsWith("runtime/attestations/") ||
    path.normalize(relative) !== relative ||
    path.isAbsolute(relative)
  ) {
    fail("Dream business acceptance receipt path is invalid");
  }
  const body = await readFile(path.join(repositoryRoot, relative));
  const receipt = JSON.parse(body.toString("utf8"));
  if (
    acceptance.required !== true ||
    acceptance.passed !== true ||
    acceptance.receiptSha256 !== sha256(body) ||
    receipt.schemaVersion !== "ink-dream-real-business-acceptance/v2" ||
    receipt.subject?.runtime !== cleanroomPolicy.artifact?.name ||
    receipt.subject?.version !== policy.version ||
    receipt.subject?.acceptedTarget !== "darwin-arm64" ||
    !/^[a-f0-9]{64}$/.test(receipt.subject?.sourceTreeSha256 ?? "") ||
    !/^[a-f0-9]{64}$/.test(receipt.subject?.acceptedExecutableSha256 ?? "") ||
    receipt.acceptance?.status !== "passed" ||
    receipt.privacy?.accountIdentifierIncluded !== false ||
    receipt.privacy?.oauthCredentialsIncluded !== false ||
    receipt.authorization?.explicitPublicNpmReleaseApproved !== true ||
    receipt.authorization?.pypiPublicationApproved !== false
  ) {
    fail("Dream business acceptance receipt binding is invalid");
  }
  return { receipt, sha256: acceptance.receiptSha256 };
}

const businessAcceptance = formalPublication
  ? await loadBusinessAcceptance()
  : { receipt: null, sha256: null };

function sbomLicense(license) {
  return /^[A-Za-z0-9.-]+$/.test(license)
    ? { license: { id: license } }
    : { expression: license };
}

function cycloneDx(packageName, kind, entrypointSha256, target, dependencyReport) {
  const rootRef = `pkg:npm/${packageName}@${policy.version}`;
  const components = dependencyReport.components.map(component => {
    const bomRef = `pkg:npm/${component.name}@${component.version}`;
    return {
      type: "library",
      "bom-ref": bomRef,
      name: component.name,
      version: component.version,
      licenses: [sbomLicense(component.license)],
      properties: [{ name: "ink.license.text.sha256", value: component.licenseSha256 }],
    };
  });
  return {
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    version: 1,
    metadata: {
      component: {
        type: "application",
        "bom-ref": rootRef,
        name: packageName,
        version: policy.version,
        licenses: [{ license: { id: "MIT" } }],
        properties: [
          { name: "ink.runtime.kind", value: kind },
          { name: "ink.runtime.entrypoint.sha256", value: entrypointSha256 },
          ...(target ? [{ name: "ink.runtime.target", value: target }] : []),
        ],
      },
    },
    components,
    dependencies: [
      { ref: rootRef, dependsOn: components.map(component => component["bom-ref"]) },
      ...components.map(component => ({ ref: component["bom-ref"], dependsOn: [] })),
    ],
  };
}

async function buildDependencyMaterials() {
  if (
    dependencyPolicy.schemaVersion !== "ink-cleanroom-dependency-licenses/v1" ||
    !Array.isArray(dependencyPolicy.components) ||
    dependencyPolicy.components.length === 0
  ) {
    fail("clean-room dependency license policy is invalid");
  }
  const seen = new Set();
  const components = [];
  const notices = [
    "Third-party notices for ink-claude-code-dream",
    "Generated from runtime/cleanroom-dependency-licenses.json and the exact locked install.",
    "",
  ];
  for (const component of dependencyPolicy.components) {
    const identity = `${component.name}@${component.version}`;
    if (
      seen.has(identity) ||
      typeof component.name !== "string" ||
      typeof component.version !== "string" ||
      typeof component.license !== "string" ||
      typeof component.packageRoot !== "string" ||
      typeof component.licenseFile !== "string" ||
      component.packageRoot.includes("..") ||
      path.isAbsolute(component.packageRoot)
    ) {
      fail(`invalid or duplicate dependency license entry: ${identity}`);
    }
    seen.add(identity);
    const packageRoot = path.join(repositoryRoot, component.packageRoot);
    const packageJson = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
    if (
      packageJson.name !== component.name ||
      packageJson.version !== component.version ||
      packageJson.license !== component.license
    ) {
      fail(`locked dependency identity/license drift: ${identity}`);
    }
    const licenseBody = await readFile(path.join(packageRoot, component.licenseFile));
    components.push({
      name: component.name,
      version: component.version,
      license: component.license,
      licenseSha256: sha256(licenseBody),
    });
    notices.push(`===== ${identity} (${component.license}) =====`, licenseBody.toString("utf8").trimEnd(), "");
  }
  const noticeBody = Buffer.from(`${notices.join("\n")}\n`);
  return {
    noticeBody,
    report: {
      schemaVersion: "ink-cleanroom-bundled-dependencies/v1",
      sourcePolicy: "runtime/cleanroom-dependency-licenses.json",
      components,
      thirdPartyNoticesSha256: sha256(noticeBody),
    },
  };
}

function stageName(packageName) {
  return packageName.replace("@glide-the/", "");
}

async function exactFiles(root) {
  const files = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) fail(`symlink is forbidden in npm stage: ${absolute}`);
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile()) files.push(path.relative(root, absolute).split(path.sep).join("/"));
      else fail(`non-regular npm material is forbidden: ${absolute}`);
    }
  }
  await walk(root);
  return files.sort();
}

function validatePolicy() {
  if (
    policy.schemaVersion !== "ink-cleanroom-npm-policy/v1" ||
    policy.repository !== "glide-the/ink-claude-code-dream" ||
    policy.version !== rootPackage.version ||
    policy.license !== "MIT" ||
    rootPackage.license !== "MIT" ||
    rootPackage.private !== true ||
    policy.bunVersion !== "1.4.0" ||
    policy.materialPolicy?.sourceMapsAllowed !== false ||
    policy.publication?.packageGenerationAllowed !== true ||
    policy.publication?.npmPublishAllowed !== formalPublication ||
    cleanroomPolicy.publicationGate?.productionEligible !== formalPublication ||
    cleanroomPolicy.publicationGate?.redistributionAllowed !== formalPublication ||
    Object.values(cleanroomPolicy.publicationGate?.targetHostQualification ?? {}).length !== 4 ||
    Object.values(cleanroomPolicy.publicationGate?.targetHostQualification ?? {}).some(
      value => value !== formalPublication,
    ) ||
    JSON.stringify(Object.keys(policy.platforms)) !== JSON.stringify(allowedTargets)
  ) {
    fail("policy/root package identity, MIT, exact Bun, target order, or formal publication gate drift");
  }
  if (
    cleanroomPolicy.artifact?.license !== "MIT" ||
    cleanroomPolicy.source?.root !== "src/cleanroom" ||
    cleanroomPolicy.source?.restoredSourceAllowed !== false ||
    cleanroomPolicy.source?.derivedAnthropicRuntimeAllowed !== false
  ) {
    fail("clean-room source/license boundary drift");
  }
  if (JSON.stringify(policy.metaPackage.commands) !== JSON.stringify(["claude", "ink-claude-code-dream"])) {
    fail("meta command aliases drift");
  }
}

function launcherBody() {
  const packageByTarget = Object.fromEntries(
    Object.entries(policy.platforms).map(([target, platform]) => [target, platform.package]),
  );
  return [
    "#!/usr/bin/env node",
    "// Generated by scripts/package-cleanroom-npm.mjs; selects and supervises the exact optional native package.",
    "// Capability marker forwarded by every verified platform Runtime: CLAUDE_SECURESTORAGE_CONFIG_DIR",
    'import { spawn } from "node:child_process";',
    'import { createRequire } from "node:module";',
    'import path from "node:path";',
    'const target = process.platform + "-" + process.arch;',
    `const packages = ${JSON.stringify(packageByTarget)};`,
    "const packageName = packages[target];",
    'if (!packageName) { console.error("ink-claude-code-dream: unsupported platform " + target); process.exit(78); }',
    "const require = createRequire(import.meta.url);",
    "let packageJson;",
    'try { packageJson = require.resolve(packageName + "/package.json"); } catch { console.error("ink-claude-code-dream: missing optional platform package " + packageName); process.exit(78); }',
    'const executable = path.join(path.dirname(packageJson), "runtime", "bin", "ink-claude-code-dream");',
    'const child = spawn(executable, process.argv.slice(2), { stdio: "inherit", env: process.env });',
    "let terminatingSignal;",
    "let forceChild;",
    "let forceLauncher;",
    'const signals = ["SIGINT", "SIGTERM"];',
    "const forward = new Map(signals.map(signal => [signal, () => {",
    "  if (terminatingSignal) return;",
    "  terminatingSignal = signal;",
    "  if (child.exitCode === null && child.signalCode === null) child.kill(signal);",
    '  forceChild = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); }, 2000);',
    '  forceLauncher = setTimeout(() => process.exit(signal === "SIGINT" ? 130 : 143), 2500);',
    "}]));",
    "for (const [signal, handler] of forward) process.on(signal, handler);",
    "const cleanup = () => {",
    "  for (const [signal, handler] of forward) process.off(signal, handler);",
    "  if (forceChild) clearTimeout(forceChild);",
    "  if (forceLauncher) clearTimeout(forceLauncher);",
    "};",
    'child.once("error", error => { cleanup(); console.error("ink-claude-code-dream: " + error.message); process.exit(1); });',
    'child.once("exit", (status, signal) => { cleanup(); if (signal) process.kill(process.pid, signal); else process.exit(status ?? 1); });',
    "",
  ].join("\n");
}

function prepackBody(releaseRoot, executablePath, artifactPath) {
  const expectedAttestationSchema = artifactPath.startsWith("runtime/")
    ? "ink-cleanroom-npm-platform-publication-attestation/v1"
    : "ink-cleanroom-npm-meta-publication-attestation/v1";
  return `#!/usr/bin/env node\n// Generated fail-closed package integrity gate.\nimport { createHash } from "node:crypto";\nimport { readFile, readdir } from "node:fs/promises";\nimport path from "node:path";\nimport { fileURLToPath } from "node:url";\nconst root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");\nconst release=JSON.parse(await readFile(path.join(root,${JSON.stringify(releaseRoot)},"release-manifest.json"),"utf8"));\nconst artifact=JSON.parse(await readFile(path.join(root,${JSON.stringify(artifactPath)}),"utf8"));\nconst attestation=JSON.parse(await readFile(path.join(root,"npm-publication-attestation.json"),"utf8"));\nconst executablePath=path.join(root,${JSON.stringify(executablePath)});\nconst executable=await readFile(executablePath);\nconst digest=createHash("sha256").update(executable).digest("hex");\nif(release.schemaVersion!=="ink-claude-cli-envelope/v1"||release.core?.productionEligible!==true||release.status?.publicationAllowed!==true||artifact.artifact?.entrypointSha256!==digest||attestation.schemaVersion!==${JSON.stringify(expectedAttestationSchema)}||attestation.repository!==${JSON.stringify(policy.repository)}||attestation.version!==${JSON.stringify(policy.version)}||attestation.productionEligible!==true||attestation.publicationAllowed!==true||attestation.redistributionAllowed!==true||attestation.businessAcceptanceReceiptSha256!==${JSON.stringify(businessAcceptance.sha256)}||attestation.sourceMapsIncluded!==false||Object.hasOwn(attestation,"fixture")||attestation.entrypointSha256!==digest)throw new Error("Runtime manifest, publication attestation, or executable binding failed");\nasync function walk(directory){for(const entry of await readdir(directory,{withFileTypes:true})){const absolute=path.join(directory,entry.name);if(entry.isSymbolicLink())throw new Error("symlink is forbidden");if(entry.isDirectory())await walk(absolute);else if(entry.name.toLowerCase().endsWith(".map"))throw new Error("source maps are forbidden");}}\nawait walk(root);\n`;
}

function capabilityEvidence(entrypointSha256, target) {
  return {
    schemaVersion: "ink-cleanroom-capability-evidence/v1",
    runtime: {
      corePruned: true,
      productionEligible: qualification.productionEligible,
      provenance: "repository-authored-clean-room",
      ...(qualificationFixture ? { fixture: "provider-free-test" } : {}),
      ...(target ? { runtimeTarget: target } : {}),
    },
    artifact: { entrypointSha256 },
    capabilities: cleanroomPolicy.requiredCapabilities.map(id => ({ id })),
  };
}

function releaseManifest(entrypoint, capabilityEvidencePath, entrypointSha256, target) {
  return {
    schemaVersion: "ink-claude-cli-envelope/v1",
    runtime: {
      name: "ink-claude-code-dream",
      version: policy.version,
      entrypoint,
      integration: {
        environment: "CLAUDE_CODE_CLI_PATH",
        sdkVersion: "0.2.145",
        sdkOption: "ClaudeAgentOptions.cli_path",
      },
    },
    core: {
      corePruned: true,
      productionEligible: qualification.productionEligible,
      provenance: "repository-authored-clean-room",
      entrypointSha256,
      ...(target ? { runtimeTarget: target } : {}),
    },
    protocol: { name: "claude-code-stream-json", version: 1 },
    capabilityEvidence: capabilityEvidencePath,
    status: {
      productionEligible: qualification.productionEligible,
      publicationAllowed: qualification.publicationAllowed,
      redistributionAllowed: qualification.redistributionAllowed,
      ...(qualificationFixture ? { fixture: "provider-free-test" } : {}),
    },
  };
}

function publicationAttestation(entrypointSha256, target) {
  return {
    schemaVersion: target
      ? "ink-cleanroom-npm-platform-publication-attestation/v1"
      : "ink-cleanroom-npm-meta-publication-attestation/v1",
    repository: policy.repository,
    version: policy.version,
    productionEligible: qualification.productionEligible,
    publicationAllowed: qualification.publicationAllowed,
    redistributionAllowed: qualification.redistributionAllowed,
    businessAcceptanceReceiptSha256: businessAcceptance.sha256,
    ...(qualificationFixture ? { fixture: "provider-free-test" } : {}),
    sourceMapsIncluded: false,
    entrypointSha256,
    ...(target ? { runtimeTarget: target } : {}),
  };
}

function platformReadme(target, platform) {
  return `# ${platform.package}\n\nMIT-licensed clean-room Ink Claude Runtime executable for \`${target}\`.\n\nThis package is selected by \`${policy.metaPackage.name}\`; install the meta package instead of depending on this package directly. Runtime session, workspace, transcript, MCP credentials, and OAuth tokens are external mutable data and are never included here.\n`;
}

function metaReadme() {
  return `# ${policy.metaPackage.name}\n\nPlatform selector for the MIT-licensed clean-room Ink Claude Runtime. It exposes both \`claude\` and \`ink-claude-code-dream\` and delegates to one exact optional native package.\n\nSupported targets: ${allowedTargets.map(target => `\`${target}\``).join(", ")}. No source maps, restored source, sessions, workspace content, transcripts, credentials, or OAuth tokens are distributed.\n`;
}

async function stagePackages() {
  validatePolicy();
  const dependencyMaterials = await buildDependencyMaterials();
  const buildRoot = path.join(repositoryRoot, policy.buildRoot);
  const stageRoot = path.join(repositoryRoot, policy.stageRoot);
  await rm(stageRoot, { recursive: true, force: true });
  await mkdir(stageRoot, { recursive: true });
  const staged = [];

  for (const target of allowedTargets) {
    const platform = policy.platforms[target];
    if (`${platform.os}-${platform.cpu}` !== target || platform.package !== `${policy.metaPackage.name}-${target}`) {
      fail(`platform mapping drift: ${target}`);
    }
    const buildManifestPath = path.join(buildRoot, target, "build-manifest.json");
    const buildManifest = JSON.parse(await readFile(buildManifestPath, "utf8"));
    const sourceExecutable = path.join(buildRoot, target, "claude");
    const executableBody = await readFile(sourceExecutable);
    if (
      buildManifest.schemaVersion !== "ink-cleanroom-target-build/v1" ||
      buildManifest.target !== target ||
      buildManifest.runtime?.license !== "MIT" ||
      buildManifest.bun?.version !== policy.bunVersion ||
      buildManifest.build?.entrypoint !== policy.entrypoint ||
      buildManifest.build?.sourcemap !== "none" ||
      buildManifest.executable?.sha256 !== sha256(executableBody) ||
      buildManifest.executable?.bytes !== executableBody.byteLength ||
      buildManifest.executable?.format !== platform.binaryFormat
    ) {
      fail(`unqualified or stale clean-room target build: ${target}`);
    }
    if (
      formalPublication &&
      target === businessAcceptance.receipt.subject.acceptedTarget &&
      (
        buildManifest.build.sourceTreeSha256 !== businessAcceptance.receipt.subject.sourceTreeSha256 ||
        sha256(executableBody) !== businessAcceptance.receipt.subject.acceptedExecutableSha256
      )
    ) {
      fail(`real-business acceptance subject drift: ${target}`);
    }

    const root = path.join(stageRoot, stageName(platform.package));
    const packagedExecutable = "runtime/bin/ink-claude-code-dream";
    await mkdir(path.join(root, "runtime", "bin"), { recursive: true });
    await mkdir(path.join(root, "runtime", "manifest"), { recursive: true });
    await mkdir(path.join(root, "scripts"), { recursive: true });
    await copyFile(sourceExecutable, path.join(root, packagedExecutable));
    await chmod(path.join(root, packagedExecutable), 0o755);
    await writeFile(path.join(root, "LICENSE"), licenseBody);
    await writeFile(path.join(root, "THIRD_PARTY_NOTICES.txt"), dependencyMaterials.noticeBody);
    await writeFile(path.join(root, "README.md"), platformReadme(target, platform));
    const runtimeManifest = {
      schemaVersion: "ink-cleanroom-npm-platform/v1",
      package: { name: platform.package, version: policy.version, license: "MIT" },
      runtime: {
        target,
        os: platform.os,
        cpu: platform.cpu,
        bunVersion: policy.bunVersion,
        bunTarget: platform.bunTarget,
        binaryFormat: platform.binaryFormat,
        executable: packagedExecutable,
        bytes: executableBody.byteLength,
        sha256: sha256(executableBody),
        sourceTreeSha256: buildManifest.build.sourceTreeSha256,
        lockfileSha256: buildManifest.build.lockfileSha256,
        sourcemap: "none",
        provenance: "repository-authored-clean-room",
      },
    };
    await writeFile(path.join(root, "runtime-manifest.json"), stableJson(runtimeManifest));
    const entrypointSha256 = sha256(executableBody);
    const capabilities = capabilityEvidence(entrypointSha256, target);
    await writeFile(path.join(root, "runtime", "manifest", "capabilities.json"), stableJson(capabilities));
    await writeFile(
      path.join(root, "runtime", "manifest", "dependency-licenses.json"),
      stableJson(dependencyMaterials.report),
    );
    await writeFile(
      path.join(root, "runtime", "manifest", "sbom.cdx.json"),
      stableJson(cycloneDx(platform.package, "platform", entrypointSha256, target, dependencyMaterials.report)),
    );
    const artifactManifest = {
      schemaVersion: "ink-cleanroom-artifact-manifest/v1",
      artifact: {
        runtimeTarget: target,
        entrypoint: "bin/ink-claude-code-dream",
        entrypointSha256,
        productionEligible: qualification.productionEligible,
        publicationAllowed: qualification.publicationAllowed,
        redistributionAllowed: qualification.redistributionAllowed,
      },
      capabilitiesSha256: sha256(Buffer.from(stableJson(capabilities))),
    };
    await writeFile(path.join(root, "runtime", "manifest", "artifact-manifest.json"), stableJson(artifactManifest));
    await writeFile(
      path.join(root, "runtime", "release-manifest.json"),
      stableJson(releaseManifest("bin/ink-claude-code-dream", "manifest/capabilities.json", entrypointSha256, target)),
    );
    await writeFile(path.join(root, "npm-publication-attestation.json"), stableJson(publicationAttestation(entrypointSha256, target)));
    await writeFile(
      path.join(root, "scripts", "prepack.mjs"),
      prepackBody("runtime", packagedExecutable, "runtime/manifest/artifact-manifest.json"),
    );
    await writeFile(path.join(root, "SHA256SUMS"), `${entrypointSha256}  ${packagedExecutable}\n`);
    const packageJson = {
      name: platform.package,
      version: policy.version,
      description: `Clean-room Ink Claude Runtime for ${target}`,
      license: "MIT",
      os: [platform.os],
      cpu: [platform.cpu],
      files: ["runtime", "scripts/prepack.mjs", "npm-publication-attestation.json", "LICENSE", "THIRD_PARTY_NOTICES.txt", "README.md", "runtime-manifest.json", "SHA256SUMS"],
      scripts: { prepack: "node scripts/prepack.mjs" },
      publishConfig: { access: "public", provenance: true },
    };
    await writeFile(path.join(root, "package.json"), stableJson(packageJson));
    const actualFiles = await exactFiles(root);
    if (JSON.stringify(actualFiles) !== JSON.stringify(policy.materialPolicy.platformFiles)) {
      fail(`${target} platform stage inventory drift: ${actualFiles.join(", ")}`);
    }
    staged.push({ name: platform.package, target, root, bytes: executableBody.byteLength, sha256: entrypointSha256 });
  }

  const metaRoot = path.join(stageRoot, stageName(policy.metaPackage.name));
  await mkdir(path.join(metaRoot, "bin"), { recursive: true });
  await mkdir(path.join(metaRoot, "manifest"), { recursive: true });
  await mkdir(path.join(metaRoot, "scripts"), { recursive: true });
  const launcher = Buffer.from(launcherBody());
  const metaEntrypoint = "bin/ink-claude-code-dream";
  await writeFile(path.join(metaRoot, metaEntrypoint), launcher, { mode: 0o755 });
  await chmod(path.join(metaRoot, metaEntrypoint), 0o755);
  await writeFile(path.join(metaRoot, "LICENSE"), licenseBody);
  await writeFile(path.join(metaRoot, "THIRD_PARTY_NOTICES.txt"), dependencyMaterials.noticeBody);
  await writeFile(path.join(metaRoot, "README.md"), metaReadme());
  const optionalDependencies = Object.fromEntries(
    allowedTargets.map(target => [policy.platforms[target].package, policy.version]),
  );
  const metaManifest = {
    schemaVersion: "ink-cleanroom-npm-meta/v1",
    package: { name: policy.metaPackage.name, version: policy.version, license: "MIT" },
    commands: policy.metaPackage.commands,
    selector: metaEntrypoint,
    optionalDependencies,
    supportedTargets: allowedTargets,
    launcherSha256: sha256(launcher),
    sourcemap: "none",
  };
  await writeFile(path.join(metaRoot, "runtime-manifest.json"), stableJson(metaManifest));
  const launcherSha256 = sha256(launcher);
  const metaCapabilities = capabilityEvidence(launcherSha256);
  await writeFile(path.join(metaRoot, "manifest", "capabilities.json"), stableJson(metaCapabilities));
  await writeFile(
    path.join(metaRoot, "manifest", "dependency-licenses.json"),
    stableJson(dependencyMaterials.report),
  );
  await writeFile(
    path.join(metaRoot, "manifest", "sbom.cdx.json"),
    stableJson(cycloneDx(policy.metaPackage.name, "meta", launcherSha256, undefined, dependencyMaterials.report)),
  );
  const metaArtifact = {
    schemaVersion: "ink-cleanroom-artifact-manifest/v1",
    artifact: {
      entrypoint: metaEntrypoint,
      entrypointSha256: launcherSha256,
      productionEligible: qualification.productionEligible,
      publicationAllowed: qualification.publicationAllowed,
      redistributionAllowed: qualification.redistributionAllowed,
    },
    capabilitiesSha256: sha256(Buffer.from(stableJson(metaCapabilities))),
    platforms: Object.fromEntries(
      staged.map(item => [item.target, { package: item.name, executableSha256: item.sha256 }]),
    ),
  };
  await writeFile(path.join(metaRoot, "manifest", "artifact-manifest.json"), stableJson(metaArtifact));
  await writeFile(
    path.join(metaRoot, "release-manifest.json"),
    stableJson(releaseManifest(metaEntrypoint, "manifest/capabilities.json", launcherSha256)),
  );
  await writeFile(path.join(metaRoot, "npm-publication-attestation.json"), stableJson(publicationAttestation(launcherSha256)));
  await writeFile(
    path.join(metaRoot, "scripts", "prepack.mjs"),
    prepackBody(".", metaEntrypoint, "manifest/artifact-manifest.json"),
  );
  await writeFile(path.join(metaRoot, "SHA256SUMS"), `${launcherSha256}  ${metaEntrypoint}\n`);
  const metaPackageJson = {
    name: policy.metaPackage.name,
    version: policy.version,
    description: "Platform selector for the clean-room Ink Claude Runtime",
    license: "MIT",
    type: "module",
    bin: {
      claude: metaEntrypoint,
      "ink-claude-code-dream": metaEntrypoint,
    },
    files: [metaEntrypoint, "manifest", "scripts/prepack.mjs", "npm-publication-attestation.json", "release-manifest.json", "LICENSE", "THIRD_PARTY_NOTICES.txt", "README.md", "runtime-manifest.json", "SHA256SUMS"],
    optionalDependencies,
    scripts: { prepack: "node scripts/prepack.mjs" },
    engines: { node: ">=22.0.0 <25.0.0" },
    publishConfig: { access: "public", provenance: true },
  };
  await writeFile(path.join(metaRoot, "package.json"), stableJson(metaPackageJson));
  const actualMetaFiles = await exactFiles(metaRoot);
  if (JSON.stringify(actualMetaFiles) !== JSON.stringify(policy.materialPolicy.metaFiles)) {
    fail(`meta stage inventory drift: ${actualMetaFiles.join(", ")}`);
  }
  staged.push({ name: policy.metaPackage.name, root: metaRoot, sha256: launcherSha256 });
  return { stageRoot, staged };
}

async function packPackages(staged) {
  const tarballRoot = path.join(repositoryRoot, policy.tarballRoot);
  await rm(tarballRoot, { recursive: true, force: true });
  await mkdir(tarballRoot, { recursive: true });
  const tarballs = [];
  for (const item of staged) {
    const result = spawnSync(
      "npm",
      ["pack", "--ignore-scripts", "--json", "--pack-destination", tarballRoot, item.root],
      { cwd: repositoryRoot, encoding: "utf8", timeout: 240_000 },
    );
    if (result.status !== 0) fail(`npm pack failed for ${item.name}\n${result.stdout}${result.stderr}`);
    const receipt = JSON.parse(result.stdout)[0];
    const tarball = path.join(tarballRoot, receipt.filename);
    const body = await readFile(tarball);
    tarballs.push({ name: item.name, file: tarball, bytes: (await stat(tarball)).size, sha256: sha256(body) });
  }
  if (tarballs.length !== 5) fail(`expected five npm tarballs; received ${tarballs.length}`);
  await writeFile(
    path.join(tarballRoot, "SHA256SUMS"),
    `${tarballs.map(item => `${item.sha256}  ${path.basename(item.file)}`).sort().join("\n")}\n`,
  );
  return tarballs;
}

if (!["stage", "pack", "all"].includes(command)) fail(`usage: package-cleanroom-npm.mjs [stage|pack|all]`);
const { stageRoot, staged } = await stagePackages();
const tarballs = command === "stage" ? [] : await packPackages(staged);
process.stdout.write(stableJson({ status: "cleanroom-npm-packaged", command, stageRoot, packages: staged, tarballs }));
