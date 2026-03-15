## Context

`agent-gauntlet update` currently handles Claude plugins (marketplace CLI) and Codex skills (checksum-based file refresh). PR #104 added Cursor as a first-class coding agent with file-copy-based plugin installation, but left update as a gap. Users must manually delete `~/.cursor/plugins/agent-gauntlet/` and re-run `init` to update.

The Cursor plugin consists of three asset groups copied from the npm package:
- `.cursor-plugin/` (manifest)
- `skills/` (skill files)
- `hooks/cursor-hooks.json` → `hooks/hooks.json`

## Goals / Non-Goals

**Goals:**
- Add `updatePlugin` to the `CLIAdapter` interface (optional method)
- Implement `updatePlugin` on `CursorAdapter` reusing `copyPluginAssets`
- Make `runPluginUpdate()` multi-adapter: detect and update Cursor alongside Claude
- Make Claude plugin no longer a hard requirement — update should work if only Cursor is installed
- Remove "not yet supported" documentation caveats

**Non-Goals:**
- Version comparison or checksum gating for Cursor updates (always overwrite, like `npm update`)
- Cursor marketplace integration (no CLI API exists)
- Updating Cursor-specific skill directories outside the plugin (handled by existing Codex skill refresh)

## Decisions

### 1. Reuse `copyPluginAssets` for update
The update operation is identical to install — overwrite all files. No need for checksum comparison since the npm package is already the source of truth (user ran `npm update -g agent-gauntlet` before `agent-gauntlet update`).

### 2. Add optional `updatePlugin` to `CLIAdapter` interface
```typescript
updatePlugin?(scope: 'user' | 'project', projectRoot?: string): Promise<{ success: boolean; error?: string }>;
```
Same signature as `installPlugin`. This keeps update adapter-driven without forcing all adapters to implement it.

### 3. Make Claude plugin optional in update flow
Currently `runPluginUpdate()` throws if no Claude plugin is found. Change this to: detect all adapters with installed plugins, update whichever are found. Only error if *nothing* is found (no Claude plugin, no Cursor plugin, no Codex skills).

### 4. Update flow order
1. Detect Claude plugin scope (existing logic, but no longer throws if missing)
2. If Claude found → run marketplace update + plugin update (existing)
3. Detect Cursor plugin scope via `CursorAdapter.detectPlugin()`
4. If Cursor found → call `CursorAdapter.updatePlugin(scope, projectRoot)`
5. Refresh Codex skills (existing)
6. If nothing was found → error with "run init first"

### 5. Non-fatal Cursor update failures
If Cursor update fails, log a warning and continue. The user can re-run or manually copy files. This matches the install behavior where failures produce warnings, not hard errors.

## Risks / Trade-offs

- **Always-overwrite**: No checksum means we always copy files even if unchanged. Acceptable because the operation is fast (a few files) and runs infrequently.
- **No rollback**: If copy partially fails, the plugin may be in an inconsistent state. Mitigation: `copyPluginAssets` creates directories recursively and copies atomically per file, so partial failure leaves a functional (if mixed-version) plugin.

## Migration Plan

No migration needed. This is purely additive — existing `agent-gauntlet update` behavior is preserved. Users with Cursor plugins installed will automatically get them updated.

## Open Questions

None — the implementation is straightforward reuse of existing patterns.
