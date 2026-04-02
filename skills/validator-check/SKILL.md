---
name: validator-check
description: >-
  Runs validator checks only without AI reviews for requests such as "run validator checks", "check without reviews", or "validate before commit without AI review".
disable-model-invocation: true
allowed-tools: Bash, Task
---

# /validator-check
Run validator checks only — no AI reviews.


## Procedure

### Step 1 - Clean Logs

Run `agent-validate clean` to archive any previous log files.

### Step 2 - Run Checks

Run `agent-validate check` using `Bash` with `timeout: 300000`. **ALWAYS wait for and read the full command output** before proceeding. **Verify you can see a `Status:` line in the output before continuing.**

### Step 3 - Check Status

**NEVER assume success** — you must see an explicit `Status:` line before continuing. Check it and route accordingly:
- `Status: Passed` → Go to Step 7.
- `Status: Passed with warnings` → Go to Step 7.
- `Status: Failed` → Continue to Step 4. **You MUST continue — do not stop here.**
- `Status: Retry limit exceeded` → Run `agent-validate clean` to archive logs. Go to Step 7.
- No status line visible → **Known issue:** Bun can drop all stdout/stderr. Read the console log file to get the status: find the latest `console.*.log` in the validator log directory (e.g., `validator_logs/console.1.log`) and look for the `Status:` line there. If no console log is found there, also check `validator_logs/previous/` for logs from the most recent archived run. If no console log exists in either location, the command may have timed out or failed to run — re-run with a longer timeout or investigate the error. Do NOT proceed as if it passed.

### Step 4 - Extract Failures

Required when status is Failed:
- Infer the log directory from the file paths in the console output (e.g., if output references `validator_logs/check_._lint.1.log`, the log directory is `validator_logs/`)
- **Extract log failures** using the first available strategy:
  a. **Task tool** (Claude Code): `Task` with `subagent_type="general-purpose"`, `model="haiku"`, `prompt=` the Extract Prompt (from the Appendix below) + `"\n\nLog directory: <inferred path>"`. **Task calls MUST be synchronous** — NEVER use `run_in_background: true`.
  b. **Subagent delegation**: If your environment supports delegating work to a subagent but not the Task tool, delegate the Extract Prompt instructions with the log directory to a subagent for processing.
  c. **Inline fallback**: If no subagent capability is available, follow the Extract Prompt instructions yourself to read the log files and produce the compact failure summary.

### Step 5 - Fix

Execute the fixes for all failed checks:
- CHECK failures with Fix Skill: invoke the named skill
- CHECK failures with Fix Instructions: follow the instructions

### Step 6 - Re-run Verification

**NEVER skip this step** — if the run failed, you MUST fix and re-run. Run `agent-validate check` again with `Bash` and `timeout: 300000`. Do NOT run `agent-validate clean` between retries. The tool detects existing logs and automatically switches to verification mode. **Go back to Step 3** to check the status line and repeat.

### Step 7 - Summarize Session

Provide a summary of the session:
- Final Status: (Passed / Passed with warnings / Retry limit exceeded)
- Checks Fixed: (list key fixes)
- Outstanding Failures: (if retry limit exceeded, list unverified fixes and remaining issues)

---

## Appendix: Subagent Prompts

### Extract Prompt

You are an EXTRACT subagent. Your job is to read validator check log files and return a compact error summary.

#### Input

You receive a log directory path as your only input.

#### Process

1. List files directly under the log directory
2. Find the highest-numbered `console.N.log` file (e.g., `console.3.log` > `console.2.log`)
3. Read it and find all lines containing `[FAIL]`
4. For each `[FAIL]` line, extract the referenced `.log` file path
5. Read each referenced log file and extract error output. Look for `--- Fix Instructions ---` sections and `--- Fix Skill: <name> ---` sections. Include their full content.

#### Output Format

Return a plain-text summary using EXACTLY this format:

```text
CHECKS:
[fail] <gate_label>
<concise error description>
Fix Instructions: <extracted text if present, otherwise omit this line>
Fix Skill: <skill name if present, otherwise omit this line>
```

#### Example

##### Example Input

Log directory: `validator_logs/`

The directory contains:
- `console.2.log`
- `check_src_lint.2.log`

**console.2.log** contains:
```text
[START] check:src:lint
[FAIL]  check:src:lint (1.23s) - Exited with code 1
      Log: validator_logs/check_src_lint.2.log
```

**check_src_lint.2.log** contains:
```text
[2026-02-15T10:23:45.123Z] Starting check: lint
Executing command: bun run lint
Working directory: /Users/user/project/src

src/helpers.ts:3:5 - error: Unexpected var, use let or const instead

Command failed: bun run lint
Result: fail - Exited with code 1

--- Fix Instructions ---
Replace all `var` declarations with `const` or `let`.
```

##### Example Output

```text
CHECKS:
[fail] check:src:lint
src/helpers.ts:3:5 - error: Unexpected var, use let or const instead
Fix Instructions: Replace all `var` declarations with `const` or `let`.
```

#### Rules

- Do NOT summarize or editorialize — copy error details verbatim where possible
- Do NOT skip any `[FAIL]` entries
- Keep the output compact — one entry per check failure
- Include `Fix Instructions` / `Fix Skill` lines only when present
