# Proposal: Fix Gauntlet Iteration Tracking and Debug Logging

## Why

Several issues affect the gauntlet's ability to track iterations correctly and provide accurate debugging information:

1. **RUN_END statistics always zero** - The debug log shows `fixed=0 skipped=0 failed=0` regardless of actual results
2. **Diff stats unchanged between iterations** - Same `lines_added` appears repeatedly because `computeDiffStats()` ignores the `fixBase` option
3. **Child process debug logging** - STOP_HOOK entries written to debug log from child Claude processes (should be suppressed)
4. **Stop hook async appearance** - Investigation shows this is likely a Claude Code display issue, not a gauntlet bug (hook protocol compliance is correct)

## What Changes

### Fix 1: Compute RUN_END Statistics

Currently in `run-executor.ts`, the `logRunEnd()` call passes hardcoded zeros:
```typescript
await debugLogger?.logRunEnd(
  outcome.allPassed ? "pass" : "fail",
  0,    // fixed (hardcoded)
  0,    // skipped (hardcoded)
  0,    // failed (hardcoded)
  logger.getRunNumber(),
);
```

The runner outcome contains the actual counts via `subResults`. Calculate from:
- `fixed`: Sum of previous violations that no longer appear
- `skipped`: Sum of violations with `status: "skipped"`
- `failed`: Sum of remaining active violations

### Fix 2: computeDiffStats() Ignores fixBase Option

**Root Cause:** In `src/core/diff-stats.ts`, the `DiffStatsOptions` interface defines a `fixBase` option (line 27), but `computeDiffStats()` **completely ignores it** (lines 33-54).

When in rerun mode, `run-executor.ts` sets:
```typescript
changeOptions = { uncommitted: true };
if (executionState?.working_tree_ref) {
    changeOptions.fixBase = executionState.working_tree_ref;  // PASSED BUT IGNORED!
}
```

The function only checks `options.uncommitted` and calls `computeUncommittedDiffStats()`, which computes ALL uncommitted changes regardless of `fixBase`. This is why the same `lines_added=224` appears in every iteration.

**Fix:** Add a case in `computeDiffStats()` to handle `fixBase`:
```typescript
if (options.fixBase) {
    return computeFixBaseDiffStats(options.fixBase);
}
```

Implement `computeFixBaseDiffStats()` to:
1. Run `git diff --numstat <fixBase>` for changes since the stash
2. Run `git diff --name-status <fixBase>` for file categorization
3. Handle untracked files that weren't in the snapshot (compare `git ls-files --others` against `git ls-tree -r --name-only <fixBase>`)

### Fix 3: Suppress Child Process Debug Logging

In `stop-hook.ts`, when `GAUNTLET_STOP_HOOK_ACTIVE` env var is set, skip writing STOP_HOOK entries to debug log. The current code returns early BEFORE initializing the debug logger, but we should explicitly ensure no logging occurs:

```typescript
if (process.env[GAUNTLET_STOP_HOOK_ACTIVE_ENV]) {
  // Skip debug logging for child processes
  outputHookResponse("stop_hook_active");
  return;
}
```

This is already correct, but verify no debug logger is initialized before this check.

### Fix 4: Stop Hook Block Not Working (CRITICAL REGRESSION)

**Root Cause:** Commit `c92abfb` ("remove 'silent' log option") broke stop-hook blocking behavior.

**What happened:**
1. Previously, `executeRun()` had a `silent` option that suppressed console.log output
2. Stop-hook called `executeRun({ silent: true })` to prevent stdout pollution
3. The `silent` option was removed, so now all console.log output goes to stdout
4. Claude Code reads stdout expecting **only** JSON, but receives:
   ```
   [log output from gauntlet]
   [more log output]
   {"decision":"block","reason":"..."}
   ```
5. Claude Code can't parse this mixed output, so the block decision is ignored

**Evidence:**
- Debug log shows `STOP_HOOK decision=block reason=failed` - the code IS running
- But Claude Code didn't block - nothing was displayed, terminal ready for input
- Compare with working `ralph-wiggum` plugin which outputs **only** JSON to stdout

**Constraint:** The old `silent` mode suppressed ALL output including to console.N.log files, which we need for debugging. So we can't simply re-add the old `silent` option.

**Fix:** Change `log()` helper in `run-executor.ts` to write to **stderr** instead of stdout:
```typescript
function log(...args: unknown[]): void {
  console.error(...args);  // stderr, not stdout
}
```

This works because:
1. `console-log.ts` intercepts BOTH stdout AND stderr, writing both to the log file
2. So console.N.log will still capture all output
3. But stdout stays clean for the JSON hook response
4. This matches the existing pattern in stop-hook.ts (`verboseLog` uses `console.error`)

Claude Code hooks only read stdout - stderr is ignored for hook responses but still visible to users.

## Impact

- **Affected specs:** `stop-hook` (adds requirements for stdout purity, RUN_END statistics, and diff stats scoping)
- **Affected code:**
  - `src/core/run-executor.ts` - Change `log()` to use stderr, calculate and pass actual statistics to logRunEnd
  - `src/core/diff-stats.ts` - Implement `fixBase` handling in `computeDiffStats()`
  - `src/core/runner.ts` - Expose iteration statistics
  - `src/commands/stop-hook.ts` - Verify no debug logging for child processes
- **Breaking changes:** None - log output moves from stdout to stderr but still captured to log files
