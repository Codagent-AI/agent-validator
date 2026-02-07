---
name: check
description: Run checks only (no reviews)
disable-model-invocation: true
allowed-tools: Bash
---

# /gauntlet:check
Run the gauntlet checks only — no AI reviews.

1. Run `bun src/index.ts check`
2. If any checks fail:
   - Read the `.log` file path provided in the output for each failed check.
   - Fix the issues found.
3. Run `bun src/index.ts check` again to verify your fixes.
4. Repeat steps 2-3 until all checks pass or you've made 3 attempts.
5. Provide a summary of the session:
   - Checks Passed: (list)
   - Checks Failed: (list with brief reason)
   - Fixes Applied: (list key fixes)
