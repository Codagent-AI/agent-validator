# Change: Refactor stop hook from executor to coordinator

## Why
The stop hook currently executes gates, polls CI, and formats failure instructions itself, creating a "split brain" effect where the hook does work the agent didn't initiate. The agent receives an abrupt interruption with failure results it didn't witness. The `gauntlet-run` skill already contains the full workflow — the stop hook duplicates that knowledge.

## What Changes
- Stop hook handler no longer calls `executeRun()` — it reads observable state (log files, execution state, `gh` CLI) to decide block/allow
- Block responses become simple skill invocations ("use the `gauntlet-run` skill") instead of detailed failure instructions
- CI polling loop removed from stop hook — the `gauntlet-fix-pr` skill owns that workflow
- CI wait attempt tracking removed from stop hook
- Failure log path formatting, trust level injection, and violation handling instructions removed from stop hook
- New `validation_required` status added for the "changes detected, must validate" case

## Alternatives Considered
- **Lighter messaging (keep executor, simplify responses)**: The stop hook would still run gates but return simpler responses. Rejected because the "split brain" problem — the agent not witnessing the work — persists regardless of how the response is formatted.
- **Hybrid (executor for checks, coordinator for reviews)**: Run cheap check gates in the hook but delegate reviews to the agent. Rejected because it adds complexity with two code paths and the conversational coherence benefit only applies if the agent drives all validation.

## Impact
- Affected specs: `stop-hook`
- Affected code: `src/hooks/stop-hook-handler.ts`, `src/commands/stop-hook.ts`, `src/hooks/adapters/claude-stop-hook.ts`, `src/hooks/adapters/cursor-stop-hook.ts`, `src/hooks/adapters/types.ts`
- New code: `src/hooks/stop-hook-state.ts` (state reader module)
- Affected tests: `test/hooks/stop-hook-handler.test.ts`, `test/commands/stop-hook.test.ts`, `test/hooks/adapters/claude-stop-hook.test.ts`, `test/hooks/adapters/cursor-stop-hook.test.ts`
- Affected docs: `docs/stop-hook-guide.md`
- Skill dependencies: `gauntlet-run`, `gauntlet-push-pr`, `gauntlet-fix-pr` (all already exist)
