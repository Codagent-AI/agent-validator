# CI/PR Troubleshooting

## `pr_push_required`

Gates passed but the stop hook detected that a PR needs to be created or updated.

**When this happens:**
- `auto_push_pr: true` is set in `stop_hook` config
- Gates have passed
- No PR exists for the current branch, or the PR is out of date

**Resolution:**
1. Commit and push your changes
2. Create a PR: `gh pr create` or use `/gauntlet-push-pr`
3. The next stop-hook invocation will check PR/CI status instead of re-running gates

## CI Status Values

| Status | Message | Blocking? |
|--------|---------|-----------|
| `ci_pending` | CI checks still running | Yes — agent waits |
| `ci_failed` | CI failed or review changes requested | Yes — must fix |
| `ci_passed` | All checks completed, no blocking reviews | No — stop allowed |
| `ci_timeout` | Max wait attempts reached | No — stop allowed for manual review |

## `auto_push_pr` and `auto_fix_pr` Configuration

```yaml
stop_hook:
  auto_push_pr: true    # Check PR status after gates pass
  auto_fix_pr: true     # Wait for CI and enable fix workflow
```

**Dependency:** `auto_fix_pr` requires `auto_push_pr`. If `auto_fix_pr: true` but `auto_push_pr: false`, `auto_fix_pr` is forced to `false` with a warning.

**Environment variable overrides:**
- `GAUNTLET_AUTO_PUSH_PR=true/false`
- `GAUNTLET_AUTO_FIX_PR=true/false`

## CI Wait Mechanism (`wait-ci`)

### How It Works
1. After gates pass and PR is pushed, the stop hook enters CI wait mode
2. It polls GitHub CI status using `gh pr checks`
3. Polls every **15 seconds** (default)
4. Times out after **270 seconds** (4.5 minutes, default)
5. Up to **3 attempts** total across stop-hook invocations

### Attempt Tracking
- File: `<log_dir>/.ci-wait-attempts`
- Incremented on each CI wait invocation
- When attempts >= 3: returns `ci_timeout` and allows the stop

### What `wait-ci` Checks

**CI Checks:**
- Runs `gh pr checks --json name,state,link`
- Check states: `PENDING`, `QUEUED`, `IN_PROGRESS`, `SUCCESS`, `FAILURE`
- All checks must reach `SUCCESS` for `ci_passed`

**Blocking Reviews:**
- Queries `gh api repos/OWNER/REPO/pulls/PR_NUM/reviews`
- `CHANGES_REQUESTED` state is blocking
- Latest review per author takes precedence (later reviews override earlier)
- If any author's latest review is `CHANGES_REQUESTED`: `ci_failed`

### Failed Check Logs
- For GitHub Actions: retrieves error output via `gh run view RUN_ID --log-failed`
- For external checks (no run ID): no logs available
- Output limited to last 100 lines

## CI Detection Environment Variables

The gauntlet detects CI environments using:

| Variable | Detection |
|----------|-----------|
| `CI=true` | Generic CI environment |
| `GITHUB_ACTIONS=true` | GitHub Actions specifically |
| `GITHUB_BASE_REF` | PR base branch in GitHub Actions (overrides `base_branch` for diff) |
| `GITHUB_SHA` | Commit SHA in GitHub Actions (used for diff calculation) |

**CI mode differences:**
- Diff uses `GITHUB_BASE_REF...GITHUB_SHA` instead of local branch comparison
- Falls back to `HEAD^...HEAD` if CI variables are incomplete

## Troubleshooting Checklist

### `ci_pending` — CI Still Running
1. Check `gh pr checks` to see which checks are still pending
2. Wait and try again — the stop hook will re-poll on next attempt
3. After 3 attempts, it will timeout and allow the stop

### `ci_failed` — CI Failed
1. Run `gh pr checks` to see failed checks
2. Run `gh pr view --comments` to see review feedback
3. Check for `CHANGES_REQUESTED` reviews: `gh api repos/OWNER/REPO/pulls/PR_NUM/reviews`
4. Fix the issues, commit, and push
5. The stop hook will re-check on next invocation

### `ci_timeout` — Wait Exhausted
- The CI wait hit 3 attempts without all checks passing
- The stop is allowed for manual review
- Check `<log_dir>/.ci-wait-attempts` for the attempt count
- After fixing issues and pushing, run `agent-gauntlet clean` to reset the attempt counter

### PR-Related Issues
- **No PR for branch**: `gh pr view` returns an error — create a PR first
- **PR out of date**: Push latest changes before CI can pass
- **`gh` CLI not installed**: CI features require the GitHub CLI (`gh`)
