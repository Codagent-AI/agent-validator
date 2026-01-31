---
description: Fix CI failures or address review comments on a pull request
allowed-tools: Bash
---

# /fix-pr
Fix CI failures or address review comments on the current pull request.

1. Check CI status and review comments: `gh pr checks` and `gh pr view --comments`
2. Fix any failing checks or address reviewer feedback
3. Commit and push your changes
4. After pushing, verify the PR is updated: `gh pr view`
