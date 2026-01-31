## 0. Pre-factoring
`Runner.preflight` in `src/core/runner.ts` (Code Health: 6.65 -- Complex Method cc=27, Large Method 109 LoC, Bumpy Road, Deep Nested Complexity) is being **deleted entirely** by this change. No pre-factoring needed since the hotspot is being removed, not modified.

`src/gates/review.ts` (Code Health: 7.2) modifications do not touch the worst-scoring functions (`getDiff`, `validateAndReturn`). Changes are additive (post-execute usage-limit check) and reductive (removing `checkUsageLimit` param threading).

No hotspots require pre-factoring.

## 1. Extend ExecutionState with adapter health tracking
- [x] 1.1 Add `UnhealthyAdapter` interface (`marked_at: string`, `reason: string`) and optional `unhealthy_adapters` field to `ExecutionState` in `src/utils/execution-state.ts`
- [x] 1.2 Update `readExecutionState()` to parse `unhealthy_adapters` (backward compatible -- absent field treated as empty)
- [x] 1.3 Add `markAdapterUnhealthy(logDir, adapterName, reason)` helper -- reads state, upserts entry, writes back
- [x] 1.4 Add `markAdapterHealthy(logDir, adapterName)` helper -- reads state, removes entry, writes back
- [x] 1.5 Add `getUnhealthyAdapters(logDir)` helper -- returns the map (or empty object)
- [x] 1.6 Add `isAdapterCoolingDown(entry): boolean` helper -- returns true if `marked_at` is less than 1 hour ago

## 2. Remove check_usage_limit config
- [x] 2.1 Remove `check_usage_limit` from `cliConfigSchema` in `src/config/schema.ts`
- [x] 2.2 Remove `check_usage_limit` references from `src/commands/health.ts`

## 3. Simplify CLIAdapter interface and implementations
- [x] 3.1 Change `checkHealth()` in `CLIAdapter` interface to accept no parameters (remove `options` parameter) and return only binary availability status (`src/cli-adapters/index.ts`)
- [x] 3.2 Simplify `ClaudeAdapter.checkHealth()` to only check binary availability (remove "hello" prompt logic) in `src/cli-adapters/claude.ts`
- [x] 3.3 Simplify `GeminiAdapter.checkHealth()` similarly in `src/cli-adapters/gemini.ts`
- [x] 3.4 Simplify `CodexAdapter.checkHealth()` similarly in `src/cli-adapters/codex.ts`
- [x] 3.5 Simplify `CursorAdapter.checkHealth()` similarly in `src/cli-adapters/cursor.ts`
- [x] 3.6 Simplify `GitHubCopilotAdapter.checkHealth()` similarly in `src/cli-adapters/github-copilot.ts`

## 4. Remove preflight phase from Runner
- [x] 4.1 Delete `preflight()`, `checkAdapter()`, `recordPreflightFailure()`, `commandExists()`, `getCommandName()`, `tokenize()`, `isEnvAssignment()`, `shouldFailFast()`, and `PREFLIGHT_TIMEOUT_MS` from `src/core/runner.ts`
- [x] 4.2 Remove the `preflight()` call from `Runner.run()` -- pass all jobs directly to execution
- [x] 4.3 Remove `checkUsageLimit` parameter passing from `executeJob()` to `ReviewGateExecutor.execute()`

## 5. Add runtime usage-limit detection and cooldown to review gate
- [x] 5.1 Remove `checkUsageLimit` parameter from `ReviewGateExecutor.execute()` and `runSingleReview()`
- [x] 5.2 In the adapter selection section of `execute()`, replace `checkHealth({ checkUsageLimit })` with cooldown-based filtering: read unhealthy adapters from execution state, skip adapters in cooldown, probe expired adapters with `checkHealth()` (availability only), clear healthy ones
- [x] 5.3 In `runSingleReview()`, after `adapter.execute()` returns, check output with `isUsageLimit()`. If matched: call `markAdapterUnhealthy()`, return error result for the slot
- [x] 5.4 In `runSingleReview()` catch block, check error message with `isUsageLimit()`. If matched: call `markAdapterUnhealthy()`, return error result
- [x] 5.5 Pass `logDir` into `ReviewGateExecutor.execute()` (needed for `markAdapterUnhealthy` calls)

## 6. Tests
- [x] 6.1 Unit tests for `markAdapterUnhealthy`, `markAdapterHealthy`, `getUnhealthyAdapters`, `isAdapterCoolingDown` in execution-state
- [x] 6.2 Unit test: `readExecutionState` parses `unhealthy_adapters` correctly and handles missing field (backward compat)
- [x] 6.3 Unit test: usage limit detected in review output marks adapter unhealthy and returns error
- [x] 6.4 Unit test: adapter in cooldown is skipped during review dispatch
- [x] 6.5 Unit test: adapter past cooldown with available binary is re-included
- [x] 6.6 Unit test: adapter past cooldown with missing binary remains excluded
- [x] 6.7 Unit test: all adapters cooling down returns error with "no healthy adapters" message
- [x] 6.8 Unit test: non-usage-limit adapter error does not mark adapter unhealthy
- [x] 6.9 Update existing preflight tests in `test/core/runner.test.ts` (remove or adapt to new behavior)

## 7. Validation
There are no validation tasks that need to be explicitly run. When work is completed, a stop hook should execute the full gauntlet of verification tasks and give direction on what needs to be fixed.
