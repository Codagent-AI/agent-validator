---
name: gauntlet-fix-pr
description: Fix CI failures or address review comments on a pull request
disable-model-invocation: true
allowed-tools: Bash
---

# /gauntlet-fix-pr
Fix CI failures or address review comments on the current pull request.

1. Check CI status: `gh pr checks`
2. If checks are still pending, wait 30 seconds and re-check. Repeat until all checks complete or 5 minutes have elapsed.
3. Once checks have completed, identify any failures: `gh pr checks` and `gh run view <run-id> --log-failed`
4. Check for review comments: `gh pr view --comments`
5. Fix any failing checks or address reviewer feedback
6. Commit and push your changes
7. After pushing, verify the PR is updated: `gh pr view`
