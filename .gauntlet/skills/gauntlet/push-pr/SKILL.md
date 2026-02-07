---
name: push-pr
description: Commit changes, push to remote, and create or update a pull request
disable-model-invocation: true
allowed-tools: Bash
---

# /gauntlet:push-pr
Commit all changes, push to remote, and create or update a pull request for the current branch.

After the PR is created or updated, verify it exists by running `gh pr view`.
