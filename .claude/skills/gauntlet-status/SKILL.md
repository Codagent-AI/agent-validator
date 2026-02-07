---
name: gauntlet-status
description: Show a summary of the most recent gauntlet session
disable-model-invocation: true
allowed-tools: Bash, Read
---

# /gauntlet-status
Show a detailed summary of the most recent gauntlet session.

## Step 1: Run the status script

```bash
bun src/scripts/status.ts 2>&1
```

The script parses the `.debug.log` for session-level data (run count, gate results, pass/fail status) and lists all log files with their paths and sizes.

## Step 2: Read failed gate details

For each gate marked **FAIL** in the Gate Results table, read the corresponding log files to extract failure details:

- **Check failures** (e.g., `check:src:code-health`): Read the matching `check_*.log` file. Check log formats vary by tool (linters, test runners, code health analyzers) — read the file and extract the relevant error/warning output.
- **Review failures** (e.g., `review:.:code-quality`): Read the matching `review_*.json` file(s). These contain structured violation data with `file`, `line`, `issue`, `priority`, and `status` fields.

Use the file paths from the "Log Files" section of the script output. Match gate IDs to file names: `check:.:lint` corresponds to `check_._lint.*.log`, `review:.:code-quality` corresponds to `review_._code-quality_*.{log,json}`.

## Step 3: Present the results

Combine the script's session summary with the detailed failure information into a comprehensive report:

1. Session overview (status, iterations, duration, fixed/skipped/failed counts)
2. Gate results table
3. For any failed gates: the specific errors, violations, or test failures from the log files
4. For reviews with violations: list each violation with file, line, issue, priority, and current status (fixed/skipped/outstanding)
