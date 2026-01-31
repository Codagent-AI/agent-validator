# Proposal: add-auto-fix-pr

## Why

After `add-auto-push-pr` creates the PR, the developer still needs to manually monitor CI and address failures or reviewer feedback. For fully autonomous workflows, the stop hook should keep the agent going until CI passes and review feedback is addressed.

## What Changes

- Add `auto_fix_pr` boolean setting with 3-tier precedence (requires `auto_push_pr` to be enabled)
- Add `ci_pending`, `ci_failed`, `ci_passed` statuses to `GauntletStatus`
- Add `agent-gauntlet wait-ci` CLI command that polls CI status and review comments
- Extend stop hook with CI wait logic, retry tracking (3-attempt marker file), and fix-pr/pending instructions
- Define blocking review comments as `REQUEST_CHANGES` reviews
- Add fix-pr template command installed during `agent-gauntlet init`

## Dependencies

This change depends on `add-auto-push-pr` being implemented first.

## Impact

- Affected specs: `specs/stop-hook/spec.md`, `specs/agent-command/spec.md`, `specs/init-hook-install/spec.md`
- Affected code:
  - `src/types/gauntlet-status.ts:5` — add CI status values
  - `src/config/schema.ts:127` — add `auto_fix_pr` to schema
  - `src/config/global.ts:26` — add `auto_fix_pr` to global config
  - `src/config/stop-hook-config.ts:11` — add `GAUNTLET_AUTO_FIX_PR` env var and resolution
  - `src/commands/wait-ci.ts:1` (new) — CI polling command
  - `src/commands/index.ts:1` — register wait-ci command
  - `src/index.ts:27` — register wait-ci command
  - `src/hooks/stop-hook-handler.ts:420` — CI workflow logic in handler
  - `src/hooks/adapters/types.ts:24` — add `ciFixReason`, `ciPendingReason` to `StopHookResult`
  - `src/hooks/adapters/claude-stop-hook.ts:55` — handle CI statuses in `formatOutput()`
  - `src/hooks/adapters/cursor-stop-hook.ts:77` — handle CI statuses in `formatOutput()`
  - `src/commands/init.ts:1` — install fix_pr.md template
  - `src/templates/fix_pr.template.md:1` (new) — fix-pr instructions template
