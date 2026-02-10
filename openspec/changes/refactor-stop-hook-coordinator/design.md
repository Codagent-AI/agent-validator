# Stop Hook Coordinator Architecture

## Problem

The stop hook currently acts as an **executor** — it runs validation gates, polls CI, and formats failure logs, then tells the agent what to fix. This creates a "split brain" effect: the hook does work the agent didn't initiate, then interrupts the conversation with results that feel abrupt and out of context. The agent receives a wall of instructions about failures it didn't witness happening.

Meanwhile, the `gauntlet-run` skill already contains the full workflow instructions (trust level, JSON status updates, loop termination). The stop hook duplicates this knowledge in its response formatting.

## Solution

Convert the stop hook from an executor to a **stateless coordinator**. It reads observable state and tells the agent which skill to invoke — it never runs gates or polls CI itself.

The agent drives the workflow: it runs `agent-gauntlet run`, sees output in real time, understands what failed and why, and fixes issues with full conversational context. The stop hook only enforces that this work gets done.

## Decision Tree

Evaluated fresh on each stop attempt:

```
1. Fast exits (unchanged):
   - Env var guard (GAUNTLET_STOP_HOOK_ACTIVE) → allow
   - No .gauntlet/config.yml → allow
   - Marker file (fresh) → allow
   - Adapter-specific skip (e.g. Cursor loop_count) → allow

2. Failed run logs exist?
   → block: "use gauntlet-run skill"

3. Interval check (only when no failed logs):
   - run_interval_minutes not elapsed → allow

4. Changes since last working_tree_ref?
   → block: "use gauntlet-run skill"

5. auto_push_pr enabled? Check gh pr view:
   - PR missing or outdated → block: "use gauntlet-push-pr skill"

6. auto_fix_pr enabled? Check gh pr checks (single read, no polling):
   - CI pending or failed → block: "use gauntlet-fix-pr skill"

7. Allow stop
```

Steps 3-4 determine "has validation passed for the current state?" Steps 5-6 handle post-validation workflows. Each step is a read operation — file system for logs/execution state, `gh` CLI for PR/CI.

## State Observation Details

### Gauntlet validation status (steps 3-4)

The stop hook reads two things:

- **Run logs**: If `gauntlet_logs/run.N/` exists with failing gate logs, validation hasn't completed. The agent is mid-loop or abandoned the loop.
- **Execution state + change detection**: If no failed logs exist, compare `working_tree_ref` from `.execution_state` against the current working tree. If the tree has changed since the last passing run, validation is needed.

Edge cases:
- **No execution state at all** (first invocation ever): Fall through to change detection vs base branch. If changes exist, block. If not, allow.
- **Retry limit exceeded**: The runner auto-archives logs on retry limit. No logs remain, so the stop hook sees a clean state and checks for changes. Since `working_tree_ref` was updated, and the agent hasn't made new changes, it allows stop.
- **Interval + failed state**: Failed log detection happens before the interval check. If failed logs exist, always block regardless of interval — the agent needs to finish the loop. The interval check only applies when no failed logs exist.

### PR status (step 5)

Same as today: `gh pr view --json number,state,headRefOid` → compare head SHA with local HEAD. This is already coordinator-style — the stop hook checks state and tells the agent to create/update the PR.

### CI status (step 6)

Single check of `gh pr checks` — no polling loop, no cross-invocation attempt tracking. The stop hook sees "CI pending" or "CI failed" and tells the agent to use the `gauntlet-fix-pr` skill. The skill owns the wait/fix/push loop. On next stop attempt, the stop hook checks again. There is no `ci_timeout` — the stop hook blocks as long as CI hasn't passed.

## Response Format

Responses are simple skill invocations:

| State | Response |
|---|---|
| Failed logs exist | "Changes detected, you must use the `gauntlet-run` skill to validate them now." |
| Changes since last pass | "Changes detected, you must use the `gauntlet-run` skill to validate them now." |
| PR missing/outdated | "Gauntlet passed. You must use the `gauntlet-push-pr` skill to create or update your pull request." |
| CI pending/failed | "PR is up to date. You must use the `gauntlet-fix-pr` skill to wait for CI and fix any failures." |

No trust level injection, no log file paths, no violation handling instructions, no termination conditions. The skills contain all of that.

## What Changes

### Removed from stop hook handler

- `executeRun()` call — the core executor invocation
- `getStopReasonInstructions()` — failure log formatting, trust level, violation instructions
- `getFailedGateLogs()` — log path extraction from gate results
- `getCIFixInstructions()` / `getCIPendingInstructions()` — CI failure formatting
- `runWaitCI()` — CI polling loop
- CI wait attempt tracking (`.ci-wait-attempts` marker file, `ci_timeout` status)
- `postGauntletPRCheck()` / `handleCIWaitWorkflow()` — post-gauntlet orchestration

### Preserved in stop hook

- Fast exit guards (env var, config check, marker file, self-timeout)
- Adapter detection and protocol formatting (Claude/Cursor)
- Config resolution (3-tier precedence: env > project > global)
- `checkPRStatus()` — lightweight `gh pr view` read
- Debug logging
- Status messages for user-facing `stopReason` field

### Modified: stop hook handler

The `StopHookHandler.execute()` method becomes a state machine:
1. Check for failed run logs → block with gauntlet-run instruction
2. Check interval (only when no failed logs)
3. Read execution state — check for changes since last pass → block with gauntlet-run instruction
4. If `auto_push_pr` → check PR status → block with gauntlet-push-pr instruction
5. If `auto_fix_pr` → single CI status check → block with gauntlet-fix-pr instruction
6. Return allow

## What Doesn't Change

- `agent-gauntlet run` command and `run-executor.ts` — unchanged
- Gate implementations (check, review) — unchanged
- Change detection and `ChangeDetector` — unchanged
- Execution state management — unchanged
- `gauntlet-run` skill — unchanged (already has full workflow)
- `gauntlet-push-pr` skill — unchanged (already coordinator-style)
- Config schema and resolution — unchanged
