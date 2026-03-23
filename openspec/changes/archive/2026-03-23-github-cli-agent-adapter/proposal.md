## Why

The GitHub Copilot CLI is now a full coding agent (GA February 2026) with skill support, built-in agents (Explore, Task, Code-review), and MCP server extensibility. The current `github-copilot` adapter references the standalone `copilot` binary directly, treats it as a review-only tool with no skill directories, and has no plugin installation support. The preferred invocation is now `gh copilot` (via the GitHub CLI wrapper), which auto-manages the Copilot CLI binary. Users of `gh copilot` cannot use the agent-validator development workflow (skills like `/validator-run`, `/validator-setup`) because the adapter doesn't install or surface them.

## What Changes

- **Update the `github-copilot` adapter** to invoke via `gh copilot` instead of standalone `copilot`, declare skill directories (`.github/skills/` project, `~/.copilot/skills/` user), and implement `detectPlugin`/`installPlugin`/`updatePlugin` for skill file installation
- **Update the `init` command** to treat `github-copilot` as a skill-capable CLI — install gauntlet skills into Copilot CLI's skill directories and show correct post-init instructions
- **Update execution flags** to align with the current `gh copilot` flag surface (`--prompt`, `--allow-tool`, `--agent=`)
- **Remove legacy limitations** — delete comments referencing "feature request #618" and null skill/command returns that are no longer accurate
- **Add `github-copilot` to `NATIVE_CLIS`** so users get the `/validator-setup` slash-command instruction after init

## Capabilities

### New Capabilities
- `copilot-adapter-upgrade`: Update the GitHub Copilot adapter to use `gh copilot` invocation, add skill directories (`.github/skills/`, `~/.copilot/skills/`), update execution flags, and support the adapter plugin lifecycle (detect → install → update)
- `copilot-plugin-install`: Add skill-file-based plugin detection and installation for the Copilot CLI, following the Cursor adapter pattern of copying skills to the appropriate directories

### Modified Capabilities
- `init-config`: Update post-init instructions and CLI classification to treat Copilot CLI as a native, skill-capable CLI
- `plugin-install`: Add Copilot CLI plugin installation strategy (skill file copy) to the init flow

## Impact

- **Code**: `src/cli-adapters/github-copilot.ts` (major rewrite), `src/cli-adapters/index.ts` (re-export), `src/commands/init.ts` (NATIVE_CLIS, ADAPTER_CONFIG, post-init instructions)
- **Tests**: `test/cli-adapters/copilot-model-resolution.test.ts` (update for `gh copilot` invocation) and new tests for plugin detect/install
- **Config**: No schema changes needed — adapter config is already generic
- **Skills**: No changes to skill content — the same skills are installed, just to `.github/skills/` instead of not being installed at all
