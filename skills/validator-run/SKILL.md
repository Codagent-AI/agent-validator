---
name: validator-run
description: >-
  Runs the full validator workflow after coding tasks for requests such as "run the validator", "run final verification", "validate before commit", or "run the gauntlet". Executes checks and reviews before commit, push, or PR creation.
disable-model-invocation: false
allowed-tools: Bash, Task
---
# /validator-run
Execute the autonomous verification suite.

Fix issues you reasonably agree with or believe the human wants to be fixed. Skip issues that are purely stylistic, subjective, or that you believe the human would not want changed. When you skip an issue, briefly state what was skipped and why.


## Procedure

### Step 1 - Run Agent Validator

If the caller requests a specific review to be enabled, append `--enable-review <name>` to the run command for each requested review.

Run `agent-validate run` using `Bash` with `timeout: 300000`. **ALWAYS wait for and read the full command output** before proceeding — the command typically takes 1-2 minutes. **Verify you can see a `Status:` line in the output before continuing.**

### Step 2 - Check Status

**NEVER assume success** — you must see an explicit `Status:` line before continuing. Check it and route accordingly:
- `Status: Passed` → Go to Step 8.
- `Status: Passed with warnings` → Go to Step 8.
- `Status: Failed` → Continue to Step 3. **You MUST continue — do not stop here.**
- `Status: Retry limit exceeded` → Go to Step 8.
- No status line visible → **Known issue:** Bun can drop all stdout/stderr when LLM review subprocesses run. Read the console log file to get the status: find the latest `console.*.log` in the validator log directory (e.g., `validator_logs/console.1.log`) and look for the `Status:` line there. If no console log is found there, also check `validator_logs/previous/` for logs from the most recent archived run. If no console log exists in either location, the command may have timed out or failed to run — re-run with a longer timeout or investigate the error. Do NOT proceed as if it passed.

### Step 3 - Extract Failures

Required when status is Failed:
- Infer the log directory from the file paths in the console output (e.g., if output references `validator_logs/check_._lint.1.log`, the log directory is `validator_logs/`)
- Read `extract-prompt.md` from this skill's directory
- **Extract log failures** using the first available strategy:
  a. **Task tool** (Claude Code): `Task` with `subagent_type="general-purpose"`, `model="haiku"`, `prompt=` extract-prompt content + `"\n\nLog directory: <inferred path>"`. **Task calls MUST be synchronous** — NEVER use `run_in_background: true`.
  b. **Subagent delegation**: If your environment supports delegating work to a subagent but not the Task tool, delegate the extract-prompt instructions with the log directory to a subagent for processing.
  c. **Inline fallback**: If no subagent capability is available, follow the extract-prompt instructions yourself to read the log files and produce the compact failure summary.

### Step 4 - Report Failures

Print the compact failure summary returned from Step 3.

### Step 5 - Fix

Apply the review guidance above to each failure and fix accordingly:
- CHECK failures with Fix Skill: invoke the named skill
- CHECK failures with Fix Instructions: follow the instructions
- REVIEW violations: fix or skip per the review guidance above

### Step 6 - Update Review Decisions

For REVIEW violations you addressed:
- Read `update-prompt.md` from this skill's directory
- **Update review decisions** using the first available strategy (same as Step 3):
  a. **Task tool** (Claude Code): `Task` with `subagent_type="general-purpose"`, `model="haiku"`, `prompt=` update-prompt content + log directory + decisions list. **Task calls MUST be synchronous** — NEVER use `run_in_background: true`.
  b. **Subagent delegation**: Delegate the update-prompt instructions with the log directory and decisions to a subagent.
  c. **Inline fallback**: Follow the update-prompt instructions yourself to update the review JSON files.

### Step 7 - Re-run Verification

**NEVER skip this step** — if the run failed, you MUST fix and re-run. Run the same command from Step 1 (including any `--enable-review` flags) again with `Bash` and `timeout: 300000`. The tool detects existing logs and automatically switches to verification mode. **Go back to Step 2** to check the status line and repeat.

### Step 8 - Summarize Session

Provide a summary of the session:
- Final Status: (Passed / Passed with warnings / Retry limit exceeded)
- Issues Fixed: (list key fixes)
- Issues Skipped: (list skipped items and reasons)
- Outstanding Failures: (if retry limit exceeded, list unverified fixes and remaining issues)
