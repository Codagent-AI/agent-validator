---
name: check
description: Run checks only (no reviews)
disable-model-invocation: true
allowed-tools: Bash
---

# /gauntlet:check
Run the gauntlet checks only — no AI reviews.

1. Run `bun src/index.ts clean` to archive any previous log files
2. Run `bun src/index.ts check`
3. If any checks fail:
   - Read the `.log` file path provided in the output for each failed check.
   - Fix the issues found.
4. Run `bun src/index.ts check` again to verify your fixes. Do NOT run `bun src/index.ts clean` between retries.
5. Repeat steps 3-4 until all checks pass or you've made 3 attempts.
6. Provide a summary of the session:
   - Checks Passed: (list)
   - Checks Failed: (list with brief reason)
   - Fixes Applied: (list key fixes)
