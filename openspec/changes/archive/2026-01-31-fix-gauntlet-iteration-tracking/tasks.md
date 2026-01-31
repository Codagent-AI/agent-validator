# Tasks: Fix Gauntlet Iteration Tracking and Debug Logging

## Task 1: CRITICAL - Fix Stop Hook Stdout Pollution (Regression Fix)

**This is a critical regression from commit c92abfb that breaks stop-hook blocking.**

Change `log()` helper to write to stderr instead of stdout, keeping console.N.log capture working.

- [x] 1.1 In `src/core/run-executor.ts`, change `log()` helper from `console.log()` to `console.error()`
- [x] 1.2 Verify console-log.ts still captures stderr output to console.N.log files
- [x] 1.3 Verify stop-hook stdout contains ONLY the JSON response (no log pollution)
- [x] 1.4 Verify stop-hook block decision works correctly with Claude Code

## Task 2: Compute RUN_END Statistics in Run Executor

Calculate actual fixed/skipped/failed counts from the runner outcome.

- [x] 2.1 Modify Runner to expose iteration statistics (fixed, skipped, failed counts)
- [x] 2.2 In run-executor.ts, extract statistics from runner outcome before calling logRunEnd
- [x] 2.3 Pass actual computed values to debugLogger.logRunEnd() instead of zeros

## Task 3: Implement fixBase Handling in computeDiffStats()

The `fixBase` option is defined in `DiffStatsOptions` but completely ignored by the implementation.

- [x] 3.1 Add `computeFixBaseDiffStats(fixBase: string)` function in `src/core/diff-stats.ts`
- [x] 3.2 Implement git diff against fixBase: `git diff --numstat <fixBase>` and `git diff --name-status <fixBase>`
- [x] 3.3 Handle untracked files: compare current untracked against files in fixBase snapshot (`git ls-tree -r --name-only <fixBase>`)
- [x] 3.4 Add case in `computeDiffStats()` to call `computeFixBaseDiffStats()` when `options.fixBase` is provided
- [x] 3.5 Verify subsequent iterations show only NEW changes in RUN_START diff stats

## Task 4: Suppress Child Process Debug Logging

Verify no STOP_HOOK entries are written when GAUNTLET_STOP_HOOK_ACTIVE is set.

- [x] 4.1 Audit stop-hook.ts to confirm debug logger is not initialized before child process check
- [x] 4.2 Add explicit comment documenting the early return prevents debug logging

## Task 5: Add Tests

### Stop Hook Stdout Purity Tests

- [x] 5.1 Add test verifying run-executor log() writes to stderr not stdout
- [x] 5.2 Add test verifying console.N.log still captures stderr output
- [x] 5.3 Add test verifying stop-hook stdout contains ONLY JSON (no log pollution)

### RUN_END Statistics Tests

- [x] 5.3 Add test verifying RUN_END logs correct fixed count when violations resolved
- [x] 5.4 Add test verifying RUN_END logs correct skipped count when violations skipped
- [x] 5.5 Add test verifying RUN_END logs correct failed count for remaining violations

### Diff Stats fixBase Tests

- [x] 5.6 Add test verifying `computeDiffStats()` uses fixBase when provided
- [x] 5.7 Add test verifying diff stats show only changes since fixBase, not all uncommitted changes
- [x] 5.8 Add test verifying untracked files are compared against fixBase snapshot (only NEW untracked files since fixBase are counted)

### Child Process Logging Tests

- [x] 5.9 Add test verifying no STOP_HOOK debug entry when GAUNTLET_STOP_HOOK_ACTIVE is set

## Validation

There are no validation tasks that need to be explicitly run. When work is completed, a stop hook should execute the full gauntlet of verification tasks and give direction on what needs to be fixed.
