<!-- [Input] Runtime 0.1.10 source, four-platform qualification workflow, publishing workflow and Dream adoption evidence. -->
<!-- [Output] Record source scope and the independently observed qualification, publication and Dream validation states. -->
<!-- [Pos] Current release receipt for the plugin-management repair; 0.1.9 evidence remains immutable history. -->
<!-- [Sync] 2026-09-15: finalize CI qualification, npm publication, Dream adoption and business-operation evidence. -->

# Runtime 0.1.10 plugin management repair

## Change

Runtime `0.1.10` restores the original noninteractive `plugin`/`plugins` and Marketplace
Commander registrations in the source-bound headless build. It preserves the original
`src` byte inventory and keeps interactive startup disabled. The SDK process contract now
creates a disposable local Marketplace, installs its plugin through the compiled CLI,
checks the V2 registry and lifecycle commands, loads the installed Skill, then uninstalls it.

## Release states

| State | Result |
| --- | --- |
| Source and focused local validation | Passed in [Runtime PR #26](https://github.com/glide-the/ink-claude-code-dream/pull/26), merged as `70043df073f065f9b375cefdb4a2aa7f140d3fd9` |
| Runtime CI | [Passed](https://github.com/glide-the/ink-claude-code-dream/actions/runs/34942254270) on the release source |
| Four-platform CI qualification | [Passed](https://github.com/glide-the/ink-claude-code-dream/actions/runs/34942254287); Darwin/Linux arm64/x64 each ran SDK, MCP and local Marketplace lifecycle contracts |
| Five-package npm publication | [Passed](https://github.com/glide-the/ink-claude-code-dream/actions/runs/34943560980); selector and four platform packages are public at `0.1.10` |
| Public registry integrity | Wheel and sdist acceptance resolve SDK `0.2.145`, CLI `2.1.241`, Runtime `0.1.10` and `pluginManagement: true`; public Darwin arm64 passed the full Dream Marketplace pipeline |
| Dream adoption | [Dream PR #60](https://github.com/glide-the/im-dream/pull/60) merged as `0274ad825a780f70804585e391b6dd46173f19a6`; [backend image CI](https://github.com/glide-the/im-dream/actions/runs/34952828668) and [frontend build CI](https://github.com/glide-the/im-dream/actions/runs/34952828097) passed |
| Dream `screenwriting@screenwriting-skills` business operation | Ready at approved commit `50825325b3940a17f032129851f5c83382863000`; operation `cop_27d25716ff29427a9675b5e52057413e`, idempotent verification `cop_e9f526390ec94b83b14d5d5b268f4c43`, installation `cpi_b31de00a4ad24c7d8bb003496b523ba0` |

Each row advances only from its own command or workflow receipt. A source commit, PR merge,
or successful version command does not imply publication or Dream adoption.

## Published package integrity

| Package | npm integrity |
| --- | --- |
| `@glide-the/ink-claude-code-dream` | `sha512-QlpFq6CvcA2DRudLgJgaQMc5aP7MfJJ5CADY7rbgraTGq0FAF+VJx8VvK/6xFpHb+FgZOCgjlXqmS0nOUIjzuQ==` |
| `@glide-the/ink-claude-code-dream-darwin-arm64` | `sha512-bwb3BrIdcNxcUyPFwoUup2QCGkKfun5L/rvmfrz11w1gydPkGj/Dy6n+j/T9BXYYfFvwFWG0f1EKjn2PMYCgCw==` |
| `@glide-the/ink-claude-code-dream-darwin-x64` | `sha512-GbvGTyrxJ0L0+JLuAW0wCvi/1Q2X2TxHMPySFhw61xTzVahjaIKPgQBGEE12im3C40lxyXLjiC0go7PxIOgRwA==` |
| `@glide-the/ink-claude-code-dream-linux-arm64` | `sha512-79AWiXfnbcBpz0MhyBnWgoZje57Xa30PCuP6J6Yj3vMmeSgjv+8fbJe/LRf84ApK6rAnc4pEEBc+Znrx8KzhHQ==` |
| `@glide-the/ink-claude-code-dream-linux-x64` | `sha512-Q0aOjtgfFE6vY21cj+Zrco0wDGm0aWRTCqDN282aYy6NqETd7hiGZX3yMs485ov/ybqQY2KusGVJhqGfZqgv+g==` |

The real install also exposed a path-ordering mismatch between Admin `0.1.0`
approval digests and Dream canonical artifact digests. [Admin PR #14](https://github.com/glide-the/dream-im-platform/pull/14)
released `0.1.1` with canonical component ordering. Dream validates the exact legacy
whole-path digest only for immutable `0.1.0` receipts and continues to identify artifacts
with the canonical digest.
