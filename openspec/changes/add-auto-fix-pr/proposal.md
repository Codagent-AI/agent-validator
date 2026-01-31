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
- Affected code: `src/types/gauntlet-status.ts`, `src/config/schema.ts`, `src/config/global.ts`, `src/config/stop-hook-config.ts`, `src/commands/wait-ci.ts` (new), `src/commands/index.ts`, `src/index.ts`, `src/commands/stop-hook.ts`, `src/commands/init.ts`, `src/templates/fix_pr.template.md` (new)
