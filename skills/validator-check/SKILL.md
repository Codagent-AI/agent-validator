---
name: validator-check
description: >-
  Runs validator checks only without AI reviews. Use when asked to "run validator checks", "check without reviews", or "validate before commit without AI review".
disable-model-invocation: true
allowed-tools: Bash, Task
---

# /validator-check
Run validator checks only — no AI reviews.


## Procedure

### Step 1 - Clean Logs

Run `agent-validator clean` to archive any previous log files.

### Step 2 - Run Checks

Run `agent-validator check` using `Bash` with `timeout: 300000`. **ALWAYS wait for and read the full command output** before proceeding. **Verify you can see a `Status:` line in the output before continuing.**

### Step 3 - Check Status

**NEVER assume success** — you must see an explicit `Status:` line before continuing. Check it and route accordingly:
- `Status: Passed` → Go to Step 7.
- `Status: Passed with warnings` → Go to Step 7.
- `Status: Failed` → Continue to Step 4. **You MUST continue — do not stop here.**
- `Status: Retry limit exceeded` → Run `agent-validator clean` to archive logs. Go to Step 7.
- No status line visible → **Known issue:** Bun can drop all stdout/stderr. Read the console log file to get the status: find the latest `console.*.log` in the validator log directory (e.g., `validator_logs/console.1.log`) and look for the `Status:` line there. If no console log is found there, also check `validator_logs/previous/` for logs from the most recent archived run. If no console log exists in either location, the command may have timed out or failed to run — re-run with a longer timeout or investigate the error. Do NOT proceed as if it passed.

### Step 4 - Extract Failures

Required when status is Failed:
- Infer the log directory from the file paths in the console output (e.g., if output references `validator_logs/check_._lint.1.log`, the log directory is `validator_logs/`)
- Read `extract-prompt.md` from this skill's directory
- **Extract log failures** using the first available strategy:
  a. **Task tool** (Claude Code): `Task` with `subagent_type="general-purpose"`, `model="haiku"`, `prompt=` extract-prompt content + `"\n\nLog directory: <inferred path>"`. **Task calls MUST be synchronous** — NEVER use `run_in_background: true`.
  b. **Subagent delegation**: If your environment supports delegating work to a subagent but not the Task tool, delegate the extract-prompt instructions with the log directory to a subagent for processing.
  c. **Inline fallback**: If no subagent capability is available, follow the extract-prompt instructions yourself to read the log files and produce the compact failure summary.

### Step 5 - Fix

Execute the fixes for all failed checks:
- CHECK failures with Fix Skill: invoke the named skill
- CHECK failures with Fix Instructions: follow the instructions

### Step 6 - Re-run Verification

**NEVER skip this step** — if the run failed, you MUST fix and re-run. Run `agent-validator check` again with `Bash` and `timeout: 300000`. Do NOT run `agent-validator clean` between retries. The tool detects existing logs and automatically switches to verification mode. **Go back to Step 3** to check the status line and repeat.

### Step 7 - Summarize Session

Provide a summary of the session:
- Final Status: (Passed / Passed with warnings / Retry limit exceeded)
- Checks Fixed: (list key fixes)
- Outstanding Failures: (if retry limit exceeded, list unverified fixes and remaining issues)
