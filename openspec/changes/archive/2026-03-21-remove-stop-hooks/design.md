## Context

The stop hook feature intercepts agent stop events in Claude Code and Cursor, reads gauntlet state, and blocks the stop if validation is needed. It includes:
- A `stop-hook` CLI command with protocol adapters (Claude, Cursor)
- A `start-hook` CLI command for session context injection
- Hook configuration files for both Claude and Cursor plugins
- Stop hook state management, configuration resolution, and loop prevention
- Run interval checking in the executor (used only by stop-hook)
- Stop-hook-specific GauntletStatus values

The feature is complex (~1500 lines of source, ~800 lines of tests), unreliable in practice, and being replaced by an agent runner tool.

## Goals / Non-Goals

**Goals:**
- Remove all stop hook and start hook source code, tests, and configuration
- Remove stop-hook-specific infrastructure from shared modules (status types, config schema, executor interval checking)
- Keep the run lifecycle intact — execution state, auto-clean, and fixBase resolution are used by CLI commands independently of the stop hook
- Ensure the project builds and all remaining tests pass after removal

**Non-Goals:**
- Building the replacement agent runner (separate change)
- Modifying the gauntlet-run skill or run/check/review commands (they work independently)
- Modifying the plugin structure beyond hook removal

## Decisions

### 1. Delete entire `src/hooks/` directory
The `src/hooks/` directory contains only stop-hook code (handler, state, adapters). Delete it entirely rather than selectively removing files.

### 2. Delete `src/commands/stop-hook.ts` and `src/commands/start-hook.ts`
These are standalone command files with no shared logic. Delete both and remove their registrations from `src/commands/index.ts` and `src/index.ts`.

### 3. Delete `src/config/stop-hook-config.ts`
Stop hook configuration resolution is self-contained. Delete the file and remove the `stopHookConfigSchema` from `src/config/schema.ts`.

### 4. Remove `stop_hook` from global config schema
Remove the `stop_hook` field from the global config Zod schema in `src/config/global.ts` and `src/config/schema.ts`. Existing user config files with a `stop_hook` section will be silently ignored by Zod's `.passthrough()` or strict parsing (the unknown key will be stripped).

### 5. Remove `checkInterval` from executor
The `checkInterval` option on `executeRun()` exists solely for the stop hook. Remove it along with the interval checking logic in `src/core/run-executor.ts` and the helper functions in `src/core/run-executor-helpers.ts`.

### 6. Remove stop-hook-specific GauntletStatus values
Remove these status values from `src/types/gauntlet-status.ts`:
- `validation_required`
- `stop_hook_active`
- `loop_detected`
- `interval_not_elapsed`
- `stop_hook_disabled`
- `invalid_input`

### 7. Remove hook entries from plugin hook files
Remove the Stop hook and SessionStart hook entries from:
- `hooks/hooks.json` (Claude plugin)
- `hooks/cursor-hooks.json` (Cursor plugin)
- `.claude/settings.local.json` (local dev overrides)
- `.cursor/hooks.json` (Cursor local config)

If hook files become empty after removal, keep them as empty arrays/objects rather than deleting (the plugin structure expects them to exist).

### 8. Clean up `src/commands/init-hooks.ts`
Remove any stop-hook and start-hook installation logic. If the file has no remaining purpose after cleanup, delete it and remove its registration.

### 9. Delete documentation
- `docs/stop-hook-guide.md`
- `skills/gauntlet-help/references/stop-hook-troubleshooting.md`

### 10. Archive the openspec spec
The `openspec/specs/stop-hook/` and `openspec/specs/start-hook/` directories will be updated via the spec delta archive process. No manual deletion needed.

### 11. Remove debug log STOP_HOOK event type
Remove the `STOP_HOOK` event type from the debug logger categories. The `COMMAND` event for stop-hook invocations will naturally stop appearing.

## Risks / Trade-offs

- **Loss of automatic enforcement**: Until the agent runner is built, there is no automated mechanism to force agents to run gauntlet before stopping. Mitigation: plugin skill descriptions and CLAUDE.md instructions serve as a softer alternative until the agent runner replaces this.
- **Breaking change for users**: Anyone with `stop_hook` in their global config will see no effect. Since the stop hook was opt-in and unreliable, the impact is minimal.

## Migration Plan

1. Delete source files and tests (single PR)
2. Update shared modules (status types, config schema, executor)
3. Clean up hook config files
4. Delete documentation
5. Verify build and tests pass
6. No rollback strategy needed — this is a removal, and the code is in git history if needed

## Open Questions

None.
