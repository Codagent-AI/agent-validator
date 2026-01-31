# Tasks

## 1. Add Interval Detection to Run Executor

- [x] Add `checkInterval: boolean` option to `ExecuteRunOptions` in `run-executor.ts`
- [x] Implement interval checking logic in `executeRun()`:
  - When `checkInterval: true`, load global config
  - Get `run_interval_minutes` from global config
  - Check interval before lock acquisition
- [x] Return `{ status: "interval_not_elapsed", message: "..." }` when interval hasn't passed
- [x] Add unit tests for interval detection in executor:
  - [x] Test: checkInterval enabled and interval not elapsed returns `interval_not_elapsed`
  - [x] Test: checkInterval enabled and interval elapsed proceeds normally
  - [x] Test: checkInterval not provided (default false) skips check entirely
  - [x] Test: no execution state file with checkInterval enabled treats as elapsed
  - [x] Test: interval check precedes lock acquisition (no lock attempt when interval not elapsed)
  - [x] Test: interval check precedes auto-clean (auto-clean not triggered when interval not elapsed)
- [x] Add CLI tests to verify run/check/review do not pass `checkInterval`:
  - [x] Test: `run` command does not pass checkInterval to executor
  - [x] Test: verify CLI commands execute immediately regardless of last run time

## 2. Simplify Stop Hook

- [x] Move env var check (`GAUNTLET_STOP_HOOK_ACTIVE_ENV`) to first check (before stdin parsing)
- [x] Remove lock pre-check from stop-hook (lines 419-428)
- [x] Remove `shouldRunBasedOnInterval()` function from stop-hook
- [x] Remove global config loading from stop-hook
- [x] Remove duplicate `findLatestConsoleLog()` from stop-hook (use `result.consoleLogPath`)
- [x] Remove `hasExistingLogFiles()` call and conditional logic
- [x] Pass `checkInterval: true` to `executeRun()`
- [x] Update stop-hook tests:
  - [x] Test: env var check happens before stdin parsing (fast exit)
  - [x] Test: stop-hook handles `interval_not_elapsed` status from executor
  - [x] Test: stop-hook handles `lock_conflict` status from executor
  - [x] Test: stop-hook only performs four pre-checks before delegating
  - [x] Test: stop-hook uses `consoleLogPath` from RunResult
  - [x] Test: stop-hook does not load global config

## 3. Update Specs and Documentation

- [x] Update `openspec/specs/stop-hook/spec.md` to reflect simplified architecture
- [x] Update docs (quick-start.md, user-guide.md) if needed
- [x] Archive this change

## Validation

- [x] Run `bun test` to verify all tests pass
- [ ] Run `agent-gauntlet run` manually and verify it runs immediately
- [ ] Simulate stop-hook flow and verify interval checking works
- [ ] Verify child Claude process exits quickly (env var check before stdin)
- [ ] Run dogfood to verify end-to-end flow
