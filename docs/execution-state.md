# Execution State Tracking

## Why execution state exists

The validator runs code reviews by sending diffs to LLM-based adapters. These reviews are expensive — they consume tokens, take time, and produce results that are only meaningful relative to a specific snapshot of code. Without state tracking, every invocation of the validator would review the entire diff from scratch, even if nothing changed since the last run.

Execution state solves this by recording a **baseline**: the exact point in the repository's history (branch, commit, and working tree contents) at which the validator last completed. On subsequent runs, the validator computes diffs only from that baseline forward, so reviews are scoped to what actually changed. If a run passes, the baseline advances. If it fails, the baseline stays put so the next run can verify that only the failing issues were addressed.

This is especially important in iterative workflows where an AI coding agent runs the validator, fixes violations, and re-runs. Without state tracking, each cycle would re-review everything — including code that already passed — wasting tokens and risking false positives on unchanged code.

## Where state is stored

Execution state lives in a single JSON file:

```
<log_dir>/.execution_state
```

The default log directory is `.logs/` at the project root. The file is marked as **persistent** — it is never moved or archived during log cleanup operations, unlike regular log files which rotate into `previous/` directories.

## Data structure

```json
{
  "last_run_completed_at": "2026-03-23T14:30:00.000Z",
  "branch": "feature/my-change",
  "commit": "abc1234def5678...",
  "working_tree_ref": "def5678abc1234...",
  "unhealthy_adapters": {
    "copilot": {
      "marked_at": "2026-03-23T14:00:00.000Z",
      "reason": "3 consecutive timeouts"
    }
  }
}
```

| Field | Required | Description |
|---|---|---|
| `last_run_completed_at` | Yes | ISO 8601 timestamp of when the run completed |
| `branch` | Yes | Git branch name at time of completion |
| `commit` | Yes | Full HEAD commit SHA at time of completion |
| `working_tree_ref` | No | A git stash SHA capturing uncommitted changes (staged, unstaged, and untracked files). If the working tree was clean, this equals the commit SHA. |
| `unhealthy_adapters` | No | Map of adapter names to health entries. Used to temporarily skip adapters that are failing (e.g., due to rate limits or service outages). Entries expire after a 1-hour cooldown. |

### The working tree ref

The `working_tree_ref` is the key to precise diff scoping. It's created by running `git stash push --include-untracked`, which produces a special stash commit with three parents that captures the complete working tree state — committed code, staged changes, unstaged modifications, and untracked files. The stash is immediately popped to restore the working tree.

This means the validator can later diff against the exact state of your files at the time of the last run, not just the last commit. This matters because most development happens in uncommitted changes.

**Safety guardrails for stash creation:**
- Before pushing a stash, the validator records the current stash top (`stash@{0}`)ghh
- After pushing, it checks whether a new stash was actually created by comparing refs
- It only pops the stash if it confirms a new one was created — this prevents accidentally popping a pre-existing user stash
- If the working tree is clean, it skips stashing entirely and uses HEAD

## When state gets updated

### After a successful run (all gates pass)

When all gates pass, the validator:
1. Archives existing log files to `previous/`
2. Writes a new `.execution_state` with the current branch, commit, and working tree ref
3. Exits with code 0

The next run will diff from this new baseline, meaning only new changes will be reviewed.

### After a failed run (some gates fail)

When gates fail, the validator still writes execution state (at `gate-command.ts:315` and in the error handler at `gate-command.ts:392`). This preserves the baseline for the retry mechanism — the next run detects existing logs, enters **verification mode**, and uses `working_tree_ref` as the `fixBase` to narrow the diff to just what changed since the failure.

Importantly, log files are **not** archived on failure. Their presence is what triggers verification mode on the next run.

### On skip

