# Design: add-auto-fix-pr

## Context

After `add-auto-push-pr` creates a PR, the developer still needs to manually monitor CI and address failures. This change extends the stop hook workflow to wait for CI, then instruct the agent to fix failures or address review comments — completing the autonomous dev-to-merge loop.

This builds directly on `add-auto-push-pr`: when a PR already exists and `auto_fix_pr` is enabled, the stop hook enters the CI wait workflow instead of approving immediately.

**Architecture Note:** Since `add-auto-push-pr` was implemented, the stop hook has been refactored into an adapter-based architecture (`add-cursor-stop-hook`, `simplify-stop-hook-executor`). The stop hook is now a thin adapter layer with:
- `StopHookHandler` class in `src/hooks/stop-hook-handler.ts` — core logic
- `ClaudeStopHookAdapter` and `CursorStopHookAdapter` — protocol-specific I/O
- `StopHookResult` interface with `instructions`, `pushPRReason`, and now `ciFixReason`, `ciPendingReason`

CI workflow logic will be added to `StopHookHandler`, and both adapters will handle the new CI statuses.

## Pre-factoring

CodeScene hotspot analysis for files modified by this change:

| File | Score | Status |
|------|-------|--------|
| `src/hooks/stop-hook-handler.ts` | TBD | Core handler logic — CI workflow will be added here |
| `src/hooks/adapters/claude-stop-hook.ts` | TBD | Needs to handle CI status output formatting |
| `src/hooks/adapters/cursor-stop-hook.ts` | TBD | Needs to handle CI status output formatting |
| `src/hooks/adapters/types.ts` | TBD | Add `ciFixReason`, `ciPendingReason` to `StopHookResult` |
| `src/config/stop-hook-config.ts` | 9.24 (Green) | Healthy |
| `src/config/schema.ts` | 10.0 (Optimal) | Healthy |
| `src/config/global.ts` | 9.53 (Green) | Healthy |
| `src/types/gauntlet-status.ts` | 10.0 (Optimal) | Healthy |

**Strategy:** CI workflow logic (wait-ci spawning, retry tracking, instruction generation) will be added to `StopHookHandler` as helper functions. Both adapters will be updated to handle the new CI statuses (`ci_pending`, `ci_failed`, `ci_passed`, `ci_timeout`) in their `formatOutput()` methods, following the existing pattern for `pr_push_required`. `isSuccessStatus()` already exists in the codebase at `src/types/gauntlet-status.ts:60`.

## Goals / Non-Goals

**Goals:**
- Wait for CI after PR is created, then fix failures autonomously
- Limit CI waiting to prevent infinite loops (3-attempt cap)
- Clear definition of what constitutes a blocking review
- Reuse `gh` CLI for all GitHub interactions

**Non-Goals:**
- Automatic merging after CI passes
- Handling merge conflicts
- Interacting with specific CI providers (just read `gh pr checks` output)

## Decisions

### 1. `auto_fix_pr` Setting

| Setting | Type | Default | Env Var |
|---------|------|---------|---------|
| `auto_fix_pr` | boolean | `false` | `GAUNTLET_AUTO_FIX_PR` (`true`/`1`/`false`/`0`) |

Same 3-tier precedence. **Validation**: if `auto_fix_pr=true` but `auto_push_pr=false`, log warning and treat `auto_fix_pr` as `false`.

### 2. `wait-ci` CLI Command

Standalone command: `agent-gauntlet wait-ci`

**Options:**
- `--timeout <seconds>` (default: 270, just under the 5-minute stop hook budget)
- `--poll-interval <seconds>` (default: 15)

**Flow:**
1. Find PR via `gh pr view --json number,url,headRefName`
2. Poll loop:
   - `gh pr checks --json name,state,conclusion,detailsUrl` for CI status
   - `gh api repos/{owner}/{repo}/pulls/{number}/reviews` for review feedback
   - Any check failed → output JSON, exit 1
   - All passed + no blocking reviews → output JSON, exit 0
   - Still pending → sleep, continue
3. On timeout → output JSON, exit 2

**Output JSON:**
```json
{
  "ci_status": "passed | failed | pending | error",
  "pr_number": 123,
  "pr_url": "https://github.com/...",
  "failed_checks": [{ "name": "...", "conclusion": "...", "details_url": "..." }],
  "review_comments": [{ "author": "...", "body": "...", "path": "...", "line": 0 }],
  "elapsed_seconds": 120
}
```

**Exit codes:**
- 0: all checks passed, no blocking reviews
- 1: failed checks, blocking reviews, error, or no PR found (`ci_status: "error"`)
- 2: timeout, checks still pending

