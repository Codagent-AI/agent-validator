## Why

Cursor is currently supported only as a code reviewer, but as of v2.5 it has a full plugin system (marketplace, skills, commands, hooks, rules) that is structurally near-identical to Claude Code's. The SKILL.md format is an open standard shared by both agents. This means we can promote Cursor to a first-class coding agent with plugin-delivered skills — the same way Claude Code works today — with relatively bounded effort.

## What Changes

- Add `.cursor-plugin/plugin.json` manifest alongside existing `.claude-plugin/plugin.json`
- Register agent-gauntlet on the Cursor marketplace for plugin distribution
- Update `CursorAdapter` to support skill directories and plugin installation
- Update `init` flow to handle Cursor plugin installation (marketplace add + plugin install with scope)
- Include `.cursor-plugin/` and any Cursor-specific assets in the npm package `files` array
- Update init-plugin logic to support Cursor alongside Claude as a plugin-installable agent

## Capabilities

### New Capabilities
- `cursor-plugin-manifest`: Cursor plugin manifest (`.cursor-plugin/plugin.json`) and marketplace metadata for distributing agent-gauntlet as a Cursor plugin
- `cursor-plugin-install`: Plugin installation during `agent-gauntlet init` for Cursor — marketplace registration, plugin install with scope, and already-installed detection (parallel to existing `plugin-install` spec for Claude)
- `cursor-adapter-upgrade`: Upgrade `CursorAdapter` to expose skill directory and plugin-awareness — promoting Cursor from reviewer-only to full coding agent

### Modified Capabilities
- `init-hook-install`: Init hook installation needs to handle Cursor plugin-based hook delivery (currently hooks are written manually to `.cursor/hooks.json`; with the plugin they should be delivered via the plugin's hook payload instead)
- `plugin-install`: The init plugin installation flow needs to be generalized to support both Claude and Cursor plugin marketplaces and install commands

## Impact

- **Adapter**: `src/cli-adapters/cursor.ts` — skill dir support, plugin awareness
- **Init**: `src/commands/init.ts`, `src/commands/init-plugin.ts` — Cursor plugin install flow
- **Plugin manifests**: New `.cursor-plugin/` directory with `plugin.json` and optionally `marketplace.json`
- **Package**: `package.json` `files` array updated to include Cursor plugin assets
- **Tests**: New/updated tests for Cursor adapter capabilities and init plugin flow
- **Docs**: CLI invocation details and stop-hook guide updated for Cursor plugin delivery
