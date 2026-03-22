# Review: remove-stop-hooks

## Summary

The artifacts passed with fixes. The code quality and artifact reviews caught a real contradiction around the SessionStart hook — the design said not to remove it while the decisions said to remove it. Resolved by confirming full removal of both stop and start hooks including the SessionStart hook entry.

## Issues Fixed

- **design.md**: Removed contradictory non-goal about keeping SessionStart hook. Clarified risk mitigation to reference plugin skill descriptions instead of the (being-removed) SessionStart hook.
- **design.md**: Resolved stream-of-consciousness contradiction in Risks section.
- **design.md**: Removed open question that was already answered by the decision to remove everything.
- **specs/init-hook-install/spec.md**: Fixed scenario title "contains session start hook only" → "contains no stop or start hooks" to match the assertion body.

## Issues Skipped

- **specs/agent-command/spec.md**: Reviewer wanted explicit removal scenarios for stop-hook troubleshooting routing. The MODIFIED requirements already capture the behavior change (stop-hook routing removed from gauntlet-help skill). Adding a separate "removal" scenario would be redundant with the delta format.
- **4 stale task file violations**: Referenced old task files (`clean-hook-configs.md`, `delete-docs.md`, `remove-from-shared-modules.md`, `verify-build.md`) that were already deleted and consolidated into a single task.
- **check:security-code**: `semgrep` was not installed at run time. Now installed.

## Issues Remaining

None.

## Sign-off

APPROVED — artifacts are coherent and ready for implementation.
