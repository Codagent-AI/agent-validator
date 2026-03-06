## Why

Agent-gauntlet currently copies 9 skill directories into every project's `.claude/skills/` (and `.agents/skills/` for Codex). This means every worktree needs its own copy, skills end up in version control unless explicitly gitignored, and updating agent-gauntlet requires re-running `init` in every worktree of every project. Claude Code now has a plugin system that solves exactly this problem -- install once (locally or globally), update in one place.

## What Changes

- **Add `.claude-plugin/` manifest** to the npm package so agent-gauntlet can be installed as a Claude Code plugin
- **Move skills into the plugin** so they're served from the plugin cache instead of copied into each project
- **Move hooks into the plugin** (`hooks/hooks.json`) so start/stop hooks are part of the plugin instead of written to `settings.local.json`
- **BREAKING: Redesign `init` command** to install the Claude plugin (local or global) instead of copying skills and hooks. Single prompt asks local vs global scope. Codex skills still use file copy (to `.agents/skills/` for local, `$HOME/.agents/skills/` for global).
- **Add `update` command** that detects where the plugin is installed (local project or global) and updates it to the version shipped with the current npm package

## Capabilities

### New Capabilities
- `plugin-install`: Claude plugin installation during init (local or global scope), replacing skill-copy approach
- `plugin-update`: Update command that finds and refreshes the installed plugin to match the current package version

### Modified Capabilities
- `init-config`: Init flow changes from copying skills + writing hooks to installing a Claude plugin. Codex skill installation changes to support global (`$HOME/.agents/skills/`) when global scope is selected. Prompt structure changes to a single local/global question.
- `init-hook-install`: Hooks move from `settings.local.json` / `.cursor/hooks.json` into the plugin's `hooks/hooks.json`, removing the need for init to write hook config into project settings files.

## Impact

- **`src/commands/init.ts`** -- Major rewrite of skill and hook installation logic
- **`src/commands/init-hooks.ts`** -- Hook installation moves into plugin; this module may be simplified or removed
- **New `src/commands/update.ts`** -- New command for plugin updates
- **New `.claude-plugin/plugin.json`** -- Plugin manifest added to package
- **New `hooks/hooks.json`** -- Plugin-level hook definitions (start-hook, stop-hook)
- **`package.json`** -- `files` array updated to include `.claude-plugin/` and `hooks/`
- **Existing specs** -- `init-config` and `init-hook-install` specs need delta updates
- **Breaking change** -- Projects that previously had skills in `.claude/skills/` will need to re-run init to switch to the plugin model. Old skill files become orphaned.
