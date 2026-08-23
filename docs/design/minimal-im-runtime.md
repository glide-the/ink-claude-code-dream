<!-- [Input] Read-only Dream/restored-source evidence, official release evidence, Runtime implementation, and acceptance receipts. -->
<!-- [Output] Record the complete decision, architecture, compatibility, release, test, and rollback design in 17 sections. -->
<!-- [Pos] Authoritative design for the minimal Claude Code CLI compatibility envelope. -->

# Minimal IM Runtime design

Evidence and measurements in this document were collected on 2026-08-23. Paths are repository-relative or described by sibling-repository role so the design does not encode one workstation layout.

## 1. Decision and recommendation level

The implemented artifact is a zero-protocol-rewrite compatibility envelope, not a reduced Claude Code core. Its core loading reduction is **0**. Every real command still loads the unmodified official `2.1.235` binary, while the envelope adds one Node process and its own executable/chunk reads.

Recommendation levels:

| Level | Choice | Decision |
| --- | --- | --- |
| Production default / performance baseline | Point Dream's existing `CLAUDE_CODE_CLI_PATH` directly to a verified official `2.1.235` executable | Recommended; lowest added process/file overhead and default rollback |
| Optional operations layer | This repository's CLI envelope | Use only when deployment manifest, TMPDIR guard, supervision, timeout, checksums, SBOM, and rollback receipts are worth the overhead |
| Memory/cold-start optimization | This envelope | Not recommended; it cannot reduce opaque core loading |
| Current-core fork or restored-source repack | Rebuild `2.1.235` from restored `2.1.88` | Rejected and fail-closed: version/behavior mismatch and no established right to redistribute restored all-rights-reserved source |

On one macOS arm64 host, nine final direct-shebang `--version` samples measured official median 47.64 ms and envelope median 71.86 ms: +24.22 ms / +50.8%. `--help` stdout/stderr/exit bytes matched. This proves negative overhead exists on that host; it is not a Linux forecast and no memory improvement is claimed.

## 2. Scope, non-goals, and evidence rules

In scope: Dream's actual CLI/SDK/MCP paths; start/resume/lifecycle contracts; opaque headless and MCP CLI forwarding; release metadata; Node-compatible bundle; Linux x64/arm64 strategy; deterministic archive; rollback.

Out of scope: copying Dream business logic; changing Python SDK or Dream; deleting MCP; authenticating a real user; making a model call; modifying official Claude core; asserting undocumented current native internals; distributing restored source.

The Dream repository and restored-source repository were read-only evidence. The restored checkout at commit `a8a678cb6244e6770e1e421767ff0987a1d95549` explicitly corresponds to Claude Code `2.1.88`; it is historical feasibility/reference material only. Official current release/version claims use Anthropic's [GitHub releases](https://github.com/anthropics/claude-code/releases), registry metadata, and [official CLI documentation](https://docs.anthropic.com/en/docs/claude-code/cli-usage).

## 3. Version and release-form verification

| Component | Dream/current evidence | Constraint |
| --- | --- | --- |
| Claude Code | Dream locks `2.1.235` | Envelope accepts exactly `2.1.235` at doctor/version diagnostics |
| Python Agent SDK | `claude-agent-sdk==0.2.140` | Unchanged; existing `cli_path` path only |
| Python MCP | `mcp==1.27.1` | Regression matrix covers `1.27.0` and `1.27.1`; SDK declares `>=1.23,<3` |
| Dream Node | Docker `22.18.0` | Bundle target `node22`; supported `>=22,<25` |
| Build Bun | `1.2.20` | Dependency/build runner only; production shebang is Node |
| Evidence host Node | `24.13.0` | Acceptance host, not deployment pin |
| Restored source | Claude Code `2.1.88` | Reference only, never copied into release |
| Official channels observed | GitHub/npm latest `2.1.241`; npm/installer stable tag `2.1.231` | “latest” and staged “stable” are distinct; neither silently replaces Dream's pin |

Upgrade history relevant to compatibility:

- Dream commit `da21d67` moved from legacy SDK `0.0.25` to Agent SDK `0.2.128`; that SDK carried CLI `2.1.220`.
- Dream commit `3ee15d9` rolled the external CLI back from `2.1.220` to `2.1.108` after the seccomp settings route failed, while retaining SDK `0.2.128`.
- Dream commit `942343f` paired SDK `0.2.140` with CLI `2.1.235` and added user MCP Resources/OAuth. SDK change `0f005fa` replaced the tools-only hand bridge with the real MCP in-memory transport and supports MCP 1.x/2.x; `fcdae22` kept stdin open for `can_use_tool`.
- Dream's Python `mcp` lock is `1.27.1`; `1.27.0` and `1.27.1` are the two concrete regression targets here.

