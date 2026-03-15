# Add Cursor plugin update support

## Goal

Make `agent-gauntlet update` detect and refresh Cursor plugin installations alongside Claude plugins and Codex skills, closing the last gap in first-class Cursor support.

## Background

Read these change artifacts before implementing:
- `openspec/changes/cursor-plugin-update/proposal.md`
- `openspec/changes/cursor-plugin-update/design.md`
- `openspec/changes/cursor-plugin-update/specs/cursor-plugin-update/spec.md`
- `openspec/changes/cursor-plugin-update/specs/plugin-update/spec.md`

Key codebase files:
- `src/cli-adapters/shared.ts` — `CLIAdapter` interface definition
- `src/cli-adapters/cursor.ts` — `CursorAdapter` with `installPlugin`, `detectPlugin`, and `copyPluginAssets`
- `src/commands/plugin-update.ts` — `runPluginUpdate()` function (currently Claude-only + Codex skills)
- `docs/plugin-guide.md`, `docs/quick-start.md`, `docs/user-guide.md`, `docs/skills-guide.md` — contain "not yet supported" caveats to remove

Design decisions that constrain implementation:
- The `CLIAdapter` interface gets an optional `updatePlugin` method matching the `installPlugin` signature
- `CursorAdapter.updatePlugin` reuses the existing `copyPluginAssets` mechanism (always overwrite, no checksum)
- Claude plugin is no longer a hard requirement — only error if nothing is installed at all
- Cursor update failures are non-fatal (warn and continue)
- Update flow order: Claude (if found) → Cursor (if found) → Codex skills → error if nothing found

## Done When

All spec scenarios from both spec files pass. `agent-gauntlet update` works with Cursor-only, Claude-only, and both-installed configurations. Documentation no longer mentions Cursor update as unsupported.
