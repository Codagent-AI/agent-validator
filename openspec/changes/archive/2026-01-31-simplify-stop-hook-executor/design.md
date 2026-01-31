# Design: Simplified Stop Hook Architecture

## Current Architecture

```text
┌─────────────────────────────────────────────────────────────────┐
│                        stop-hook.ts                              │
│  1. Parse stdin JSON                                            │
│  2. Check stop_hook_active (infinite loop)                      │
│  3. Check env var (infinite loop)                               │
│  4. Check no_config                                             │
│  5. Load global config                                          │
│  6. Check lock file exists → allow stop (REDUNDANT)             │
│  7. Check interval elapsed → allow stop if not                  │
│  8. Call executeRun()                                           │
│  9. Transform result to JSON response                           │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                      run-executor.ts                             │
│  1. Load config                                                 │
│  2. Auto-clean (if needed)                                      │
│  3. Try acquire lock → return lock_conflict if exists           │
│  4. Run gates                                                   │
│  5. Return RunResult                                            │
└─────────────────────────────────────────────────────────────────┘
```

**Problems:**
- Lock check in stop-hook (step 6) duplicates executor's lock acquisition (step 3)
- Interval check only in stop-hook, not reusable
- Global config loaded in stop-hook just to pass to interval check
- Env var check happens after stdin parsing (slow for child processes)

## Proposed Architecture

```text
┌─────────────────────────────────────────────────────────────────┐
│                        stop-hook.ts                              │
│  1. Check env var → allow stop immediately (no stdin read)      │
│  2. Parse stdin JSON                                            │
│  3. Check stop_hook_active from input                           │
│  4. Check no_config                                             │
│  5. Call executeRun({ cwd, checkInterval: true })               │
│  6. Transform result to JSON response                           │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                      run-executor.ts                             │
│  1. Load project config                                         │
│  2. If checkInterval: load global config, check interval        │
│     → return interval_not_elapsed if not elapsed                │
│  3. Auto-clean (if needed)                                      │
│  4. Try acquire lock → return lock_conflict if exists           │
│  5. Run gates                                                   │
│  6. Return RunResult                                            │
└─────────────────────────────────────────────────────────────────┘
```

## New ExecuteRunOptions Interface

```typescript
export interface ExecuteRunOptions {
  baseBranch?: string;
  gate?: string;
  commit?: string;
  uncommitted?: boolean;
  cwd?: string;

  // NEW: Interval checking (only stop-hook uses this)
  checkInterval?: boolean;  // If true, load global config and check interval
}
```

## Execution Flow with Interval

```typescript
export async function executeRun(options: ExecuteRunOptions = {}): Promise<RunResult> {
  const config = await loadConfig(options.cwd);

  // NEW: Interval check (before lock, before auto-clean)
  if (options.checkInterval) {
    const globalConfig = await loadGlobalConfig();
    const intervalMinutes = globalConfig.stop_hook.run_interval_minutes;

    const shouldRun = await shouldRunBasedOnInterval(
      config.project.log_dir,
      intervalMinutes
    );
    if (!shouldRun) {
      return {
        status: "interval_not_elapsed",
        message: `Run interval (${intervalMinutes} min) not elapsed.`
      };
    }
  }

  // Existing logic continues...
  const autoCleanResult = await shouldAutoClean(...);
  const lockAcquired = await tryAcquireLock(...);
  // etc.
}
```

## CLI vs Stop-Hook Behavior

| Caller | Passes checkInterval? | Behavior |
|--------|----------------------|----------|
| `agent-gauntlet run` | No (default false) | Always runs immediately |
| `agent-gauntlet check` | No | Always runs immediately |
| `agent-gauntlet review` | No | Always runs immediately |
| stop-hook | Yes (`checkInterval: true`) | Respects interval from global config |

**Rationale:** CLI commands represent explicit user intent — if a user types `run`, they want it to run now. Stop-hook is automatic and should be throttled to prevent excessive runs.

## Simplified Stop Hook

```typescript
export function registerStopHookCommand(program: Command): void {
  program
    .command("stop-hook")
    .action(async () => {
      // 1. Check env var FIRST (before stdin - fast exit for child processes)
      if (process.env[GAUNTLET_STOP_HOOK_ACTIVE_ENV]) {
        outputHookResponse("stop_hook_active");
        return;
      }

      // 2. Parse stdin
      const input = await readStdin();
      const hookInput = parseHookInput(input);
      if (!hookInput) {
        outputHookResponse("invalid_input");
        return;
      }

      // 3. Check input flag
      if (hookInput.stop_hook_active) {
        outputHookResponse("stop_hook_active");
        return;
      }

      // 4. Config detection
      const projectCwd = hookInput.cwd ?? process.cwd();
      if (!(await hasGauntletConfig(projectCwd))) {
        outputHookResponse("no_config");
        return;
      }

      // 5. Run gauntlet (executor handles lock, interval, config)
      const result = await executeRun({
        cwd: projectCwd,
        checkInterval: true
      });

      // 6. Output response
      outputHookResponse(result.status, {
        reason: result.status === "failed"
          ? getStopReasonInstructions(result.consoleLogPath)
          : undefined,
        errorMessage: result.errorMessage
      });
    });
}
```

**Lines removed from stop-hook:**
- Lock file check block (~10 lines)
- `hasExistingLogFiles()` call and conditional (~10 lines)
- `shouldRunBasedOnInterval()` call and conditional (~10 lines)
- `shouldRunBasedOnInterval()` function definition (~20 lines)
- Global config loading (~5 lines)
- Duplicate `findLatestConsoleLog()` function (~25 lines)

**Total reduction:** ~80 lines (from ~480 to ~400)

**Performance improvement:** Child Claude processes exit immediately on env var check without waiting for stdin timeout.

## Behavior Comparison

| Scenario | Before | After |
|----------|--------|-------|
| `run` command | Always runs | Always runs (unchanged) |
| Stop-hook, child process (env var) | Parses stdin first | Exits immediately (faster) |
| Stop-hook, interval not elapsed | Allows stop (pre-check) | Allows stop (executor returns status) |
| Stop-hook, lock exists | Allows stop (pre-check) | Allows stop (executor returns status) |
| Stop-hook, gates fail | Blocks with instructions | Same |

## Migration Notes

1. **CLI commands**: No change in behavior. They always run immediately.

2. **Stop-hook**: Behavior unchanged from user perspective, but simplified internally. Child processes exit faster.
