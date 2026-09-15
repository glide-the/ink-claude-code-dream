<!-- [Input] Runtime 0.1.10 source, four-platform qualification workflow, publishing workflow and Dream adoption evidence. -->
<!-- [Output] Record source scope and the independently observed qualification, publication and Dream validation states. -->
<!-- [Pos] Current release receipt for the plugin-management repair; 0.1.9 evidence remains immutable history. -->
<!-- [Sync] 2026-09-15: create the 0.1.10 release receipt before CI qualification. -->

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
| Source and focused local validation | Passed before submission; exact commands are reported with the PR |
| Four-platform CI qualification | Pending `Qualify npm Runtime` on the merged `main` SHA |
| Five-package npm publication | Pending automatic `Publish npm Runtime` successor workflow |
| Public registry integrity | Pending publication workflow verification |
| Local Dream adoption | Pending public `0.1.10` installation and resolver validation |
| Dream `screenwriting@screenwriting-skills` business operation | Pending local adoption |

Each row advances only from its own command or workflow receipt. A source commit, PR merge,
or successful version command does not imply publication or Dream adoption.