The official `2.1.241` top npm package observed was only about 175 KB of wrapper/install/type files and selected platform binaries through optional dependencies. The linux-x64 package contained one 342,636,848-byte dynamically linked ELF whose needed libraries included glibc-family system libraries and whose strings exposed Bun runtime symbols. That packaging is strong evidence that the latest patch cannot be reconstructed from the historical `2.1.88` source map.

## 4. Dream feature matrix

| Dream behavior | Use | Envelope responsibility | Acceptance status |
| --- | --- | --- | --- |
| JSON/JSONL and partial streaming | Required | Opaque stdin/stdout/stderr | Byte forwarding passed; no provider E2E |
| Bidirectional permissions/control | Required | Keep stdin open and never parse frames | Upstream transport + opaque test passed |
| Tools | WebFetch, WebSearch, Read, Write, Edit, MultiEdit, Grep, Glob, LS, NotebookRead, TodoRead/Write, TaskCreate/Update/List/Get, Bash/BashOutput, Skill, internal MCP | Preserve argv/config/core | Delegated to official core |
| Agent/Task/subagents | Conditional; foreground forced, background disabled; transcript/sidebar projection exists | Preserve hooks, control and transcript paths | Cannot remove; no model E2E |
| MCP | stdio, HTTP, SSE, SDK in-process, OAuth, Resources, user servers | Preserve CLI/config/env; never replace with tools-only bridge | CLI and 1.27.x in-memory matrix passed; real OAuth not run |
| Plugins/skills/hooks | Required/conditional | Preserve repeated `--plugin-dir`, settings and control frames | Opaque argv passed; material not packaged |
| Workspace/sandbox/TMPDIR | Required | Preserve cwd/settings; validate exact server-owned `.claude-tmp` | Provider-free validation passed |
| Transcript/resume | Required | Preserve config dir, resume argv and lifecycle | Opaque resume passed; DB/business E2E unclaimed |
| Cancel/timeout/crash | Required | Supervise process group, TERM→KILL, preserve exit | Provider-free lifecycle tests passed |
| Remote Control/Remote Session/teams/swarm | No Dream business use found | No claim that native internals are removable | Marked Dream-unused only |

## 5. Start, resume, and MCP call chains

Dream's start path is `service.py → AgentRunOptions → agent_runner ClaudeAgentOptions → SimpleClaudeAgentSDKClient → ClaudeSDKClient → SubprocessCLITransport`. Resume is selected from database `claude_session_id`, runtime contract version, and a local transcript probe; the runner then sets `sdk_options.resume`.

```mermaid
sequenceDiagram
    autonumber
    participant API as "Dream service.py"
    participant Runner as "AgentRunOptions / agent_runner"
    participant Env as "sdk_env existing helper"
    participant Client as "SimpleClaudeAgentSDKClient"
    participant SDK as "Unchanged SDK 0.2.140"
    participant Wrap as "CLI envelope"
    participant Core as "Official Claude Code 2.1.235"
    participant MCP as "MCP stdio/HTTP/SSE/SDK"
    participant State as "Transcript / DB / workspace"
    participant McpSvc as "Dream MCP Resources/OAuth service"

    API->>State: Load thread, contract, claude_session_id
    State-->>API: DB state + local transcript probe
    API->>Runner: AgentRunOptions(resume decision, cwd, tools, hooks)
    Runner->>Env: apply_cli_path_to_options(options)
    Env-->>Runner: ClaudeAgentOptions.cli_path from CLAUDE_CODE_CLI_PATH
    Runner->>Client: options + server-owned CLAUDE_CODE_TMPDIR
    Client->>SDK: ClaudeSDKClient.query / receive_response
    SDK->>Wrap: direct exec "-v" (no TMPDIR required)
    Wrap->>Core: "--version" exact diagnostic
    Core-->>Wrap: 2.1.235
    Wrap-->>SDK: version text
    Note over SDK,Wrap: SDK 0.2.140 swallows probe errors; deployment doctor remains the exact-version trust boundary
    SDK->>Wrap: direct exec headless stream-json argv
    Wrap->>Wrap: reject SDK skip flag; validate TMPDIR/cwd boundary
    Wrap->>Core: spawn once, same argv/env/cwd/stdin/out/err
    Core->>MCP: external transports and SDK control messages
    MCP-->>Core: tools/resources/prompts/ping/audio/structuredContent
    Core-->>SDK: system/assistant/result/control JSONL
    SDK-->>Client: parsed streaming messages
    Client-->>API: events and completion
    API->>State: persist transcript projection and claude_session_id

    par User MCP management path
        McpSvc->>Env: resolve_claude_cli_path()
        Env-->>McpSvc: same CLAUDE_CODE_CLI_PATH wrapper
        McpSvc->>Wrap: mcp add/get/list/login/logout/remove/help/version
        Wrap->>Core: opaque management argv, no thread TMPDIR
        Core-->>McpSvc: identical output/exit or OAuth PTY stream
    and Cancellation / timeout
        API->>Wrap: SIGTERM or timeout policy
        Wrap->>Core: process-group TERM, bounded grace, then KILL
        Core-->>Wrap: close/exit
        Wrap-->>SDK: conventional signal code, child code, or 124 timeout
    end
```

