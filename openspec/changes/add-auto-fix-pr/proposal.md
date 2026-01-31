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

- Affected specs: stop-hook, agent-command, init-hook-install
- Affected code:
  - `src/types/gauntlet-status.ts` — add CI status values
  - `src/config/schema.ts` — add `auto_fix_pr` to schema
  - `src/config/global.ts` — add `auto_fix_pr` to global config
  - `src/config/stop-hook-config.ts` — add `GAUNTLET_AUTO_FIX_PR` env var and resolution
  - `src/commands/wait-ci.ts` (new) — CI polling command
  - `src/commands/index.ts` — register wait-ci command
  - `src/index.ts` — register wait-ci command
  - `src/hooks/stop-hook-handler.ts` — CI workflow logic in handler
  - `src/hooks/adapters/types.ts` — add `ciFixReason`, `ciPendingReason` to `StopHookResult`
  - `src/hooks/adapters/claude-stop-hook.ts` — handle CI statuses in `formatOutput()`
  - `src/hooks/adapters/cursor-stop-hook.ts` — handle CI statuses in `formatOutput()`
  - `src/commands/init.ts` — install fix_pr.md template
  - `src/templates/fix_pr.template.md` (new) — fix-pr instructions template
