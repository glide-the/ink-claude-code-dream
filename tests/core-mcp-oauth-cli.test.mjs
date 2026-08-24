// [Input] A built candidate core plus the official MCP Python SDK 2.0.0 simple-auth fixture.
// [Output] Prove pipe/PTY OAuth behavior plus bounded, secret-free success and classified-failure receipts.
// [Pos] Exact local process contract for the Runtime MCP login facade; no Dream, provider, or OAuth state machine is copied.
// [Sync] 2026-08-24: qualify deterministic actor storage and race-safe PTY exit observation.

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import fixtureManifest from "./fixtures/mcp_oauth_fixture_manifest.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const builderSource = await readFile(
  path.resolve(repositoryRoot, "scripts/build-core-prune.ts"),
  "utf8",
);
const bun = path.resolve(repositoryRoot, "node_modules/.bin/bun");
const core = path.resolve(repositoryRoot, "dist/core-local/bundle/cli.js");
const captureServer = path.resolve(
  repositoryRoot,
  "tests/fixtures/mcp_oauth_capture_server.py",
);
const ptyDriver = path.resolve(repositoryRoot, "tests/fixtures/pty_cli_driver.py");
const fixturePython = process.env.INK_MCP_OAUTH_FIXTURE_PYTHON
  ? path.resolve(process.env.INK_MCP_OAUTH_FIXTURE_PYTHON)
  : undefined;
const fixtureRoot = process.env.INK_MCP_OAUTH_FIXTURE_ROOT
  ? path.resolve(process.env.INK_MCP_OAUTH_FIXTURE_ROOT)
  : undefined;
const requireFixture = process.env.INK_REQUIRE_CORE_OAUTH_FIXTURE === "1";
const successStages = [
  "action_started",
  "reader_ready",
  "initial_sdk_auth_started",
  "client_information_missing",
  "initial_sdk_auth_completed",
  "callback_line_received",
  "callback_validated",
  "token_exchange_started",
  "client_information_present",
  "code_verifier_present",
  "token_save_started",
  "token_save_completed",
  "token_exchange_completed",
  "credentials_present",
  "flow_resolved",
  "success_stdout_flushed",
];

test("OAuth checkpoints and error categories remain fixed, source-bound, and bounded", () => {
  assert.equal(successStages.length, 16, "successful login must fit the receipt line cap");
  for (const stage of [
    "client_information_present",
    "client_information_missing",
    "code_verifier_present",
    "token_save_started",
    "token_save_completed",
    "token_save_failed",
    "token_exchange_failed_credentials_unavailable",
    "token_exchange_failed_existing_client_information_missing",
    "token_exchange_failed_client_secret_missing",
    "token_exchange_failed_unsupported_client_auth",
    "token_exchange_failed_code_verifier_missing",
    "token_exchange_failed_redirect_uri_missing",
  ]) assert.match(builderSource, new RegExp(`['"]${stage}['"]`));
  assert.match(builderSource, /if \(Array\.isArray\(errorObject\?\.issues\)\)/);
  assert.match(builderSource, /recordedStages\.has\(stage\)/);
  assert.match(builderSource, /recordedStages\.add\(stage\)/);
  assert.match(builderSource, /sequence >= 16/);
  assert.match(builderSource, /headless-manual-oauth\.storedClientInformationStage/);
  assert.match(builderSource, /headless-manual-oauth\.configClientInformationStage/);
  assert.match(builderSource, /headless-manual-oauth\.missingClientInformationStage/);
  assert.match(builderSource, /headless-manual-oauth\.codeVerifierStage/);
  assert.match(builderSource, /headless-manual-oauth\.tokenSaveStages/);
  assert.match(builderSource, /headless-manual-oauth\.clientInformationMemoField/);
  assert.match(builderSource, /headless-manual-oauth\.clientInformationMemoRead/);
  assert.match(builderSource, /headless-manual-oauth\.clientInformationMemoWrite/);
  assert.match(
    builderSource,
    /if \(this\._clientInformation\)[\s\S]*return this\._clientInformation[\s\S]*const storage = getSecureStorage\(\)/,
  );
  assert.match(builderSource, /secure-storage-selector\.keychainIdentity/);
  assert.match(builderSource, /secure-storage-selector\.plainTextIdentity/);
  assert.match(builderSource, /secure-storage-selector\.deterministicActorStorage/);
  assert.match(builderSource, /CLAUDE_SECURESTORAGE_CONFIG_DIR/);
  assert.match(builderSource, /isAbsolute\(secureSelector\)/);
  assert.match(builderSource, /normalize\(secureSelector\) === secureSelector/);
  assert.match(
    builderSource,
    /CLAUDE_SECURESTORAGE_CONFIG_DIR must be an absolute normalized NFC path/,
  );
  assert.match(builderSource, /const storageResult = storage\.update\(updatedData\)/);
  assert.match(builderSource, /if \(!storageResult\.success\)/);
  assert.match(builderSource, /recordInkOAuthProviderStage\('token_save_failed'\)/);
  assert.match(
    builderSource,
    /if \(!savedTokens\)[\s\S]*recordInkOAuthStage\('credentials_missing'\)[\s\S]*throw new Error\('OAuth credentials unavailable after token exchange'\)/,
  );
  assert.match(
    builderSource,
    /failureStage = 'token_exchange_failed_credentials_unavailable'/,
  );
  assert.doesNotMatch(builderSource, /_pendingSavedTokens/);
  assert.match(builderSource, /if \(noBrowser\) process\.stdin\.pause\(\)/);
  assert.doesNotMatch(builderSource, /forceFailureExit/);
  for (const fixedSubstring of [
    "Existing OAuth client information is required when exchanging an authorization code",
    "client_secret_basic authentication requires a client_secret",
    "Unsupported client authentication method:",
    "No code verifier saved",
    "redirectUrl is required for authorization_code flow",
  ]) assert.ok(builderSource.includes(fixedSubstring));
  assert.doesNotMatch(
    builderSource,
    /recordInkOAuthStage\((?:errorName|genericMessage|errorObject)/,
  );
});

async function available(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const port = address.port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function waitForPort(port, child, diagnostics) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `OAuth fixture exited before readiness${diagnostics()}`,
      );
    }
    const connected = await new Promise(resolve => {
      const socket = net.createConnection({ host: "127.0.0.1", port });
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("error", () => resolve(false));
    });
    if (connected) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`OAuth fixture readiness timed out${diagnostics()}`);
}

