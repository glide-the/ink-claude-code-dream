<!-- [Input] Upstream Shell inheritance evidence, clean-room sandbox policy, Dream server-bound env contract, ntn 0.15.1 inspection, and provider-free tests. -->
<!-- [Output] Record the Runtime 0.1.4 Notion CLI production-Bash design, evidence, real Dream receipt, capability chain, and publication boundary. -->
<!-- [Pos] Auditable task record for stable capability sandbox.notion-cli. -->
<!-- [Sync] 2026-08-30: complete and authorize the Runtime 0.1.4 Notion CLI clean-room release. -->

# Notion CLI production Bash sandbox

## Finding

This change closes a clean-room production sandbox allowlist gap. It is not described as a generic source-migration omission.

The read-only upstream reference at commit `a8a678cb6244` starts Bash with `...subprocessEnv()` in `src/utils/Shell.ts`, so Bash inherits the Runtime process environment. Before this task, clean-room Runtime commit `7c7598f` rebuilt the Bash boundary independently and `src/cleanroom/sandbox/production.ts#cleanEnvironment` retained only locale, `PATH`, `TERM`, and the Runtime-owned `TMPDIR`. Dream and SDK already projected the current actor/thread Notion variables into each Runtime process; the independent clean-room allowlist then deliberately removed them. The missing behavior therefore belongs to this repository's production-sandbox capability contract.

## Fail-closed projection

At each Runtime process startup, including a new turn or resume, the production adapter validates the current process projection against the canonical Workspace:

- `NOTION_HOME` must equal the real canonical `{workspace}/.notion-home`, be a non-symlink directory, and have mode `0700`.
- `NOTION_KEYRING` is not trusted from ambient input; Bash always receives fixed file mode value `0` after the home validation succeeds.
- `NOTION_API_TOKEN` is optional. If present, it must be nonempty, equal to its trimmed form, and contain no NUL, carriage return, or newline.
- `NOTION_WORKERS_CONFIG_FILE` is optional and is passed only when it is exactly `{workspace}/.notion-home/workers.json`, already exists as a canonical regular file, and is not group/world writable. Missing actor/thread projection therefore correctly remains unset.
- `ntn` must resolve from the Runtime `PATH` to a canonical regular executable named exactly `ntn`, owned by the current user or root, not group/world writable, and have native Mach-O or ELF magic. Scripts, shims, and interpreter chains fail closed.

If the home or executable contract fails, none of the Notion variables or network carve-outs is added. A foreign thread home, ambient-only token, symlink home, or invalid native file cannot partially enable the capability. A wrong or missing workers path omits only `NOTION_WORKERS_CONFIG_FILE`, so it can never select another thread's configuration. There is no session cache; resume re-evaluates the environment supplied to the new Runtime process.

The validated values are copied only into production Bash. `src/cleanroom/environment.ts` removes the same names from provider-helper and stdio MCP child environments, including names explicitly repeated by an MCP config. Hook execution does not receive this projection. The implementation does not modify a user's global shell environment or persist credentials.

## ntn 0.15.1 and network contract

The inspected executable was `/Users/dmeck/.local/bin/ntn`, version `0.15.1`, SHA-256 `68b20490ca45d5714beb80164aa9caea7d2a2356e168aeee7a81a95fb0b645de`. It is a native arm64 Mach-O executable with no shebang/interpreter and only macOS system Frameworks and `/usr/lib` dynamic dependencies. The sandbox therefore grants read access to the exact canonical executable file, not merely an assumed entry script.

The CLI has no separate `identity` subcommand; read-only identity is the Notion public API `GET /v1/users/me`. `ntn api` also retrieves the public API specification/documentation, and `ntn doctor` performs its update check. The conditional strict allowlist is therefore exactly:

- `api.notion.com:443` for public API identity/operations;
- `developers.notion.com:443` for the public API specification/documentation;
- `ntn.dev:443` for the doctor update check.

`www.notion.so` is not required by the inspected read-only doctor/identity contract and is not allowed. The base sandbox remains default-deny.

## Stable capability and generated evidence

The stable capability ID is `sandbox.notion-cli`. Its source-of-truth is `runtime/cleanroom-artifact-policy.json#requiredCapabilities`. `scripts/package-cleanroom-npm.mjs` maps that list, in order, into every generated clean-room platform package's `runtime/manifest/capabilities.json` and the selector package's `manifest/capabilities.json`, using schema `ink-cleanroom-capability-evidence/v1`. Dream should require this ID and fail closed if it is absent.

`runtime/local-capabilities.json` and `runtime/capabilities.json` describe the separate local-core and official-envelope artifacts. They intentionally do not claim the clean-room-only capability. Provider-free candidate staging tests inspect all five generated manifests, rather than forcing a misleading ID into those other artifact families.

## Version-bound real Dream acceptance

The exact darwin-arm64 candidate passed the normal Dream public Chat path on 2026-08-30 with an existing connected actor and the normal Gateway/PostgreSQL topology. The retained three-turn thread exercised:

- a fresh Agent Bash turn where the API token and file-auth mode were present, the absent workers file remained unset, and `ntn 0.15.1`, doctor, and read-only current-user identity all succeeded;
- a page reload followed by a same-thread resume that repeated the same safe result from a newly projected Runtime environment;
- an ordinary no-tool Chat turn that completed without adding another Bash part.

All six persisted Bash parts were `output-available`. The browser test passed 1/1 in 1.8 minutes with no application diagnostics, no Notion mutation, and no credential, environment value, internal path, API body, or page content in its evidence. The authorized v2 receipt is `runtime/attestations/dream-real-business-acceptance-0.1.4.json`, SHA-256 `87f3d1c6040e5462d85e6259a5cb16509a5d26838d5299d1ba350a4ba463dbea`; it binds source tree `266362ac3543ca6d5dc7a400e2a23ac718e231abb761eab8f824726ab595de81` and darwin-arm64 executable `969f9193be8750e2573e4c4ea9c3556d48687925d9f57b8ea676669d753980dd`.

## Version and release boundary

The release version is `0.1.4`. The checked clean-room policies require:

- `productionEligible=true`;
- `publicationAllowed=true`;
- `redistributionAllowed=true`;
- `npmPublishAllowed=true`;
- a passing, authorized `0.1.4` darwin-arm64 real-business receipt;
- four checked native-format/package/reproducibility target qualifications;
- main-branch same-SHA CI qualification before npm publication;
- four platform packages published before the selector.

The historical `0.1.3` acceptance receipt remains unchanged. Provider-free stage artifacts carry an explicit fixture marker and cannot satisfy the formal prepack contract. The real acceptance ran the exact native candidate through Dream's reviewed absolute-path candidate lane; it did not install the provider-free stage globally. This task does not publish npm or modify the global installation. Dream was explicitly restarted for acceptance and remains running on the bound candidate; restored source remains unchanged.

## Evidence lanes

The source/unit lane covers exact and foreign homes, optional/malformed values, canonical paths, native executable validation, and host scope. The OS lane executes a native fixture and installed `ntn 0.15.1` inside the real production adapter. The full compiled lane uses fake Messages SSE to drive Runtime → Bash across fresh and resumed processes while a stdio MCP sentinel checks exclusion. Dream bootstrap checks the provider helper exclusion. All test output is limited to `set`/`unset` or success states, and token material is asserted absent from requests, protocol frames, and stderr.
