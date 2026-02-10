## 0. Pre-factoring

Pre-factoring not needed. `src/hooks/stop-hook-handler.ts` scored 9.09 pre-change (post-rewrite: 8.41 due to CC in `execute()`; addressed by extracting `checkForChanges()` and `checkPRAndCI()` methods). `src/commands/stop-hook.ts` scores 8.03 (simplified by this change).

## 1. Add `validation_required` Status and Remove `ci_timeout`

- [ ] 1.1 Add `validation_required` to `GauntletStatus` type in `src/types/gauntlet-status.ts`
- [ ] 1.2 Add `validation_required` to `isBlockingStatus()` as a blocking status
- [ ] 1.3 Add status message for `validation_required` in stop-hook handler
- [ ] 1.4 Remove `ci_timeout` from `GauntletStatus` and all references

## 2. Implement State Reading Logic

- [ ] 2.1 Create state reader module (`src/hooks/stop-hook-state.ts`) with functions:
  - `hasFailedRunLogs(logDir)` — checks if run log directory contains failed gate logs
  - `hasChangesSinceLastRun(logDir)` — reads `.execution_state`, creates working tree ref, compares
  - `hasChangesVsBaseBranch(baseBranch)` — fallback for no execution state
  - `getLastRunStatus(logDir)` — reads the last run's final status from `.execution_state` (needed for `passed_with_warnings` detection)
- [ ] 2.2 Unit tests for state reading functions

## 3. Rewrite Stop Hook Handler

- [ ] 3.1 Replace `StopHookHandler.execute()` with state-machine logic:
  1. Check for failed run logs → block with `validation_required`
  2. Check interval (read `.execution_state` timestamp, only when no failed logs)
  3. Check for changes since last pass → block with `validation_required`
  4. Check PR status (if `auto_push_pr`) → block with `pr_push_required`
  5. Check CI status (if `auto_fix_pr`, single read) → block with `ci_pending`/`ci_failed`
  6. Allow stop
- [ ] 3.2 Remove `executeRun()` import and call
- [ ] 3.3 Remove `getStopReasonInstructions()` — replace with simple skill instruction strings
- [ ] 3.4 Remove `getFailedGateLogs()` — no longer needed
- [ ] 3.5 Simplify `getCIFixInstructions()` and `getCIPendingInstructions()` to skill references
- [ ] 3.6 Simplify `getPushPRInstructions()` to skill reference
- [ ] 3.7 Remove `runWaitCI()` polling loop — replace with single `gh pr checks` read
- [ ] 3.8 Remove CI wait attempt tracking (marker file, `readCIWaitAttempts`, `writeCIWaitAttempts`, `cleanCIWaitAttempts`)
- [ ] 3.9 Remove `postGauntletPRCheck()` and `handleCIWaitWorkflow()` orchestration functions
- [ ] 3.10 Keep `checkPRStatus()` (lightweight state read)

## 4. Update Adapters

- [ ] 4.1 Update `StopHookResult` in `src/hooks/adapters/types.ts`: remove `ciFixReason`, `ciPendingReason`, `gateResults` fields; the `reason` field carries the skill instruction for all blocking statuses
- [ ] 4.2 Update Claude adapter to handle `validation_required` status
- [ ] 4.3 Update Cursor adapter to handle `validation_required` status
- [ ] 4.4 Simplify adapter output logic — all blocking statuses use the same `reason` field
- [ ] 4.5 Remove `ci_timeout` handling from adapters

## 5. Update Stop Hook Command

- [ ] 5.1 Remove unnecessary imports from `src/commands/stop-hook.ts` (`getStopReasonInstructions`, etc.)
- [ ] 5.2 Remove `outputHookResponse` legacy function if no longer needed
- [ ] 5.3 Simplify the logger initialization (no more gate execution output to capture)

## 6. Update Documentation

- [ ] 6.1 Update `docs/stop-hook-guide.md` to reflect coordinator model (no gate execution, skill-based responses)

## 7. Tests

- [ ] 7.1 Unit tests for `StopHookHandler.execute()` state machine:
  - Failed logs exist → blocks with `validation_required`
  - No failed logs + changes detected → blocks with `validation_required`
  - No failed logs + no changes → allows stop
  - No execution state + changes vs base branch → blocks
  - No execution state + no changes → allows
  - Failed logs exist + interval not elapsed → still blocks (failed logs take precedence)
  - No failed logs + interval not elapsed → allows
  - PR missing when `auto_push_pr` enabled → blocks with `pr_push_required`
  - CI pending when `auto_fix_pr` enabled → blocks with `ci_pending`
  - CI failed → blocks with `ci_failed`
  - CI passed → allows
  - Last run `passed_with_warnings` + `auto_push_pr` enabled + PR missing → blocks with `pr_push_required` and reason includes skipped issues note
  - `auto_fix_pr` disabled + PR up to date → allows stop (no CI check)
  - `gh` CLI not available when `auto_push_pr` enabled → allows stop (graceful degradation)
  - `gh pr view` fails when `auto_push_pr` enabled → allows stop (graceful degradation)
  - PR exists but head SHA doesn't match local HEAD when `auto_push_pr` enabled → blocks with `pr_push_required`
  - PR exists and head SHA matches when `auto_push_pr` enabled → proceeds to CI check (if `auto_fix_pr`) or allows
  - Last run was `retry_limit_exceeded` (logs auto-archived) + no new changes → allows stop
- [ ] 7.2 Unit tests for adapter formatting with new statuses (`validation_required`)
- [ ] 7.3 Update `test/integration/stop-hook-e2e.ts` to reflect coordinator model (stop hook no longer runs gates itself; verify skill instruction in block response instead of gate execution in debug logs)
- [ ] 7.4 Update existing stop-hook unit/integration tests
- [ ] 7.5 Update existing adapter unit tests (remove `ci_timeout` cases)

## 8. Validation

If there is a "Manual Verification" section above, complete all verification steps before marking the task complete.

### Manual Verification

- [ ] 8.1 Trigger stop hook with failed run logs present → verify it blocks with `validation_required` and reason instructs to use `gauntlet-run` skill
- [ ] 8.2 Trigger stop hook with clean state (no logs, no changes) → verify it allows stop
- [ ] 8.3 Trigger stop hook with `auto_push_pr` enabled and no PR → verify it blocks with `pr_push_required` and reason instructs to use `gauntlet-push-pr` skill
- [ ] 8.4 Trigger stop hook with `auto_fix_pr` enabled and CI pending → verify it blocks with `ci_pending` and reason instructs to use `gauntlet-fix-pr` skill
- [ ] 8.5 Verify all referenced skills exist: `gauntlet-run`, `gauntlet-push-pr`, `gauntlet-fix-pr`
- [ ] 8.6 Verify adapter output formats match spec for both Claude Code and Cursor protocols

When work is completed, the stop hook should correctly read state, block or allow based on the coordinator model, and direct the agent to the appropriate skill.
