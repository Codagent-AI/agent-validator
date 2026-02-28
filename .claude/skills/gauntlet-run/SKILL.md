---
name: gauntlet-run
description: >-
  Run the full verification gauntlet. Use this as the final step after completing a coding task — verifies quality, runs checks, and ensures all gates pass. Must be run before committing, pushing, or creating PRs.
disable-model-invocation: false
allowed-tools: Bash, Task
---
<!--
  REVIEW TRUST LEVEL
  Controls how aggressively the agent acts on AI reviewer feedback.
  Change the trust_level value below to one of: high, medium, low

  - high:   Fix all issues unless you strongly disagree or have low confidence the human wants the change.
  - medium: Fix issues you reasonably agree with or believe the human wants fixed. (DEFAULT)
  - low:    Fix only issues you strongly agree with or are confident the human wants fixed.
-->
<!-- trust_level: medium -->

# /gauntlet-run
Execute the autonomous verification suite.

**Review trust level: medium** — Fix issues you reasonably agree with or believe the human wants to be fixed. Skip issues that are purely stylistic, subjective, or that you believe the human would not want changed. When you skip an issue, briefly state what was skipped and why.


## Procedure

### Step 1 - Clean Logs

Run `bun src/index.ts clean` to archive any previous log files.

### Step 2 - Run Gauntlet

Run `bun src/index.ts run` using `Bash` with `timeout: 300000`. **ALWAYS wait for and read the full command output** before proceeding — the command typically takes 1-2 minutes. **Verify you can see a `Status:` line in the output before continuing.**

### Step 3 - Check Status

**NEVER assume success** — you must see an explicit `Status:` line before continuing. Check it and route accordingly:
- `Status: Passed` → Go to Step 9.
- `Status: Passed with warnings` → Go to Step 9.
- `Status: Failed` → Continue to Step 4. **You MUST continue — do not stop here.**
- `Status: Retry limit exceeded` → Run `bun src/index.ts clean` to archive logs. Go to Step 9.
- No status line visible → **Known issue:** Bun can drop all stdout/stderr when LLM review subprocesses run. Read the console log file to get the status: find the latest `console.*.log` in the gauntlet log directory (e.g., `gauntlet_logs/console.1.log`) and look for the `Status:` line there. If no console log is found there, also check `gauntlet_logs/previous/` for logs from the most recent archived run. If no console log exists in either location, the command may have timed out or failed to run — re-run with a longer timeout or investigate the error. Do NOT proceed as if it passed.

### Step 4 - Extract Failures

Required when status is Failed:
- Infer the log directory from the file paths in the console output (e.g., if output references `gauntlet_logs/check_._lint.1.log`, the log directory is `gauntlet_logs/`)
- Read `extract-prompt.md` from this skill's directory
- **Extract log failures** using the first available strategy:
  a. **Task tool** (Claude Code): `Task` with `subagent_type="general-purpose"`, `model="haiku"`, `prompt=` extract-prompt content + `"\n\nLog directory: <inferred path>"`. **Task calls MUST be synchronous** — NEVER use `run_in_background: true`.
  b. **Subagent delegation**: If your environment supports delegating work to a subagent but not the Task tool, delegate the extract-prompt instructions with the log directory to a subagent for processing.
  c. **Inline fallback**: If no subagent capability is available, follow the extract-prompt instructions yourself to read the log files and produce the compact failure summary.

### Step 5 - Report Failures

Print the compact failure summary returned from Step 4.

### Step 6 - Fix and Capture

**a. Fix phase** — Apply the trust level above to each failure and fix accordingly:
- CHECK failures with Fix Skill: invoke the named skill
- CHECK failures with Fix Instructions: follow the instructions
- REVIEW violations: apply the fix

**b. Capture noteworthy violations for eval inventory** (if any REVIEW violations were found):
- Collect the JSON file paths from the `Review:` lines in the console log (e.g., `gauntlet_logs/review_._code-quality_codex@1.1.json`)
- Read `SKILL.md` from the `capture-eval-issues` skill directory (sibling of this skill's directory)
- Follow the capture skill's procedure, passing the JSON file paths
- Note the `CAPTURED:` summary line for inclusion in Step 9

### Step 7 - Update Review Decisions

For REVIEW violations you addressed:
- Read `update-prompt.md` from this skill's directory
- **Update review decisions** using the first available strategy (same as Step 4):
  a. **Task tool** (Claude Code): `Task` with `subagent_type="general-purpose"`, `model="haiku"`, `prompt=` update-prompt content + log directory + decisions list. **Task calls MUST be synchronous** — NEVER use `run_in_background: true`.
  b. **Subagent delegation**: Delegate the update-prompt instructions with the log directory and decisions to a subagent.
  c. **Inline fallback**: Follow the update-prompt instructions yourself to update the review JSON files.

### Step 8 - Re-run Verification

**NEVER skip this step** — if the run failed, you MUST fix and re-run. Run `bun src/index.ts run` again with `Bash` and `timeout: 300000`. Do NOT run `bun src/index.ts clean` between retries. The tool detects existing logs and automatically switches to verification mode. **Go back to Step 3** to check the status line and repeat.

### Step 9 - Summarize Session

Provide a summary of the session:
- Final Status: (Passed / Passed with warnings / Retry limit exceeded)
- Issues Fixed: (list key fixes)
- Issues Skipped: (list skipped items and reasons)
- Eval Captures: (list captured issue IDs from Step 6b, or "none")
- Outstanding Failures: (if retry limit exceeded, list unverified fixes and remaining issues)