The `skip` command writes execution state without running any gates. See [The skip command](#the-skip-command) below.

### On early exit with no changes

If the validator detects no changes but there are no outstanding violations, it writes execution state and exits with code 0. This advances the baseline even though no review was needed.

If there are outstanding violations (from a previous failed run) but no changes, it exits with code 1 **without** writing state — the baseline stays where it was, keeping pressure on the developer to fix the issues.

### On error

If an unexpected error occurs during execution, the validator attempts to write execution state in the error handler before exiting. This prevents losing the baseline due to transient failures.

## How state drives the verification (rerun) workflow

The validator has two modes:

**Full mode** — no existing logs in the log directory. The validator diffs against the base branch (or from the execution state's `fixBase` if available) and runs all applicable gates.

**Verification mode** — existing log files are present from a previous failed run, and no `--commit` flag was passed. The validator:

1. Parses previous log files to extract:
   - **Previous failures**: which gates failed, which adapters failed, and what violations were found
   - **Passed slots**: which review slots (adapter + index combinations) passed in previous iterations
2. Reads execution state to get the `working_tree_ref`
3. Sets `fixBase` to the `working_tree_ref`, so the diff is scoped to only what changed since the last run
4. Passes the previous failures map and passed slots map to the runner

### Passed slot skipping

When a gate has multiple review slots (`num_reviews > 1`), the validator tracks which slots passed in earlier iterations. On reruns:

- **Some slots passed, some failed**: Only the failed slots re-run; passed slots are skipped (status: `skipped_prior_pass`)
- **All slots passed previously**: A safety latch kicks in — slot @1 still runs to prevent false confidence, but the rest are skipped
- **All slots failed**: All slots run normally

### Rerun threshold filtering

In verification mode, the validator can filter out low-priority new violations discovered during the rerun. If `rerun_new_issue_threshold` is set (e.g., `"high"`), only violations at or above that priority level are kept. This prevents noisy failures on minor issues when the developer is trying to fix specific problems.

## Auto-clean: when state gets reset

Before each run, the validator checks whether the execution context has changed in a way that makes the existing state stale:

### Branch changed

If the current branch differs from `state.branch`, the validator deletes both the execution state and all logs. The next run starts completely fresh. This prevents carrying over state from an unrelated branch.

### Commit merged

If `state.commit` is an ancestor of the base branch (i.e., the commit has been merged), and the working tree is clean, the validator deletes execution state and logs. The rationale: if the work was merged, the baseline is meaningless — future diffs should be against the base branch.

**Exception**: If the working tree has uncommitted changes when a merge is detected, state is preserved. This avoids destroying the retry mechanism when a developer has uncommitted fixes in progress.

### Merged commit with working tree ref

When a commit is detected as merged but a `working_tree_ref` still exists and is valid, the validator can use it as the `fixBase`. This handles the case where a commit was merged but there were uncommitted changes that still need to be reviewed relative to that snapshot.

## The skip command

```bash
npx agent-validator skip
```

The `skip` command advances the execution state baseline without running any gates. It:

1. Acquires the run lock (preventing concurrent validator runs)
2. Archives existing log files to `previous/`
3. Writes a new `.execution_state` with the current branch, commit, and working tree ref
4. Releases the lock
5. Prints: `Baseline advanced to <sha>. Next run will diff from here.`

### When to use skip

**You've manually reviewed and accepted changes.** You made code changes that you know are correct, and you don't want the validator to flag them on the next run. Running `skip` records the current state as the new baseline.

**You want to ignore existing violations.** Perhaps a previous validator run flagged issues that you've decided are acceptable (false positives, intentional patterns, low-priority items). Running `skip` archives those logs and advances the baseline, so the next run won't try to verify those violations.

**You're integrating upstream changes.** After merging or rebasing, the diff from the old baseline might be enormous and full of code you didn't write. Running `skip` resets the baseline to the current state so only your future changes get reviewed.

**You want a clean starting point.** If the validator is in a confused state (e.g., stale logs from a different context), `skip` gives you a clean reset without deleting anything manually.

**CI/deployment baselines.** In automated workflows, `skip` can record a known-good state after deployment so future validator runs only review changes since that deployment.

## Edge cases

### No prior state

When `.execution_state` doesn't exist (first run, or after a state reset), `readExecutionState()` returns `null`. The validator runs in full mode, diffing against the base branch. A new state file is created when the run completes.

### Corrupted or invalid state file

If the JSON is malformed or missing required fields (`last_run_completed_at`, `branch`, `commit`), `readExecutionState()` returns `null`. The validator treats this identically to "no prior state" — it falls back to full mode. No error is thrown; the file is silently ignored and overwritten on completion.

### Garbage-collected git objects

The `working_tree_ref` is a stash SHA. Git may garbage-collect stash objects if they become unreachable. The `resolveFixBase()` function handles this gracefully:

1. If `working_tree_ref` exists in the object store → use it as `fixBase`
2. If `working_tree_ref` was garbage-collected but `commit` still exists → fall back to `commit` as `fixBase` (with a warning: "Session stash was garbage collected, using commit as fallback")
3. If both are gone → fall back to `null` (diff against base branch)

### Concurrent runs

A `.validator-run.lock` file in the log directory prevents concurrent validator executions. The lock contains the PID of the running process. If a validator process crashes without releasing the lock, the file must be manually deleted. Both the `skip` command and gate commands acquire this lock before modifying state.

### Stash pop failure

If `git stash pop` fails after creating the working tree snapshot (e.g., due to conflicts), the validator prints an error message asking the user to run `git stash pop` manually, but continues execution. The `working_tree_ref` is still valid and written to state.

### Max retries exceeded

The validator tracks run iterations via log file count. If the number of runs exceeds `max_retries` (default: 3), the validator exits with "Retry limit exceeded" rather than running indefinitely. Running `skip` resets this counter by archiving the logs.

### Unhealthy adapter recovery

Adapters marked unhealthy have a 1-hour cooldown. Invalid or missing `marked_at` timestamps are treated as expired (cooldown over), ensuring adapters don't stay permanently disabled due to a clock issue. When the execution state is rewritten, unhealthy adapter entries are preserved from the existing state and merged into the new state.