## 6. Retain, lazy-load, and removable modules

| Classification | Modules/behavior | Rationale |
| --- | --- | --- |
| Must retain | Entire current official native core; stream-json/control; tools/permissions; all MCP transports and SDK bridge; plugins/skills/hooks; workspace/sandbox; transcript/resume; conditional Agent/subagent; lifecycle | Core is opaque and Dream uses or conditionally uses these paths |
| Envelope hot path | CLI entry and launcher chunk | Needed for every forwarded command and supervision |
| Envelope lazy path | Release manifest/hash code | Loaded only for `-v`, `--version`, `--runtime-manifest`, or doctor; never on normal main/MCP launch |
| Dream-unused observation only | Remote Control, Remote Session, teams, swarm | Absence in Dream does not prove current native dependencies are safely deletable |
| Safe exclusion from package | Core binary, workspace/transcripts, plugin materialization, OAuth/settings/credentials/secrets | External or mutable/sensitive material, never build input |
| Safe source deletion | SDK manifest negotiation/bridge code | Removed after scope change; upstream SDK never consumes a Runtime manifest |

Tree-shaking only reduces this small envelope. It does not tree-shake a separately spawned 300+ MB native core, so the core reduction remains 0.

## 7. MCP compatibility matrix

| Surface | 1.27.0 | 1.27.1 | MCP 2.x | Envelope behavior |
| --- | --- | --- | --- | --- |
| initialize/version negotiation | Passed in disposable public-package environment | Passed | SDK declares supported `<3`; not rerun here | No parsing |
| ping | Passed | Passed | Delegated | No parsing |
| tools/list + tools/call | Passed | Passed | Delegated | No tools-only replacement |
| resources/list | Passed | Passed | Delegated | Full SDK in-memory transport preserved |
| prompts/list | Passed | Passed | Delegated | Full SDK in-memory transport preserved |
| audio + structuredContent | Passed | Passed | Delegated | Raw MCP result preserved by SDK |
| stdio / HTTP / SSE | Config/argv preserved | Config/argv preserved | Delegated | Official CLI owns transports |
| OAuth / user Resources | Management argv passed | Management argv passed | Delegated | `mcp login/logout/get/add/remove` transparent; no live credential test |

The matrix uses public `claude-agent-sdk==0.2.140` in disposable environments, not an SDK checkout. A first PyPI attempt failed on invalid response metadata; one Aliyun mirror retry succeeded. No SDK/Dream environment was modified.

## 8. Alternatives evaluated

| Alternative | Core reduction | Compatibility risk | Verdict |
| --- | ---: | --- | --- |
| Direct verified official CLI through existing `CLAUDE_CODE_CLI_PATH` | 0 | Lowest | Production recommendation/baseline |
| Official settings/tool/config reduction | Unknown/usually 0 | Can remove Dream-required tools/MCP/plugins | Use only feature-by-feature, not presented as core optimization |
| This envelope + capability bootstrap/lazy manifest | 0 | Low protocol risk, measurable process overhead | Optional operational carrier |
| Tree-shake/bundle the envelope | 0 | Low | Implemented, but only benefits wrapper files |
| Small binary patch | Unproven | High; native patch/update/signature risk | Reject without official patch surface |
| Full current fork | Unknown | Unmaintainable without legal/current source | Fail closed |
| SDK-only launcher/fork | 0 | User prohibited SDK changes; duplicates upstream | Rejected |
| Repack restored `2.1.88` | Not comparable | Version mismatch, behavior drift, distribution-rights concern | Reference scripts/evidence only; never publish |

