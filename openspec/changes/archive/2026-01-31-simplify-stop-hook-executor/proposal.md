# Change: Simplify Stop Hook and Run Executor Architecture

## Why

The stop-hook and run-executor have duplicated logic for lock checking and run interval detection. This makes maintenance harder and causes inconsistent behavior between manual `run` commands and stop-hook invocations.

## Problem Statement

The current architecture has **duplicate logic** between the stop-hook command and the run-executor:

1. **Lock pre-check**: Stop-hook checks for lock file before calling `executeRun()`, but the executor also has its own lock acquisition logic. This is redundant.

2. **Run interval detection**: The interval check lives in stop-hook but conceptually belongs in the run-executor since it determines whether a run should execute.

## Proposed Solution

### Core Principle
**The stop-hook should be a thin adapter** that:
1. Checks for infinite loop conditions (env var first, then input flag)
2. Calls `executeRun()` with appropriate options
3. Transforms the result into Claude Code's expected JSON format

All execution logic (lock management, interval detection, config loading) should live in the run-executor.

### Changes

#### 1. Move Interval Detection to Run Executor

- Add `checkInterval: boolean` option to `ExecuteRunOptions` (default: false)
- When `checkInterval: true`, executor loads global config and checks interval internally
- Executor returns `interval_not_elapsed` status when interval hasn't passed
- Only stop-hook passes `checkInterval: true`; CLI commands do not

#### 2. Remove Lock Pre-Check from Stop Hook

- Stop-hook no longer checks for lock file
- Executor's existing `tryAcquireLock()` returns `lock_conflict` status
- Stop-hook simply passes this status through to the response

#### 3. Reorder Stop Hook Flow for Early Exit

Move the environment variable check before stdin parsing for faster exit:

```text
1. Check GAUNTLET_STOP_HOOK_ACTIVE_ENV → allow stop immediately (no stdin read)
2. Parse stdin JSON
3. Check stop_hook_active from input → allow stop
4. Check no_config
5. Call executeRun({ cwd, checkInterval: true })
```

This avoids the 5-second stdin timeout when we already know we should allow stop.

#### 4. CLI Commands Always Run Immediately

The `run` command (and `check`/`review`) always execute immediately without interval checking:

```bash
agent-gauntlet run   # Always runs immediately (no interval check)
```

Only the stop-hook respects the run interval. This makes sense because:
- Manual CLI invocation = explicit user intent to run now
- Stop-hook = automatic invocation that should be throttled

#### 5. Simplify Stop Hook

After these changes, stop-hook becomes:

```typescript
// 1. Check env var FIRST (before stdin)
if (process.env[GAUNTLET_STOP_HOOK_ACTIVE_ENV]) {
  outputHookResponse("stop_hook_active");
  return;
}

// 2. Parse stdin
const hookInput = await parseStdin();

// 3. Check input flag
if (hookInput.stop_hook_active) {
  outputHookResponse("stop_hook_active");
  return;
}

// 4. Check config exists
if (!(await hasGauntletConfig(projectCwd))) {
  outputHookResponse("no_config");
  return;
}

// 5. Run gauntlet (executor handles lock, interval, config loading)
const result = await executeRun({
  cwd: projectCwd,
  checkInterval: true
});
outputHookResponse(result.status, { ... });
```

Removed from stop-hook:
- Lock pre-check (~10 lines)
- Interval check (~15 lines)
- `shouldRunBasedOnInterval()` function (~20 lines)
- `hasExistingLogFiles()` function call
- Global config loading (~5 lines)
- Duplicate `findLatestConsoleLog()` (already in executor)

## Summary of Redundancies Being Removed

| Current Location | Functionality | New Location |
|-----------------|---------------|--------------|
| stop-hook.ts | Lock file check | run-executor.ts (existing `tryAcquireLock`) |
| stop-hook.ts | Interval detection | run-executor.ts (new) |
| stop-hook.ts | `shouldRunBasedOnInterval()` | run-executor.ts |
| stop-hook.ts | Global config loading | run-executor.ts (when `checkInterval: true`) |
| stop-hook.ts | `findLatestConsoleLog()` | run-executor.ts (already exists, remove duplicate) |

## Alternatives Considered

1. **Keep logic in stop-hook but use shared utilities**: Would reduce duplication but leaves behavior split across two files. Rejected because the run-executor is the natural home for "should this run execute" logic.

2. **Add interval checking to CLI commands with `--force` flag**: Would provide symmetry but adds unnecessary complexity. Users running CLI commands explicitly want them to run; there's no valid reason to throttle manual invocations.

3. **Remove interval checking entirely**: Would simplify but the throttle is valuable for stop-hook to prevent excessive runs during rapid iteration. Keep it but only for stop-hook.

4. **Pass `intervalMinutes` instead of `checkInterval`**: Would require stop-hook to load global config. Using `checkInterval: boolean` lets the executor own all config loading, further simplifying stop-hook.

## Decisions

1. **CLI commands always run immediately**: No interval checking for `run`, `check`, or `review` commands. Only stop-hook uses interval.

2. **Interval source**: Keep as global config only (user preference, not project preference). Executor loads this when `checkInterval: true`.

3. **Env var check first**: Check `GAUNTLET_STOP_HOOK_ACTIVE_ENV` before stdin parsing for faster exit in child processes.

## Impact

### Affected Specs
- `openspec/specs/stop-hook/spec.md` - Remove lock pre-check and interval logic requirements
- `openspec/specs/run-lifecycle/spec.md` - Add interval detection requirements

### Affected Code Paths
- `src/commands/stop-hook.ts` - Simplify flow, remove redundant logic
- `src/core/run-executor.ts` - Add `checkInterval` option and interval detection

### No Breaking Changes
- CLI command behavior unchanged (always runs immediately)
- Stop-hook external behavior unchanged (same JSON protocol)
- Only internal simplification

## Benefits

1. **Single source of truth**: All run decision logic in one place
2. **Simpler mental model**: CLI = always runs, stop-hook = throttled
3. **Simpler stop-hook**: Reduced from ~480 lines to ~350 lines
4. **Faster child process exit**: Env var check before stdin avoids timeout
5. **Easier testing**: Run executor can be unit tested with interval logic
