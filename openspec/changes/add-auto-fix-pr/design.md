# Design: add-auto-fix-pr

## Context

After `add-auto-push-pr` creates a PR, the developer still needs to manually monitor CI and address failures. This change extends the stop hook workflow to wait for CI, then instruct the agent to fix failures or address review comments — completing the autonomous dev-to-merge loop.

This builds directly on `add-auto-push-pr`: when a PR already exists and `auto_fix_pr` is enabled, the stop hook enters the CI wait workflow instead of approving immediately.

## Pre-factoring

CodeScene hotspot analysis for files modified by this change:

| File | Score | Status |
|------|-------|--------|
| `src/commands/stop-hook.ts` | 7.07 (Yellow) | Bumpy Road, Complex Method (cc=36), Large Method (240 LoC) in `registerStopHookCommand` |
| `src/config/stop-hook-config.ts` | 9.24 (Green) | Healthy |
| `src/config/schema.ts` | 10.0 (Optimal) | Healthy |
| `src/config/global.ts` | 9.53 (Green) | Healthy |
| `src/types/gauntlet-status.ts` | 10.0 (Optimal) | Healthy |

**Strategy:** Same as `add-auto-push-pr` — no refactoring of existing code. CI workflow logic (wait-ci spawning, retry tracking, instruction generation) will be extracted into separate helper functions rather than added to the `registerStopHookCommand` monolith. `isSuccessStatus()` already exists in the codebase at `src/types/gauntlet-status.ts:60`.

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

### 5. Retry Tracking

Marker file: `gauntlet_logs/.ci-wait-attempts` containing a JSON counter. Tracks attempts across stop hook invocations since the hook process exits between retries.

- Created on first CI wait attempt (count: 1)
- Incremented on subsequent pending results
- Cleaned up on pass, fail, or max attempts reached
- Max 3 attempts (~15 minutes of total CI waiting with 270s timeout each)

### 6. Fix-PR Instructions

When blocking with `ci_failed`, the `reason` prompt:
1. Look for project-level instructions (`/fix-pr` skill, `.claude/commands/fix-pr.md`, `.gauntlet/fix_pr.md`) — these paths may or may not exist depending on whether `add-auto-push-pr` templates were installed; fallback handles either case
2. Fallback: read failed check details, fix issues, push changes
3. Include specific failed check names and review comment details from wait-ci output

### 7. CI Pending Instructions

When blocking with `ci_pending`, the `reason` prompt:
1. Note the attempt number (N of 3)
2. Instruct agent to wait briefly, then try to stop again

### 8. Fix-PR Template Command

One template file installed during `agent-gauntlet init`:
- `.gauntlet/fix_pr.md` — simplified fix-pr instructions (renamed from address-pr; skill-first lookup, minimal fallback)

Gets symlinked to `.claude/commands/fix-pr.md` following the existing `run_gauntlet.md` pattern. Existing files are not overwritten.

## Alternatives Considered

1. **Inline CI polling in the stop hook** — Rejected: separate `wait-ci` command is more testable and independently usable
2. **Unlimited CI wait retries** — Rejected: 3 retries (~15 min total) balances patience with practicality
3. **Agent-tracked retry count** — Rejected: marker file is more reliable than depending on agent compliance

## Risks / Trade-offs

- **Stop hook timeout**: The 5-minute stop hook timeout constrains polling. 270-second default leaves buffer, but slow gauntlet runs could eat into this. The timeout is configurable.
- **Retry mechanism**: The "block, tell agent to wait, re-trigger" pattern for `ci_pending` is untested with Claude Code. If Claude Code doesn't re-invoke the stop hook after a blocked stop, this won't work. The 3-attempt limit prevents infinite loops.
- **`gh` CLI dependency**: Same as `add-auto-push-pr` — graceful degradation if not available.
