# Tasks: add-auto-fix-pr

## 0. Pre-factoring

**Dependency**: `add-auto-push-pr` must be implemented before starting this change.

See `design.md` Pre-factoring section for full CodeScene analysis. No hotspots modified.

## 1. Implementation

### Config & Types
- [ ] Add `ci_pending`, `ci_failed`, `ci_passed`, `ci_timeout` to `GauntletStatus` union in `src/types/gauntlet-status.ts`
- [ ] Update `isBlockingStatus()` to return `true` for `ci_pending` and `ci_failed`
- [ ] Update `isSuccessStatus()` to return `true` for `ci_passed` (note: `isSuccessStatus()` already exists in the codebase)
- [ ] Ensure `ci_timeout` is non-blocking (`isBlockingStatus` returns `false`) and not a success status (`isSuccessStatus` returns `false`)
- [ ] Add `auto_fix_pr` to `stopHookConfigSchema` in `src/config/schema.ts`
- [ ] Add `auto_fix_pr` to global config schema and `DEFAULT_GLOBAL_CONFIG` in `src/config/global.ts`
- [ ] Add `GAUNTLET_AUTO_FIX_PR` env var constant in `src/config/stop-hook-config.ts`
- [ ] Extend `StopHookConfig` interface with `auto_fix_pr: boolean`
- [ ] Extend `parseStopHookEnvVars()` to parse `GAUNTLET_AUTO_FIX_PR`
- [ ] Extend `resolveStopHookConfig()` with 3-tier resolution for `auto_fix_pr`
- [ ] Add validation: if `auto_fix_pr=true` but `auto_push_pr=false`, log warning and treat as false