## 9. Envelope architecture

The release entrypoint is an executable ESM file with `#!/usr/bin/env node`. SDK and Dream MCP code execute it directly, just like a CLI binary. The entry lazy-imports the launcher. The launcher resolves the external official core from `INK_CLAUDE_CODE_EXECUTABLE` or `claude` on PATH, prevents self-recursion, removes envelope control variables from the child, and forwards argv/cwd/stdin/stdout/stderr.

No JSON, JSONL, MCP, settings, transcript, plugin, OAuth, or credential payload is parsed or logged. `mcp …`, top-level single-argument help, and version diagnostics are not thread launches. Empty argv is interactive and requires the thread TMPDIR.

## 10. CLI integration and Runtime-owned manifest

The only production integration is existing upstream behavior:

```text
CLAUDE_CODE_CLI_PATH
  → Dream sdk_env.apply_cli_path_to_options
  → ClaudeAgentOptions.cli_path
  → upstream SubprocessCLITransport direct exec
```

Dream MCP Resources/OAuth uses `sdk_env.resolve_claude_cli_path` and reaches the same executable. Python SDK `0.2.140` remains byte-for-byte unchanged.

`release-manifest.json` uses `ink-claude-cli-envelope/v1` and is owned by this Runtime. It records entrypoint, Runtime/core versions, protocol semantics, CLI integration, management commands, MCP regression versions, and trust boundary. The SDK does not discover, parse, validate, or negotiate it. `--runtime-manifest` and `--runtime-doctor` are operator diagnostics only.

## 11. Bootstrap, lazy loading, and build proof

The main CLI entry has dynamic imports for launcher and manifest paths. The launcher itself dynamically imports manifest code only for version/doctor. Normal headless and MCP launches neither read `release-manifest.json` nor start an extra version process; tests force the manifest path to a missing path while main succeeds.

The esbuild metafile shows `src/cli.ts → src/launcher.ts` as a dynamic import and `src/launcher.ts → src/manifest.ts` as a dynamic import. Release output has a small entry plus separate launcher/manifest chunks and external maps. This is a minimal wrapper hot path, not evidence that an official core module went unloaded. The official child still loads normally.

## 12. Protocol, lifecycle, and exit contract

- SDK `-v` calls start the wrapper once and the official version command once without TMPDIR.
- A normal wrapper main call starts the official core exactly once; it never pre-probes. Upstream SDK separately performs its own `-v`, so one SDK connection has one version core process followed by one main core process, plus wrapper overhead on both.
- Headless/resume/interactive launches require an absolute real `.claude-tmp` directory with mode 0700 or stricter; with declared workspace root it must be exactly its `.claude-tmp` child.
- The wrapper rejects non-empty `CLAUDE_AGENT_SDK_SKIP_VERSION_CHECK` for non-management launches before spawning core.
- Signals target the child's process group. Timeout produces 124. Child exit codes pass through. Signals map to conventional `128+signal`. When the leader closes during termination, the force timer is cleared and descendants are killed immediately instead of waiting the full grace.
- The current upstream SDK version check catches and ignores probe errors; therefore exact pin enforcement is a deployment `--runtime-doctor`/artifact-selection responsibility. The skip-variable rejection closes the explicit bypass, not that upstream error-swallowing limitation.

## 13. Security and material boundaries

The envelope validates server-owned TMPDIR for thread launches, avoids symlinks, constrains a declared workspace relationship, executes argv arrays without a shell, prevents core resolution from selecting itself, and strips `CLAUDE_CODE_CLI_PATH` plus `INK_CLAUDE_*` controls before spawning core. It never echoes argv/env on errors.

Release verification rejects credentials/tokens, transcript paths, workspace/plugin/OAuth/settings/secret material, obsolete SDK-manifest strings, files over 10 MiB, missing source maps, an unchecksummed/escaping/non-executable entrypoint, and a non-external core SBOM declaration. The core remains an independently verified external artifact.

## 14. Build, platform, package, and SBOM

Bun `1.2.20` owns dependency resolution and `bun.lock`; esbuild `0.25.9` targets Node 22 ESM with splitting, external source maps without sources content, and Node built-ins. The production executable runs with Node, not Bun.

The release contains 15 files: entry/chunks/maps, `release-manifest.json`, evidence/platform/discovery/build/rollback manifests, checksums, and CycloneDX SBOM. It contains no Claude core. The deterministic tar writer sorts entries and fixes mtime/uid/gid/owner/mode/gzip timestamp. Two builds at `SOURCE_DATE_EPOCH=1787443200` produced identical inventory and archive hashes.