### 3. Blocking Review Comment Definition

- `REQUEST_CHANGES` review state → **blocking**
- `APPROVED` review state → not blocking
- `COMMENTED` review state → not blocking
- All review comments are included in the `review_comments` output array regardless of blocking status, for informational purposes

### 4. Stop Hook CI Wait Flow

**Multi-invocation flow:** The `auto_push_pr` flow always runs first. On the first stop hook invocation after gauntlet passes, if no PR exists (or PR is not up to date), the hook blocks with `pr_push_required`. The agent creates/updates the PR and stops again. On the next invocation, `auto_push_pr` sees the PR is up to date, and only then does `auto_fix_pr` enter the CI wait workflow.

**Architecture:** This logic is implemented in `StopHookHandler.execute()` in `src/hooks/stop-hook-handler.ts`, extending the existing `postGauntletPRCheck()` flow. The handler returns a `StopHookResult` with the appropriate status and reason fields, which adapters format for their protocols.

When a PR exists and is up to date, and `auto_fix_pr` is enabled:

```
PR exists + auto_fix_pr enabled
  → read ci_wait_attempts from marker file (gauntlet_logs/.ci-wait-attempts)
  → attempts >= 3?
    → yes: approve with ci_timeout + message, clean marker
    → no: spawn `agent-gauntlet wait-ci --timeout 270`
      → ci_status=passed: clean marker, approve with ci_passed
      → ci_status=failed: clean marker, block with ci_failed + fix instructions
      → ci_status=pending: increment marker, block with ci_pending + wait instructions
```

**Re-invocation mechanism:** When blocking with `ci_pending`, the stop hook returns a blocking response that prompts the agent to continue. The instruction tells the agent to wait ~30 seconds and try to stop again. When the agent attempts to stop, the stop hook is re-invoked, reads the marker file, and resumes the CI wait flow. This is the same pattern used for `pr_push_required` — the stop hook is stateless between invocations.

### 5. Retry Tracking

Marker file: `gauntlet_logs/.ci-wait-attempts` containing a JSON counter. Tracks attempts across stop hook invocations since the hook process exits between retries.

- Created on first CI wait attempt (count: 1)
- Incremented on subsequent pending results
- Cleaned up on pass, fail, or max attempts reached
- Max 3 attempts (~15 minutes of total CI waiting with 270s timeout each)

### 6. CI Instructions

Two helper functions following the same simplified pattern as `getPushPRInstructions()`:

**`getCIFixInstructions(ciResult)`** — for `ci_failed` status:

```
**CI FAILED OR REVIEW CHANGES REQUESTED — FIX AND PUSH**

{failed_checks_section if any}
{review_comments_section if any}

Fix the issues above, commit, and push your changes. After pushing, try to stop again.
```

Where `{failed_checks_section}` is:
```
**Failed checks:**
- {check_name}: {details_url}
...
```

And `{review_comments_section}` is:
```
**Review comments requiring changes:**
- {author}: {body} ({path}:{line})
...
```

**`getCIPendingInstructions(attemptNumber, maxAttempts)`** — for `ci_pending` status:

```
**CI CHECKS STILL RUNNING — WAITING (attempt {attemptNumber} of {maxAttempts})**

CI checks are still in progress. Wait approximately 30 seconds, then try to stop again.
```

### 7. Fix-PR Template Command

One template file installed during `agent-gauntlet init`:
- `.gauntlet/fix_pr.md` — simplified fix-pr instructions

Gets symlinked to `.claude/commands/fix-pr.md` following the existing `push_pr.md` pattern. Existing files are not overwritten.

## Alternatives Considered

1. **Inline CI polling in the stop hook** — Rejected: separate `wait-ci` command is more testable and independently usable
2. **Unlimited CI wait retries** — Rejected: 3 retries (~15 min total) balances patience with practicality
3. **Agent-tracked retry count** — Rejected: marker file is more reliable than depending on agent compliance

## Risks / Trade-offs

- **Stop hook timeout**: The 5-minute stop hook timeout constrains polling. 270-second default leaves buffer, but slow gauntlet runs could eat into this. The timeout is configurable.
- **Retry mechanism**: The "block, tell agent to wait, re-trigger" pattern for `ci_pending` is untested with Claude Code. If Claude Code doesn't re-invoke the stop hook after a blocked stop, this won't work. The 3-attempt limit prevents infinite loops.
- **`gh` CLI dependency**: Same as `add-auto-push-pr` — graceful degradation if not available.