async function portAcceptsConnections(port) {
  return await new Promise(resolve => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const timeout = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, 1_000);
    socket.once("connect", () => {
      clearTimeout(timeout);
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      clearTimeout(timeout);
      resolve(false);
    });
  });
}

async function waitForAuditEvent(file, eventName, child) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    let events = [];
    try {
      events = (await readFile(file, "utf8"))
        .trim()
        .split("\n")
        .filter(Boolean)
        .map(line => JSON.parse(line));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    const event = events.find(candidate => candidate.event === eventName);
    if (event) return event;
    if (child.exitCode !== null) {
      throw new Error(`login exited before fixture event ${eventName}`);
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for fixture event ${eventName}`);
}

async function waitForRuntimeStage(config, stage, child) {
  const file = path.join(config, ".ink-runtime-diagnostics", "mcp-oauth-stage.jsonl");
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const records = (await readFile(file, "utf8"))
        .trim()
        .split("\n")
        .filter(Boolean)
        .map(line => JSON.parse(line));
      if (records.some(record => record.stage === stage)) return;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    if (child.exitCode !== null) throw new Error(`login exited before Runtime stage ${stage}`);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for Runtime stage ${stage}`);
}

function runCore(args, environment, cwd) {
  return spawnSync(bun, [core, ...args], {
    cwd,
    env: environment,
    encoding: "utf8",
    timeout: 30_000,
  });
}

function waitForOutput(child, output, pattern) {
  return new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error("login output timed out")), 30_000);
    const exited = (code, signal) => {
      clearTimeout(deadline);
      reject(
        new Error(
          `login exited before authorization URL (code=${code}, signal=${signal})`,
        ),
      );
    };
    const inspect = () => {
      const match = output.value.match(pattern);
      if (!match) return;
      clearTimeout(deadline);
      child.stdout.off("data", inspect);
      child.stderr.off("data", inspect);
      child.off("exit", exited);
      resolve(match);
    };
    child.stdout.on("data", inspect);
    child.stderr.on("data", inspect);
    child.once("exit", exited);
    inspect();
  });
}

