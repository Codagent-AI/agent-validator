# Proposal: add-auto-push-pr

## Why

After the gauntlet passes, the agent stops and the developer must manually commit and create a PR. For fully autonomous workflows, the stop hook should keep the agent going through PR creation without manual intervention.

## What Changes

- Add `auto_push_pr` boolean setting with 3-tier precedence (env var > project > global)
- Add `pr_push_required` status to `GauntletStatus` (blocks stop, returns push-pr instructions)
- Extend stop hook to check whether a PR exists and is up to date after gates pass; block if PR is missing or has unpushed commits
- Add push-pr template command installed during `agent-gauntlet init`
- Graceful degradation when `gh` CLI is unavailable

## Impact

- Affected specs: stop-hook, agent-command, init-hook-install
- Affected code: `src/types/gauntlet-status.ts`, `src/config/schema.ts`, `src/config/global.ts`, `src/config/stop-hook-config.ts`, `src/commands/stop-hook.ts`, `src/commands/init.ts`, `src/templates/push_pr.template.md` (new)
