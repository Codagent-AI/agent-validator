## Why

`agent-gauntlet update` only updates Claude plugins (via marketplace CLI) and Codex skills (via checksum). Cursor plugins — installed via file-copy during `init` — have no update path. Users must manually delete the plugin directory and re-run init. This is the last gap in treating Cursor as a first-class coding agent.

## What Changes

- Add Cursor plugin update support to `agent-gauntlet update`, using file-copy refresh (same mechanism as install)
- Add `updatePlugin` method to the `CLIAdapter` interface so update logic is adapter-driven
- Extend `runPluginUpdate()` to detect and update Cursor plugins alongside Claude plugins
- Remove documentation caveats about Cursor update not being supported

## Capabilities

### New Capabilities
- `cursor-plugin-update`: File-copy-based update of the Cursor plugin during `agent-gauntlet update`, with detection of installed scope and asset refresh

### Modified Capabilities
- `plugin-update`: Extend the update command to be multi-adapter-aware — update Cursor plugins in addition to Claude plugins and Codex skills

## Impact

- `src/cli-adapters/shared.ts` — add optional `updatePlugin` to `CLIAdapter` interface
- `src/cli-adapters/cursor.ts` — implement `updatePlugin` (reuse `copyPluginAssets`)
- `src/commands/plugin-update.ts` — detect Cursor installations and call adapter update
- `docs/plugin-guide.md`, `docs/quick-start.md`, `docs/user-guide.md`, `docs/skills-guide.md` — remove "not yet supported" caveats
- Tests for Cursor update flow
