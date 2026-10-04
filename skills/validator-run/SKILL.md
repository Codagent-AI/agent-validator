---
name: validator-run
description: >-
  Activates only for explicit full-validator requests such as "run the validator", "run the gauntlet", "run validation", or validation before commit, push, or PR creation. Includes checks and reviews, and excludes checks-only requests.
disable-model-invocation: false
allowed-tools: Bash
---
# /validator-run
Execute the autonomous verification suite.

## Invocation Policy

Use this skill only for explicit validation requests, such as "run the validator", "run the gauntlet", "run validation", "validate this", or "validate before commit/push/PR".

Do not choose this skill merely because a coding task was completed, because the user asked for a generic review, or because the user asked for checks only.

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
- Run `agent-validate update-review list` with `Bash` for REVIEW violations. It prints each pending violation's ID, priority, gate, `file:line`, issue, and suggested fix. Keep those IDs for Step 6.
- For each failed CHECK, use only what the run reports in its console `[FAIL]` output or its `--report` CHECK FAILURES section: the check's command, Fix Instructions or Fix Skill, and log path. To see the error output, read that one named log file or re-run the reported command. Follow the reported working directory when re-running a command.
- Do not list or scan the log directory. Do not read review JSON files.

### Step 4 - Report Failures

Print the check failures and the `update-review list` output from Step 3, including each review violation's ID.

### Step 5 - Fix

Fix issues reasonably supported by the feedback or likely intended by the human. When skipping an issue, briefly state what was skipped and why.

**Valid reasons to skip:**
- Purely stylistic or subjective preference
- The human would not want it changed

**You MUST NOT skip for these reasons:**
- "Issue is pre-existing" — you MUST fix it unless you have another valid reason
- "Issue is out of scope" — you MUST address valid feedback even if it requires refactoring or non-trivial changes

Apply this guidance to each failure and fix accordingly:
- CHECK failures with Fix Skill: invoke the named skill
- CHECK failures with Fix Instructions: follow the instructions
- REVIEW violations: fix or skip per the guidance above

### Step 6 - Update Review Decisions

Use the IDs from Step 3 for each REVIEW violation you addressed. Run `agent-validate update-review list` again only if you need to refresh the IDs. Record each decision with `agent-validate update-review fix <id> "<what changed>"` or `agent-validate update-review skip <id> "<why>"`.

IDs remain stable until the next validator run. Record all decisions before Step 7.

**Do NOT edit files under `validator_logs/` or the configured log directory directly.** Use `update-review` for review decisions.

### Step 7 - Re-run Verification

**NEVER skip this step** — if the run failed, you MUST fix and re-run. Run the same command from Step 1 (including any `--enable-review` flags) again with `Bash` and `timeout: 300000`. The tool detects existing logs and automatically switches to verification mode. **Go back to Step 2** to check the status line and repeat.

### Step 8 - Summarize Session

Provide a summary of the session:
- Final Status: (Passed / Passed with warnings / Retry limit exceeded)
- Issues Fixed: (list key fixes)
- Issues Skipped: (list skipped items and reasons)
- Outstanding Failures: (if retry limit exceeded, list unverified fixes and remaining issues)