function waitForExit(child) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, code) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      child.off("error", errored);
      child.off("exit", exited);
      if (error) reject(error);
      else resolve(code);
    };
    const deadline = setTimeout(() => {
      child.kill("SIGTERM");
      finish(new Error("login process did not complete"));
    }, 30_000);
    const errored = error => finish(error);
    const exited = code => finish(undefined, code);
    child.once("error", errored);
    child.once("exit", exited);
    if (child.exitCode !== null || child.signalCode !== null) exited(child.exitCode);
  });
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise(resolve => {
    const force = setTimeout(() => child.kill("SIGKILL"), 2_000);
    const abandon = setTimeout(resolve, 5_000);
    child.once("exit", () => {
      clearTimeout(force);
      clearTimeout(abandon);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

function redactSensitiveOutput(output) {
  return output
    .replace(/([?&](?:state|code|client_id|code_challenge)=)[^&\s]+/gi, "$1<redacted>")
    .replace(/\bBearer\s+\S+/gi, "Bearer <redacted>")
    .replace(/\bmcp_[A-Za-z0-9_-]+\b/g, "mcp_<redacted>")
    .trim();
}

function redactFixtureDiagnostics(output) {
  if (!output) return "";
  const redacted = redactSensitiveOutput(output);
  return redacted ? `\nOAuth fixture stderr:\n${redacted}` : "";
}

async function safeFailureDiagnostics(config, audit, output) {
  const stagePath = path.join(config, ".ink-runtime-diagnostics", "mcp-oauth-stage.jsonl");
  let stages = [];
  let events = [];
  try {
    stages = (await readFile(stagePath, "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map(line => JSON.parse(line)?.stage)
      .filter(stage => typeof stage === "string");
  } catch {}
  try {
    events = (await readFile(audit, "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map(line => JSON.parse(line)?.event)
      .filter(event => typeof event === "string");
  } catch {}
  const runtimeOutput = redactSensitiveOutput(output);
  return `\nRuntime output:\n${runtimeOutput || "<empty>"}\nOAuth stages: ${JSON.stringify(stages)}\nOAuth audit events: ${JSON.stringify(events)}`;
}

async function verifyOfficialFixture() {
  assert.ok(
    fixturePython && fixtureRoot,
    "set both INK_MCP_OAUTH_FIXTURE_PYTHON and INK_MCP_OAUTH_FIXTURE_ROOT",
  );
  const sdk = spawnSync("git", ["-C", fixtureRoot, "rev-parse", "--show-toplevel"], {
    encoding: "utf8",
  });
  assert.equal(sdk.status, 0, "OAuth fixture root must belong to the official SDK checkout");
  const sdkRoot = sdk.stdout.trim();
  assert.equal(
    await realpath(fixtureRoot),
    await realpath(path.join(sdkRoot, fixtureManifest.fixturePath)),
    "OAuth fixture root does not match the pinned official SDK example path",
  );
  const revision = spawnSync("git", ["-C", sdkRoot, "rev-parse", "HEAD"], {
    encoding: "utf8",
  });
  assert.equal(revision.status, 0, "could not read official SDK revision");
  assert.equal(
    revision.stdout.trim(),
    fixtureManifest.commit,
    "official MCP Python SDK revision drift",
  );
  const providerStatus = spawnSync(
    "git",
    [
      "-C",
      sdkRoot,
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
      "--",
      path.join(fixtureManifest.fixturePath, "mcp_simple_auth"),
    ],
    { encoding: "utf8" },
  );
  assert.equal(providerStatus.status, 0, "could not inspect official provider fixture");
  assert.equal(
    providerStatus.stdout.trim(),
    "",
    "official OAuth provider fixture must exactly match the pinned revision",
  );
  const version = spawnSync(
    fixturePython,
    [
      "-c",
      `import importlib.metadata; print(importlib.metadata.version(${JSON.stringify(fixtureManifest.distribution)}))`,
    ],
    { encoding: "utf8" },
  );
  assert.equal(version.status, 0, "fixture Python cannot import the official MCP SDK");
  assert.equal(version.stdout.trim(), fixtureManifest.version, "official MCP SDK version drift");
}

async function stageReceipt(config) {
  const directory = path.join(config, ".ink-runtime-diagnostics");
  const file = path.join(directory, "mcp-oauth-stage.jsonl");
  const [directoryInfo, fileInfo, body] = await Promise.all([
    stat(directory),
    stat(file),
    readFile(file, "utf8"),
  ]);
  assert.equal(directoryInfo.mode & 0o777, 0o700);
  assert.equal(fileInfo.mode & 0o777, 0o600);
  assert.ok(fileInfo.size > 0 && fileInfo.size <= 4096, "stage receipt must remain bounded");
  const records = body.trim().split("\n").map(line => JSON.parse(line));
  assert.ok(records.length <= 16, "stage receipt entry count must remain bounded");
  for (const [index, record] of records.entries()) {
    assert.deepEqual(Object.keys(record).sort(), ["at", "schemaVersion", "seq", "stage"]);
    assert.equal(record.schemaVersion, 1);
    assert.equal(record.seq, index + 1);
    assert.equal(new Date(record.at).toISOString(), record.at);
  }
  return { body, records };
}

function assertNoSensitiveStageData(body, values = []) {
  assert.doesNotMatch(
    body,
    /https?:|localhost|Bearer|client_id|code_challenge|access_token|refresh_token|code=|state=|\.claude|\/Users\/|\/private\//i,
  );
  for (const value of values.filter(Boolean)) assert.ok(!body.includes(value));
}

async function prerequisites(t) {
  const fixtureConfigured = Boolean(fixturePython && fixtureRoot);
  const prerequisitesAvailable =
    (await available(bun)) &&
    (await available(core)) &&
    (await available(ptyDriver)) &&
    fixtureConfigured &&
    (await available(fixturePython)) &&
    (await available(path.join(fixtureRoot, "mcp_simple_auth/legacy_as_server.py")));
  if (!prerequisitesAvailable && !requireFixture && !fixtureConfigured) {
    t.skip(
      "set INK_MCP_OAUTH_FIXTURE_PYTHON and INK_MCP_OAUTH_FIXTURE_ROOT to run the pinned official SDK contract",
    );
    return false;
  }
  assert.ok(
    prerequisitesAvailable,
    "built core and explicitly configured official MCP OAuth fixture are required",
  );
  await verifyOfficialFixture();
  return true;
}

async function runSuccessfulOAuthContract(usePty) {
  const root = await mkdtemp(path.join(os.tmpdir(), "ink-core-oauth-cli-"));
  const config = path.join(root, "config");
  const secureConfig = path.join(root, "secure-config");
  const home = path.join(root, "home");
  const neutral = path.join(root, "neutral");
  const emptyPath = path.join(root, "empty-path");
  const audit = path.join(root, "oauth-audit.jsonl");
  const fixtureHome = path.join(root, "fixture-home");
  const fixtureTmp = path.join(root, "fixture-tmp");
  const securitySentinel = path.join(root, "security-invoked");
  let fixture;
  let login;
  let activeLoginOutput = "";
  let fixtureDiagnostics = () => "";

  try {
    await Promise.all(
      [config, secureConfig, home, neutral, emptyPath, fixtureHome, fixtureTmp].map(directory =>
        mkdir(directory, { recursive: true, mode: 0o700 }),
      ),
    );
    const fakeSecurity = path.join(emptyPath, "security");
    await writeFile(
      fakeSecurity,
      "#!/bin/sh\nprintf invoked >> \"$INK_SECURITY_SENTINEL\"\nexit 1\n",
      { mode: 0o700 },
    );
    await chmod(fakeSecurity, 0o700);

    const port = await freePort();
    const serverUrl = `http://localhost:${port}`;
    fixture = spawn(fixturePython, [captureServer, "--port", String(port), "--transport", "streamable-http"], {
      cwd: fixtureRoot,
      env: {
        HOME: fixtureHome,
        PATH: `${path.dirname(fixturePython)}:/usr/bin:/bin`,
        LANG: "C.UTF-8",
        LC_ALL: "C.UTF-8",
        TMPDIR: fixtureTmp,
        NO_PROXY: "localhost,127.0.0.1",
        INK_MCP_OAUTH_AUDIT_PATH: audit,
        INK_MCP_OAUTH_TOKEN_DELAY_SECONDS: "1.5",
        INK_MCP_OAUTH_TOKEN_ERROR_ON_SECOND_EXCHANGE: usePty ? "" : "invalid_grant",
        INK_MCP_OAUTH_TOKEN_RESPONSE_MUTATION: usePty ? "missing_token_type" : "",
        PYTHONPATH: fixtureRoot,
      },
      stdio: ["ignore", "ignore", "pipe"],
    });
    const fixtureOutput = { value: "" };
    fixture.stderr.on("data", chunk => {
      fixtureOutput.value = (fixtureOutput.value + chunk.toString()).slice(-16_384);
    });
    fixtureDiagnostics = () => redactFixtureDiagnostics(fixtureOutput.value);

    const environment = {
      HOME: home,
      USER: process.env.USER ?? "ink-runtime-test",
      LOGNAME: process.env.LOGNAME ?? process.env.USER ?? "ink-runtime-test",
      PATH: emptyPath,
      LANG: "C.UTF-8",
      SHELL: "/bin/sh",
      TERM: "dumb",
      TMPDIR: path.join(root, "tmp"),
      CLAUDE_CONFIG_DIR: config,
      CLAUDE_SECURESTORAGE_CONFIG_DIR: secureConfig,
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      INK_SECURITY_SENTINEL: securitySentinel,
    };
    await mkdir(environment.TMPDIR, { mode: 0o700 });
    await waitForPort(port, fixture, fixtureDiagnostics);
    const serverName = "oauth-cli-contract";

    const added = runCore(
      ["mcp", "add", "--transport", "http", "--scope", "user", serverName, `${serverUrl}/mcp`],
      environment,
      neutral,
    );
    assert.equal(added.status, 0, added.stdout + added.stderr);

    const initialGet = runCore(["mcp", "get", serverName], environment, neutral);
    assert.equal(initialGet.status, 0, initialGet.stdout + initialGet.stderr);
    assert.match(initialGet.stdout + initialGet.stderr, /Needs authentication/);

    for (const invalidSecureSelector of [
      "relative-secure-config",
      `${secureConfig}/../${path.basename(secureConfig)}`,
    ]) {
      const invalidSelectorGet = runCore(
        ["mcp", "login", serverName, "--no-browser"],
        {
          ...environment,
          CLAUDE_SECURESTORAGE_CONFIG_DIR: invalidSecureSelector,
        },
        neutral,
      );
      assert.notEqual(
        invalidSelectorGet.status,
        0,
        "invalid secure-storage selectors must fail closed",
      );
      assert.match(
        invalidSelectorGet.stdout + invalidSelectorGet.stderr,
        /MCP OAuth login failed/,
      );
      assert.ok(
        !(invalidSelectorGet.stdout + invalidSelectorGet.stderr).includes(
          invalidSecureSelector,
        ),
        "invalid selector details must remain redacted",
      );
    }

    const loginExecutable = usePty ? fixturePython : bun;
    const loginArguments = usePty
      ? [ptyDriver, "--", bun, core, "mcp", "login", serverName, "--no-browser"]
      : [core, "mcp", "login", serverName, "--no-browser"];
    login = spawn(loginExecutable, loginArguments, {
      cwd: neutral,
      env: environment,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const loginOutput = { value: "" };
    login.stdout.on("data", chunk => {
      loginOutput.value += chunk.toString();
      activeLoginOutput = loginOutput.value;
    });
    login.stderr.on("data", chunk => {
      loginOutput.value += chunk.toString();
      activeLoginOutput = loginOutput.value;
    });
    const urlMatch = await waitForOutput(
      login,
      loginOutput,
      /Open this URL to authenticate:\s*(http:\/\/[^\s]+)/,
    );
    const authorizationUrl = new URL(urlMatch[1]);
    assert.ok(
      authorizationUrl.searchParams.get("state"),
      "authorization URL must carry OAuth state",
    );
    const redirectParameter = authorizationUrl.searchParams.get("redirect_uri");
    assert.ok(redirectParameter, "authorization URL must carry its redirect URI");
    const advertisedRedirect = new URL(redirectParameter);
    assert.equal(advertisedRedirect.href, "http://localhost:3118/callback");
    assert.equal(
      await portAcceptsConnections(Number(advertisedRedirect.port)),
      false,
      "--no-browser must not open a competing loopback callback listener",
    );
    assert.equal(login.exitCode, null, "manual OAuth must remain alive while stdin is open");

    const authorization = await fetch(authorizationUrl, { redirect: "manual" });
    assert.equal(authorization.status, 302);
    const loginPageUrl = authorization.headers.get("location");
    assert.ok(loginPageUrl, "authorize must redirect to the provider login page");
    const providerLoginUrl = new URL(loginPageUrl, serverUrl);
    assert.equal(providerLoginUrl.origin, serverUrl);
    assert.equal(providerLoginUrl.pathname, "/login");
    const state = providerLoginUrl.searchParams.get("state");
    assert.ok(state, "provider login URL must carry OAuth state");
    const loginPage = await fetch(providerLoginUrl, { redirect: "manual" });
    assert.equal(loginPage.status, 200);

    const approval = await fetch(`${serverUrl}/login/callback`, {
      method: "POST",
      body: new URLSearchParams({
        username: "demo_user",
        password: "demo_password",
        state,
      }),
      redirect: "manual",
    });
    assert.equal(approval.status, 302);
    const callbackUrl = approval.headers.get("location");
    assert.ok(callbackUrl?.startsWith("http://localhost:"));
    login.stdin.write(`${callbackUrl}\n`);
    await waitForAuditEvent(audit, "token-exchange-start", login);
    assert.equal(
      login.exitCode,
      null,
      "manual OAuth must remain alive during delayed token persistence",
    );
    const loginExit = await waitForExit(login);
    assert.equal(loginExit, 0, redactSensitiveOutput(loginOutput.value));
    assert.match(loginOutput.value, /Authenticated MCP server oauth-cli-contract/);

    const receipt = await stageReceipt(config);
    assert.deepEqual(receipt.records.map(record => record.stage), successStages);
    assertNoSensitiveStageData(receipt.body, [
      serverName,
      serverUrl,
      state,
      new URL(callbackUrl).searchParams.get("code"),
      "demo_user",
      "demo_password",
    ]);
    await assert.rejects(access(path.join(config, ".credentials.json")));
    const secureCredentialInfo = await stat(path.join(secureConfig, ".credentials.json"));
    assert.equal(secureCredentialInfo.mode & 0o777, 0o600);
    await assert.rejects(
      access(securitySentinel),
      "explicit secure selector must never probe or write the macOS keychain",
    );

    const reconnect = runCore(["mcp", "get", serverName], environment, neutral);
    assert.equal(reconnect.status, 0, reconnect.stdout + reconnect.stderr);
    assert.match(reconnect.stdout + reconnect.stderr, /Connected/);

    const events = (await readFile(audit, "utf8"))
      .trim()
      .split("\n")
      .map(line => JSON.parse(line));
    const registrations = events.filter(event => event.event === "register");
    const authorize = events.find(event => event.event === "authorize");
    const token = events.find(event => event.event === "token");
    assert.ok(
      registrations.length > 0 && authorize && token,
      "fixture must observe DCR, authorize, and token exchange",
    );
    const matchingRegistrations = registrations.filter(
      event => event.client_key === authorize.client_key,
    );
    assert.equal(
      matchingRegistrations.length,
      1,
      "authorize must select exactly one dynamically registered client",
    );
    const [registration] = matchingRegistrations;
    assert.equal(registration.redirect_uris.length, 1);
    assert.ok(
      authorize.client_key === token.client_key,
      "authorize and token exchange must use the same registered client",
    );
    assert.equal(registration.redirect_uris[0], authorize.redirect_uri);
    assert.equal(authorize.redirect_uri, token.redirect_uri);
    assert.equal(authorize.redirect_uri, advertisedRedirect.href);
    assert.equal(new URL(callbackUrl).origin, new URL(authorize.redirect_uri).origin);
    assert.ok(
      events.some(event => event.event === "access-token-check" && event.authenticated),
      "fresh-process get must authenticate with the saved token",
    );

    if (usePty) {
      login = spawn(bun, [core, "mcp", "login", serverName, "--no-browser"], {
        cwd: neutral,
        env: environment,
        stdio: ["pipe", "pipe", "pipe"],
      });
      const schemaFailureOutput = { value: "" };
      login.stdout.on("data", chunk => { schemaFailureOutput.value += chunk.toString(); });
      login.stderr.on("data", chunk => { schemaFailureOutput.value += chunk.toString(); });
      const schemaFailureUrlMatch = await waitForOutput(
        login,
        schemaFailureOutput,
        /Open this URL to authenticate:\s*(http:\/\/[^\s]+)/,
      );
      const schemaFailureAuthorization = await fetch(schemaFailureUrlMatch[1], {
        redirect: "manual",
      });
      assert.equal(schemaFailureAuthorization.status, 302);
      const schemaFailureLoginLocation = schemaFailureAuthorization.headers.get("location");
      assert.ok(schemaFailureLoginLocation);
      const schemaFailureLoginUrl = new URL(schemaFailureLoginLocation, serverUrl);
      const schemaFailureState = schemaFailureLoginUrl.searchParams.get("state");
      assert.ok(schemaFailureState);
      const schemaFailureLoginPage = await fetch(schemaFailureLoginUrl, { redirect: "manual" });
      assert.equal(schemaFailureLoginPage.status, 200);
      const schemaFailureApproval = await fetch(`${serverUrl}/login/callback`, {
        method: "POST",
        body: new URLSearchParams({
          username: "demo_user",
          password: "demo_password",
          state: schemaFailureState,
        }),
        redirect: "manual",
      });
      assert.equal(schemaFailureApproval.status, 302);
      const schemaFailureCallback = schemaFailureApproval.headers.get("location");
      assert.ok(schemaFailureCallback?.startsWith("http://localhost:"));
      login.stdin.write(`${schemaFailureCallback}\n`);
      await waitForAuditEvent(audit, "token-response-mutation", login);
      const schemaFailureExit = await waitForExit(login);
      assert.notEqual(schemaFailureExit, 0, redactSensitiveOutput(schemaFailureOutput.value));
      assert.match(schemaFailureOutput.value, /MCP OAuth login failed/);
      const schemaFailureReceipt = await stageReceipt(config);
      assert.deepEqual(schemaFailureReceipt.records.map(record => record.stage), [
        "action_started",
        "reader_ready",
        "initial_sdk_auth_started",
        "client_information_missing",
        "initial_sdk_auth_completed",
        "callback_line_received",
        "callback_validated",
        "token_exchange_started",
        "client_information_present",
        "code_verifier_present",
        "token_exchange_failed_schema_token_type",
        "flow_failed",
      ]);
      assertNoSensitiveStageData(schemaFailureReceipt.body, [
        serverName,
        serverUrl,
        schemaFailureState,
        new URL(schemaFailureCallback).searchParams.get("code"),
        "demo_user",
        "demo_password",
      ]);
      const afterSchemaFailure = runCore(["mcp", "get", serverName], environment, neutral);
      assert.equal(afterSchemaFailure.status, 0, afterSchemaFailure.stdout + afterSchemaFailure.stderr);
      assert.match(afterSchemaFailure.stdout + afterSchemaFailure.stderr, /Needs authentication/);
    }

    if (!usePty) {
      const privateProviderDescription = "fixture-controlled token failure must remain private";
      login = spawn(bun, [core, "mcp", "login", serverName, "--no-browser"], {
        cwd: neutral,
        env: environment,
        stdio: ["pipe", "pipe", "pipe"],
      });
      const tokenFailureOutput = { value: "" };
      login.stdout.on("data", chunk => { tokenFailureOutput.value += chunk.toString(); });
      login.stderr.on("data", chunk => { tokenFailureOutput.value += chunk.toString(); });
      const tokenFailureUrlMatch = await waitForOutput(
        login,
        tokenFailureOutput,
        /Open this URL to authenticate:\s*(http:\/\/[^\s]+)/,
      );
      const tokenFailureAuthorization = await fetch(tokenFailureUrlMatch[1], {
        redirect: "manual",
      });
      assert.equal(tokenFailureAuthorization.status, 302);
      const tokenFailureLoginLocation = tokenFailureAuthorization.headers.get("location");
      assert.ok(tokenFailureLoginLocation);
      const tokenFailureLoginUrl = new URL(tokenFailureLoginLocation, serverUrl);
      const tokenFailureState = tokenFailureLoginUrl.searchParams.get("state");
      assert.ok(tokenFailureState);
      const tokenFailureLoginPage = await fetch(tokenFailureLoginUrl, { redirect: "manual" });
      assert.equal(tokenFailureLoginPage.status, 200);
      const tokenFailureApproval = await fetch(`${serverUrl}/login/callback`, {
        method: "POST",
        body: new URLSearchParams({
          username: "demo_user",
          password: "demo_password",
          state: tokenFailureState,
        }),
        redirect: "manual",
      });
      assert.equal(tokenFailureApproval.status, 302);
      const tokenFailureCallback = tokenFailureApproval.headers.get("location");
      assert.ok(tokenFailureCallback?.startsWith("http://localhost:"));
      login.stdin.write(`${tokenFailureCallback}\n`);
      await waitForAuditEvent(audit, "token-error", login);
      const tokenFailureExit = await waitForExit(login);
      assert.notEqual(tokenFailureExit, 0, redactSensitiveOutput(tokenFailureOutput.value));
      assert.match(tokenFailureOutput.value, /MCP OAuth login failed/);
      assert.ok(!tokenFailureOutput.value.includes(privateProviderDescription));
      const tokenFailureReceipt = await stageReceipt(config);
      assert.deepEqual(tokenFailureReceipt.records.map(record => record.stage), [
        "action_started",
        "reader_ready",
        "initial_sdk_auth_started",
        "client_information_missing",
        "initial_sdk_auth_completed",
        "callback_line_received",
        "callback_validated",
        "token_exchange_started",
        "client_information_present",
        "code_verifier_present",
        "token_exchange_failed_invalid_grant",
        "flow_failed",
      ]);
      assertNoSensitiveStageData(tokenFailureReceipt.body, [
        serverName,
        serverUrl,
        tokenFailureState,
        new URL(tokenFailureCallback).searchParams.get("code"),
        privateProviderDescription,
        "demo_user",
        "demo_password",
      ]);
      const afterTokenFailure = runCore(["mcp", "get", serverName], environment, neutral);
      assert.equal(afterTokenFailure.status, 0, afterTokenFailure.stdout + afterTokenFailure.stderr);
      assert.match(afterTokenFailure.stdout + afterTokenFailure.stderr, /Needs authentication/);

      const failedCode = "receipt-failure-code-must-not-leak";
      const failedState = "receipt-failure-state-must-not-leak";
      login = spawn(bun, [core, "mcp", "login", serverName, "--no-browser"], {
        cwd: neutral,
        env: environment,
        stdio: ["pipe", "pipe", "pipe"],
      });
      const failureOutput = { value: "" };
      login.stdout.on("data", chunk => { failureOutput.value += chunk.toString(); });
      login.stderr.on("data", chunk => { failureOutput.value += chunk.toString(); });
      await waitForOutput(
        login,
        failureOutput,
        /Open this URL to authenticate:\s*(http:\/\/[^\s]+)/,
      );
      await waitForRuntimeStage(config, "initial_sdk_auth_completed", login);
      login.stdin.write(
        `http://localhost:3118/callback?code=${failedCode}&state=${failedState}\n`,
      );
      const failedExit = await waitForExit(login);
      assert.notEqual(failedExit, 0, redactSensitiveOutput(failureOutput.value));
      assert.match(failureOutput.value, /MCP OAuth login failed/);
      assert.ok(!failureOutput.value.includes(failedCode));
      assert.ok(!failureOutput.value.includes(failedState));
      const failedReceipt = await stageReceipt(config);
      assert.deepEqual(failedReceipt.records.map(record => record.stage), [
        "action_started",
        "reader_ready",
        "initial_sdk_auth_started",
        "client_information_missing",
        "initial_sdk_auth_completed",
        "callback_line_received",
        "flow_failed",
      ]);
      assertNoSensitiveStageData(failedReceipt.body, [
        serverName,
        serverUrl,
        failedCode,
        failedState,
      ]);
      const afterFailure = runCore(["mcp", "get", serverName], environment, neutral);
      assert.equal(afterFailure.status, 0, afterFailure.stdout + afterFailure.stderr);
      assert.match(afterFailure.stdout + afterFailure.stderr, /Needs authentication/);
    }

    const loggedOut = runCore(["mcp", "logout", serverName], environment, neutral);
    assert.equal(loggedOut.status, 0, loggedOut.stdout + loggedOut.stderr);
    const removed = runCore(
      ["mcp", "remove", "--scope", "user", serverName],
      environment,
      neutral,
    );
    assert.equal(removed.status, 0, removed.stdout + removed.stderr);
  } catch (error) {
    if (error instanceof Error) {
      error.message += fixtureDiagnostics();
      error.message += await safeFailureDiagnostics(config, audit, activeLoginOutput);
    }
    throw error;
  } finally {
    login?.stdin.destroy();
    await stopChild(login);
    await stopChild(fixture);
    await rm(root, { recursive: true, force: true });
  }
}

test("headless MCP login writes a safe stage receipt through pipe stdio", async t => {
  if (!(await prerequisites(t))) return;
  await runSuccessfulOAuthContract(false);
});

test("headless MCP login writes a safe stage receipt through a real PTY", async t => {
  if (!(await prerequisites(t))) return;
  await runSuccessfulOAuthContract(true);
});
