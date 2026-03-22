## Why

The stop hook feature is overly complex, unreliable in practice, and is being replaced by a purpose-built "agent runner" tool that will handle the same responsibility more effectively.

## What Changes

- **BREAKING**: Remove the `stop-hook` CLI command and all supporting infrastructure (handler, state management, adapters, configuration)
- **BREAKING**: Remove the `start-hook` CLI command (session start context injection)
- **BREAKING**: Remove hook installation logic (`init-hooks` command)
- Remove Claude Code Stop hook configuration from `.claude/settings.local.json` and `hooks/hooks.json`
- Remove Cursor stop hook configuration from `.cursor/hooks.json` and `hooks/cursor-hooks.json`
- Remove stop hook configuration schema and resolution logic (env vars, project config, global config)
- Remove stop-hook-related GauntletStatus values (`validation_required`, `stop_hook_active`, `loop_detected`, `interval_not_elapsed`, `stop_hook_disabled`, `invalid_input`)
- Remove run interval checking from the run executor
- Clean up all related documentation, specs, and test files

## Capabilities

### New Capabilities

_None_ - this is a removal-only change.

### Modified Capabilities

- `run-lifecycle`: Remove run interval checking and execution state fields that exist solely for the stop hook
- `init-config`: Remove hook installation step from the init flow
- `entry-point-config`: Remove stop-hook and start-hook command registrations

## Impact

- **Source files deleted** (~8): `src/hooks/` directory (handler, state, adapters), `src/commands/stop-hook.ts`, `src/commands/start-hook.ts`, `src/config/stop-hook-config.ts`
- **Source files modified** (~6): `src/index.ts`, `src/commands/index.ts`, `src/commands/init-hooks.ts`, `src/types/gauntlet-status.ts`, `src/core/run-executor.ts`, `src/core/run-executor-helpers.ts`, `src/config/schema.ts`, `src/config/global.ts`
- **Test files deleted** (~7): All stop hook test files under `test/hooks/`, `test/commands/stop-hook.test.ts`, `test/config/stop-hook-config.test.ts`, `test/integration/stop-hook-e2e.test.ts`
- **Config files cleaned**: `.claude/settings.local.json`, `.cursor/hooks.json`, `hooks/hooks.json`, `hooks/cursor-hooks.json`
- **Docs deleted**: `docs/stop-hook-guide.md`, `skills/gauntlet-help/references/stop-hook-troubleshooting.md`
- **Specs archived**: `openspec/specs/stop-hook/` directory
- **Dependencies**: No package dependency changes expected
- **User impact**: Users relying on the stop hook for automatic gauntlet enforcement will need to manually invoke `/gauntlet-run` until the agent runner replacement is available. The SessionStart hook (start-hook) that primes agents with gauntlet instructions is also removed.
