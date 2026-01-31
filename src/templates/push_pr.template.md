---
description: Commit changes, push to remote, and create or update a pull request
allowed-tools: Bash
---

# /push-pr
Push changes and create or update a pull request.

**Step 1: Look for project-level instructions**
Check for any of these (use the first one found):
- A `/push-pr` skill or command (check `~/.claude/skills/` or similar)
- A `/commit` command
- `CONTRIBUTING.md` section on PR creation

If found, follow those instructions instead of the fallback below.

**Step 2: Fallback (if no project instructions found)**
1. Stage your changes: `git add <changed files>`
2. Commit with a descriptive message summarizing the work done
3. Push to remote: `git push -u origin HEAD`
4. Create a PR: `gh pr create --fill` (or if a PR already exists, the push is sufficient)

**Step 3: Verify**
Confirm the PR was created or updated successfully by running `gh pr view`.
