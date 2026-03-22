## Goal

Remove the entire stop hook and start hook feature — source code, tests, configuration, and documentation.

## Background

The stop hook intercepts agent stop events in Claude Code and Cursor, reads gauntlet state, and blocks the stop if validation is needed. The start hook injects gauntlet instructions at session start. Both are being removed because the feature is complex, unreliable, and being replaced by an agent runner tool.

Key files to read:
- `src/hooks/` — stop hook handler, state, and protocol adapters (delete entire directory)
- `src/commands/stop-hook.ts` — stop hook CLI command (delete)
- `src/commands/start-hook.ts` — start hook CLI command (delete)
- `src/config/stop-hook-config.ts` — stop hook config resolution (delete)
- `src/index.ts` — command registrations (remove stop-hook and start-hook)
- `src/commands/index.ts` — command exports (remove stop-hook and start-hook)
- `src/config/schema.ts` — `stopHookConfigSchema` (remove)
- `src/config/global.ts` — `stop_hook` in global config schema (remove)
- `src/types/gauntlet-status.ts` — stop-hook-specific status values (remove `validation_required`, `stop_hook_active`, `loop_detected`, `interval_not_elapsed`, `stop_hook_disabled`, `invalid_input`)
- `src/core/run-executor.ts` — `checkInterval` option (remove)
- `src/core/run-executor-helpers.ts` — interval checking helpers (remove)
- `src/commands/init-hooks.ts` — stop/start hook installation logic (remove or delete if empty)
- `hooks/hooks.json` — remove Stop and SessionStart hook entries
- `hooks/cursor-hooks.json` — remove stop and start hook entries
- `.claude/settings.local.json` — remove Stop hook entry
- `.cursor/hooks.json` — remove stop hook entry

Test files to delete:
- `test/hooks/` — all files
- `test/commands/stop-hook.test.ts`
- `test/config/stop-hook-config.test.ts`
- `test/integration/stop-hook-e2e.test.ts`

Test files to modify:
- `test/config/global.test.ts` — remove `stop_hook` config tests
- `test/core/run-executor.test.ts` — remove `checkInterval` tests

Docs to delete:
- `docs/stop-hook-guide.md`
- `skills/gauntlet-help/references/stop-hook-troubleshooting.md`

Docs to update (remove stop hook references):
- `docs/config-reference.md`, `docs/user-guide.md`, `docs/feature_comparison.md`, `docs/plugin-guide.md`
- `skills/gauntlet-help/SKILL.md` — remove stop-hook routing

## Spec

Specs are defined as delta removals in the change's `specs/` directory:
- `specs/stop-hook/spec.md` — REMOVED all 23 requirements
- `specs/start-hook/spec.md` — REMOVED all 4 requirements
- `specs/init-hook-install/spec.md` — MODIFIED hook delivery (no stop/start hooks in plugin)
- `specs/run-lifecycle/spec.md` — REMOVED interval detection, MODIFIED CLI interval requirement
- `specs/log-management/spec.md` — MODIFIED debug log (removed STOP_HOOK event type)
- `specs/agent-command/spec.md` — MODIFIED help skill (removed stop-hook troubleshooting routing)

## Done When

- All stop hook and start hook source files are deleted
- All stop-hook-specific code is removed from shared modules
- Hook config files have no stop/start hook entries
- All stop hook tests are deleted and remaining tests pass
- Documentation no longer references stop hooks as a current feature
- `bun run build` succeeds with no errors
- `bun test` passes