Linux strategy is glibc x64 and arm64 with exact official `2.1.235` package integrity/shasum/size pins in `platforms.json`; musl is fail-closed. Dynamic-library evidence applies to the separately acquired official platform binary, not to this pure-Node-built-ins release. Each deployment must verify the platform package, run doctor, then select the immutable entrypoint.

## 15. Test impact, commands, results, and limits

Recorded impact before testing covered argv/stdio/cwd/env, TMPDIR, SDK cli_path, MCP CLI, lifecycle, lazy imports, exclusions, and reproducibility.

| Command | Exit/result | Key evidence |
| --- | --- | --- |
| `bun run build` | 0 | Node 22 split release generated |
| `node scripts/verify-release.mjs` | 0 | 15 files, 14 checksums, executable confined, core absent |
| `node --test tests/*.test.mjs` | 0; 12/12 | Protocol/MCP CLI/TMPDIR/skip/crash/timeout/cancel/lazy paths |
| `node scripts/run-upstream-sdk-contract.mjs` | 0 | Unchanged SDK 0.2.140; direct shebang cli_path; one probe + one main; NDJSON passed |
| `bun run test:acceptance` | 0 | Recorded fake median manifest 19.90 ms, version 42.19 ms, main 40.50 ms; timing varies by run; core reduction 0 |
| `UV_DEFAULT_INDEX=… bun run test:mcp-matrix` | 0 after one mirror retry | MCP 1.27.0/1.27.1 full in-memory matrix passed |
| `INK_ACCEPTANCE_REAL_CLAUDE=… bun run test:official-difference` | 0 | macOS arm64 official 47.64 ms vs envelope 71.86 ms; help bytes identical |
| `bun run test:reproducible` | 0 | Two archive and inventory digests identical |

Failures and fixes: the default npm registry refused dependency downloads, so Bun installation used a reachable registry before freezing the lock; the first cross-SDK runner incorrectly resolved the venv symlink to bare Python and lost site-packages, fixed by executing the venv entry directly; the first PyPI MCP fetch returned invalid metadata, and the single permitted mirror retry passed.

Not claimed: a real model turn, real OAuth/browser callback, live user MCP state, Dream DB/transcript persistence, production sandbox, Linux timing/RSS, or behavior equivalence of a modified Claude core. MCP/OAuth/Resources and extension rows distinguish provider-free boundary proof from delegated/not-E2E behavior.

## 16. Operations, activation, rollback, and release

Build and verify an immutable version directory, verify official core checksum/platform and `2.1.235`, run `--runtime-doctor`, then set `CLAUDE_CODE_CLI_PATH` to the release executable through deployment configuration. Do not hardcode a repository path. If the official core is already named `claude` on PATH, no extra core variable is needed; otherwise configure `INK_CLAUDE_CODE_EXECUTABLE` to its verified absolute path.

Rollback is configuration-only: restore `CLAUDE_CODE_CLI_PATH` to the previously verified official executable. Official direct runtime is the default rollback, not another wrapper release. Never mutate an immutable release directory; retain its checksum/SBOM/rollback receipts. This task does not create a PR, merge, or deploy.

## 17. Exact SDK-facing interface, deliverables, and final gaps

SDK integration requires no new SDK code or schema:

- Interface: existing `ClaudeAgentOptions.cli_path`.
- Discovery: existing `CLAUDE_CODE_CLI_PATH` resolved by Dream's `sdk_env.apply_cli_path_to_options`; MCP uses `resolve_claude_cli_path`.
- Executable: `dist/release/ink-claude-runtime-0.1.0/bin/ink-claude-runtime.mjs` after build, referenced by deployment-specific absolute path.
- Diagnostics: executable `-v`, `--version`, `--runtime-manifest`, `--runtime-doctor`.
- Build/verify: `bun run build`, `bun run verify`, `bun run release:pack`.
- Artifacts: immutable release directory, deterministic tar/sha sidecar, Runtime release/evidence/platform manifests, checksum inventory, source maps, SBOM, build and rollback receipts.

Final verdict: the envelope is maintainable and behavior-preserving at the tested process boundary, but it is not the requested core memory/cold-start reduction. Because legal/current reconstructable `2.1.235` source is unavailable, a behavior-equivalent minimized core fork cannot be produced or claimed. The honest production optimization baseline remains the official runtime; the delivered envelope is an optional verification/supervision/rollback vehicle with measured negative startup overhead.