### wait-ci CLI Command
- [ ] Create `src/commands/wait-ci.ts` with Commander registration
- [ ] Implement `--timeout` and `--poll-interval` options
- [ ] Implement PR detection via `gh pr view --json number,url,headRefName`
- [ ] Implement CI check polling via `gh pr checks`
- [ ] Implement review comment fetching via `gh api` — blocking reviews are `REQUEST_CHANGES` reviews only
- [ ] Implement polling loop with sleep and timeout
- [ ] Fail immediately if any check has failed (don't wait for pending checks)
- [ ] Output structured JSON with ci_status, failed_checks, review_comments, elapsed_seconds
- [ ] Exit with appropriate codes: 0=passed, 1=failed/error/no-PR, 2=pending
- [ ] Handle `gh` CLI not installed with clear error
- [ ] Register command in `src/commands/index.ts` and `src/index.ts`

### Stop Hook CI Workflow (in `src/hooks/stop-hook-handler.ts`)
- [ ] Add `readCIWaitAttempts(logDir)` helper — reads `.ci-wait-attempts` marker file
- [ ] Add `writeCIWaitAttempts(logDir, count)` helper — writes attempt count
- [ ] Add `cleanCIWaitAttempts(logDir)` helper — removes marker file
- [ ] Add `runWaitCI(cwd)` helper — spawns `agent-gauntlet wait-ci` and parses JSON output
- [ ] Add `getCIFixInstructions(ciResult)` helper — generates fix-pr prompt with failure details (follows simplified pattern like `getPushPRInstructions`)
- [ ] Add `getCIPendingInstructions(ciResult, attemptNumber)` helper — generates wait-and-retry prompt with attempt count and ~30 second wait
- [ ] Add `getStatusMessage()` cases for `ci_pending`, `ci_failed`, `ci_passed`, `ci_timeout`
- [ ] Extend `StopHookHandler.execute()` with CI workflow: when PR exists and is up to date + auto_fix_pr enabled, run wait-ci and handle result (auto_push_pr flow runs first if PR is missing/stale)
- [ ] Implement 3-attempt retry limit for ci_pending; on max attempts, approve with `ci_timeout` status and message indicating CI wait exhausted

### Adapter Updates
- [ ] Add `ciFixReason` and `ciPendingReason` fields to `StopHookResult` interface in `src/hooks/adapters/types.ts`
- [ ] Update `ClaudeStopHookAdapter.formatOutput()` to handle `ci_pending` and `ci_failed` statuses (use `ciFixReason`/`ciPendingReason` for `reason` field)
- [ ] Update `CursorStopHookAdapter.formatOutput()` to handle `ci_pending` and `ci_failed` statuses (use `ciFixReason`/`ciPendingReason` for `followup_message` field)

### Template Command
- [ ] Create `src/templates/fix_pr.template.md` — simplified fix-pr instructions (renamed from address-pr)
- [ ] Update `src/commands/init.ts` to create `.gauntlet/fix_pr.md` during init
- [ ] Update `installCommands()` in init.ts to install fix-pr symlink/copy alongside gauntlet and push-pr commands

### Dogfooding: Enable for agent-gauntlet project
- [ ] Set `auto_fix_pr: true` in `.gauntlet/config.yml` for this project

## 2. Tests
- [ ] Add tests for `GAUNTLET_AUTO_FIX_PR` env var parsing
- [ ] Add tests for 3-tier resolution of `auto_fix_pr`
- [ ] Add tests for auto_fix_pr requires auto_push_pr validation
- [ ] Add tests for `isBlockingStatus()` with CI statuses (`ci_pending` and `ci_failed` block; `ci_passed` and `ci_timeout` do not)
- [ ] Add tests for `isSuccessStatus()` with `ci_passed` (true) and `ci_timeout` (false)
- [ ] Add tests for CI status messages (including `ci_timeout`)
- [ ] Create `test/commands/wait-ci.test.ts` with tests for:
  - [ ] gh output parsing
  - [ ] Exit code mapping (0/1/2)
  - [ ] Timeout behavior
  - [ ] Review comment filtering (REQUEST_CHANGES vs approved vs informational)
  - [ ] No PR found handling (exit code 1)
  - [ ] Mixed state: some failed + some pending → immediate failure
- [ ] Add tests for `runWaitCI()` helper: JSON parsing of wait-ci output, handling of spawn failures
- [ ] Add tests for CI wait attempt marker file read/write/clean
- [ ] Add unit tests for CI workflow branching in `StopHookHandler.execute()` by mocking `runWaitCI` (ci_passed/ci_failed/ci_pending/ci_timeout)
- [ ] Add tests for fix-pr instruction content (includes failure details, fix-and-push guidance)
- [ ] Add tests for pending instruction content (includes attempt numbers and ~30s wait)
- [ ] Add tests for init creating fix_pr.md template
- [ ] Add tests in `test/hooks/adapters/claude-stop-hook.test.ts` for CI status output formatting (`ci_pending`, `ci_failed`, `ci_passed`, `ci_timeout`)
- [ ] Add tests in `test/hooks/adapters/cursor-stop-hook.test.ts` for CI status output formatting (`ci_pending`, `ci_failed`, `ci_passed`, `ci_timeout`)

Note: End-to-end integration tests for the CI wait workflow are deferred — the workflow involves external dependencies (`gh` CLI, GitHub API, actual CI state) that are impractical to mock reliably. The Manual Verification section covers end-to-end testing; handler-level unit tests are required above.

## 3. Manual Verification

These steps verify basic functionality that cannot be easily unit tested. They must be performed by the agent before marking the task complete.

### wait-ci command
- [ ] 3.1 Run `bun src/index.ts wait-ci --help` — verify command is registered and shows `--timeout` and `--poll-interval` options
- [ ] 3.2 Run `bun src/index.ts wait-ci` in this repo (no PR on current branch) — verify exit code 1 and JSON output with `ci_status: "error"`

### Marker file behavior
- [ ] 3.3 Verify marker file helpers work correctly:
  - Create `gauntlet_logs/.ci-wait-attempts` with `{"count":2}`
  - Call `readCIWaitAttempts()` — verify returns 2
  - Call `writeCIWaitAttempts(3)` — verify file updated
  - Call `cleanCIWaitAttempts()` — verify file removed

## 4. Validation

There are no additional validation tasks. When work is completed, a stop hook should execute the full gauntlet of verification tasks and give direction on what needs to be fixed.

If there is a "Manual Verification" section above, complete all verification steps before marking the task complete.
