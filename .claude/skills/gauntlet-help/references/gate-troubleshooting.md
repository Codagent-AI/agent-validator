# Gate Troubleshooting

## Check Gate Failures

Check gates run shell commands (linters, test runners, etc.) and report pass/fail based on exit code.

### Common Failure Modes

| Failure | Cause | Evidence |
|---------|-------|----------|
| Command not found | Binary not installed or not in PATH | Check gate log for "command not found" error |
| Non-zero exit code | Linter/test failures | Read the `check_*.log` file for specific errors |
| Timeout | Command exceeded configured timeout | Log shows SIGTERM; check `timeout` in check YAML |
| Output truncation | Command output exceeded 10MB buffer | Log may be cut off; increase timeout or reduce output |

### Reading Check Logs
- File pattern: `<log_dir>/check_<CHECK_NAME>.log`
- Contains raw stdout/stderr from the check command
- Format depends on the tool (linter output, test runner output, etc.)

### Rerun Commands
Check gates can define a `rerun_command` for verification runs. If set, the rerun uses this command instead of the original `command`.

## Review Gate Failures

Review gates use AI CLI tools to review code changes.

### Common Failure Modes

| Failure | Cause | Evidence |
|---------|-------|----------|
| No healthy adapters | All configured CLI tools are missing, unhealthy, or in cooldown | Run `bun src/index.ts health` |
| JSON parsing error | Adapter returned non-JSON output | Review log shows raw output instead of violations |
| Violations outside diff scope | Reviewer flagged code not in the current diff | Check violation `file` and `line` against changed files |
| Usage limit | API quota exceeded for the adapter | Look for "usage limit" in review log; adapter enters 1-hour cooldown |

### Reading Review JSON
- File pattern: `<log_dir>/review_<REVIEW_NAME>_<ADAPTER>@<INDEX>.json`
- Fields per violation:
  - `file`: Source file path
  - `line`: Line number
  - `issue`: Description of the problem
  - `fix`: Suggested fix
  - `priority`: `critical`, `high`, `medium`, or `low`
  - `status`: `new`, `fixed`, `skipped`
- Status `skipped_prior_pass` means this review slot passed on a previous run and was skipped for efficiency

### Diff Calculation
- **Local mode**: committed changes (base...HEAD) + uncommitted changes (HEAD) + untracked files
- **CI mode**: `git diff GITHUB_BASE_REF...GITHUB_SHA` (falls back to HEAD^...HEAD)
- **Rerun mode**: scoped to changes since last pass using `working_tree_ref` from `.execution_state`

## `no_applicable_gates`

All configured gates were skipped because no changed files matched any entry point path.

**Diagnosis:**
1. Run `bun src/index.ts detect` to see which files changed and which gates match
2. Check `entry_points` in `config.yml` — do the paths cover your changed files?
3. Verify `base_branch` — if wrong, the diff may not include your changes

## `no_changes`

No files changed relative to `base_branch`.

**Diagnosis:**
1. Check `base_branch` in `config.yml` (default: `origin/main`)
2. Run `git diff origin/main...HEAD --stat` to verify
3. If working on uncommitted changes, they are included in local mode but may not be in CI mode
4. Check if a recent `bun src/index.ts clean` reset the execution state

## Parallel vs Sequential Execution

### Check Gates
- Each check gate has a `parallel` setting (default: `false`)
- Parallel checks run concurrently; sequential checks run one at a time
- `allow_parallel` in `config.yml` (default: `true`) is the global switch

### `fail_fast` Behavior
- Only applies to sequential check gates (`parallel: false`)
- When enabled, stops running remaining sequential gates after the first failure
- Cannot be combined with `parallel: true` (schema validation rejects this)

### Review Gates
- Each review gate independently controls parallelism for its own adapter dispatch
- When `parallel: true` (default) and `num_reviews > 1`, reviews run concurrently across adapters
- When `parallel: false`, reviews run sequentially

## Rerun / Verification Mode

When the gauntlet detects existing logs in `<log_dir>/`, it enters **rerun mode** instead of a fresh run.

### How It Works
1. Previous violations are loaded from existing `review_*.json` files
2. Only violations at the configured threshold priority or higher are re-evaluated
3. Check gates re-run their commands (or `rerun_command` if configured)
4. Review gates scope their diff to changes since the last pass using `working_tree_ref` from `.execution_state`

### `rerun_new_issue_threshold`
- Config field: `rerun_new_issue_threshold` (default: `medium`)
- Controls which priority levels are re-evaluated: `critical` > `high` > `medium` > `low`
- Violations below the threshold are ignored in reruns

### Passed Slot Optimization
When `num_reviews > 1` in rerun mode:
- If all review slots passed previously: only slot 1 re-runs (safety latch)
- If some slots failed: only failed slots re-run; passed slots get `skipped_prior_pass`

### Why Violations Aren't Detected on Rerun
- The diff is scoped to changes since the last pass — if the violation is in unchanged code, it won't appear
- The threshold may filter out lower-priority violations
- Passed slots may be skipped entirely

## How to Read Gate Logs

### Console Logs
- Pattern: `<log_dir>/console.*.log` (highest number = latest run)
- Contains unified output from all gates for that run iteration
- Shows gate names, pass/fail status, and output file paths

### Debug Log
- File: `<log_dir>/.debug.log`
- Timestamped entries for every significant event
- Search for `gate`, `check`, `review`, or specific gate names

### Gate Result Status Values
- Check gates: `pass`, `fail`, `error`
- Review gates: `pass`, `fail`, `error`, `skipped_prior_pass`
