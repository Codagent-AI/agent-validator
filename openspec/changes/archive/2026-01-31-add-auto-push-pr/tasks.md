# Tasks: add-auto-push-pr

## 0. Pre-factoring

See `design.md` Pre-factoring section for full CodeScene analysis.

Hotspots modified by this change: `stop-hook.ts` (7.07, cc=36) and `init.ts` (6.28, cc=24). Refactoring deferred: new logic will be added in extracted helper functions (`checkPRStatus`, `getPushPRInstructions`) rather than modifying the existing complex functions, avoiding worsening the hotspots while minimizing risk.

## 1. Implementation

### Config & Types
- [x] Add `pr_push_required` to `GauntletStatus` union in `src/types/gauntlet-status.ts`
- [x] Update `isBlockingStatus()` to return `true` for `pr_push_required`
- [x] Add `auto_push_pr` to `stopHookConfigSchema` in `src/config/schema.ts`
- [x] Add `auto_push_pr` to global config schema and `DEFAULT_GLOBAL_CONFIG` in `src/config/global.ts`
- [x] Add `GAUNTLET_AUTO_PUSH_PR` env var constant in `src/config/stop-hook-config.ts`
- [x] Extend `StopHookConfig` interface with `auto_push_pr: boolean`
- [x] Extend `parseStopHookEnvVars()` to parse `GAUNTLET_AUTO_PUSH_PR`
- [x] Extend `resolveStopHookConfig()` with 3-tier resolution for `auto_push_pr`

### Stop Hook PR Workflow
- [x] Add `checkPRStatus(cwd)` helper function — runs `gh pr view --json number,state,headRefOid` and compares with local `git rev-parse HEAD`; returns PR state (no PR, not up to date, up to date)
- [x] Add `getPushPRInstructions(result)` helper function — generates generic prompt for creating or updating a PR with skill-first lookup and minimal fallback
- [x] Add `getStatusMessage()` case for `pr_push_required`
- [x] Add post-gauntlet branching in a new extracted helper: when success status + `auto_push_pr` enabled, check PR status and block with push-pr instructions if no PR or not up to date; only trigger on `passed`/`passed_with_warnings` (not termination statuses)
- [x] Handle `gh` CLI not installed and other `gh` errors gracefully (log warning, approve stop)

### Template Command
- [x] Create `src/templates/push_pr.template.md` — simplified push-pr instructions
- [x] Update `src/commands/init.ts` to create `.gauntlet/push_pr.md` during init
- [x] Update `installCommands()` in init.ts to install push-pr symlink/copy alongside gauntlet command

### Dogfooding: Enable for agent-gauntlet project
- [x] Set `auto_push_pr: true` in `.gauntlet/config.yml` for this project
- [x] Verify existing user-level `/push-pr` skill at `~/.claude/skills/push-pr/SKILL.md` has a clear description for auto-detection (the skill description should convey it handles PR creation/updating so the agent finds it when looking for push-pr instructions)

## 2. Tests
- [x] Add tests for `GAUNTLET_AUTO_PUSH_PR` env var parsing in stop-hook-config tests
- [x] Add tests for 3-tier resolution of `auto_push_pr`
- [x] Add tests for `isBlockingStatus("pr_push_required")` returning true
- [x] Add tests for `pr_push_required` status message
- [x] Add tests for push-pr instruction content (generic create/update language)
- [ ] Add tests for `checkPRStatus()`: no PR (block), PR not up to date (block), PR up to date (approve), gh not installed (graceful degradation), gh errors (graceful degradation)
- [ ] Add tests for init creating push_pr.md template
- [ ] Add integration tests in `test/commands/stop-hook.test.ts` for PR push workflow: success + auto_push_pr enabled triggers PR check; block with pr_push_required when no PR or not up to date; approve when PR is up to date; termination statuses skip PR detection

## 3. Manual Verification

- [ ] Manual: set `auto_push_pr: true` in `.gauntlet/config.yml`, run gauntlet via stop hook, verify it blocks with `pr_push_required` and push-pr instructions after gates pass
- [ ] Manual: verify the stop hook's push-pr instructions cause the agent to auto-detect and apply the user-level `/push-pr` skill (at `~/.claude/skills/push-pr/SKILL.md`) when auto-pushing the pull request — the skill should be found because the instructions tell the agent to look for `/push-pr` skill first

## 4. Validation

There are no validation tasks that need to be explicitly run. When work is completed, a stop hook should execute the full gauntlet of verification tasks and give direction on what needs to be fixed.

If there is a "Manual Verification" section above, complete all verification steps before marking the task complete.
