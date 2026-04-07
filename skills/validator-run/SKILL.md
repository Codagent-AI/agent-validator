---
name: validator-run
description: >-
  Runs the full validator workflow after coding tasks for requests such as "run the validator", "run final verification", "validate before commit", or "run validation". Executes checks and reviews before commit, push, or PR creation.
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
- **Extract log failures** using the first available strategy:
  a. **Task tool** (Claude Code): `Task` with `subagent_type="general-purpose"`, `model="haiku"`, `prompt=` the Extract Prompt (from the Appendix below) + `"\n\nLog directory: <inferred path>"`. **Task calls MUST be synchronous** — NEVER use `run_in_background: true`.
  b. **Subagent delegation**: If your environment supports delegating work to a subagent but not the Task tool, delegate the Extract Prompt instructions with the log directory to a subagent for processing.
  c. **Inline fallback**: If no subagent capability is available, follow the Extract Prompt instructions yourself to read the log files and produce the compact failure summary.

### Step 4 - Report Failures

Print the compact failure summary returned from Step 3.

### Step 5 - Fix

Apply the review guidance above to each failure and fix accordingly:
- CHECK failures with Fix Skill: invoke the named skill
- CHECK failures with Fix Instructions: follow the instructions
- REVIEW violations: fix or skip per the review guidance above

### Step 6 - Update Review Decisions

For REVIEW violations you addressed:
- **Update review decisions** using the first available strategy (same as Step 3):
  a. **Task tool** (Claude Code): `Task` with `subagent_type="general-purpose"`, `model="haiku"`, `prompt=` the Update Prompt (from the Appendix below) + log directory + decisions list. **Task calls MUST be synchronous** — NEVER use `run_in_background: true`.
  b. **Subagent delegation**: Delegate the Update Prompt instructions with the log directory and decisions to a subagent.
  c. **Inline fallback**: Follow the Update Prompt instructions yourself to update the review JSON files.

### Step 7 - Re-run Verification

**NEVER skip this step** — if the run failed, you MUST fix and re-run. Run the same command from Step 1 (including any `--enable-review` flags) again with `Bash` and `timeout: 300000`. The tool detects existing logs and automatically switches to verification mode. **Go back to Step 2** to check the status line and repeat.

### Step 8 - Summarize Session

Provide a summary of the session:
- Final Status: (Passed / Passed with warnings / Retry limit exceeded)
- Issues Fixed: (list key fixes)
- Issues Skipped: (list skipped items and reasons)
- Outstanding Failures: (if retry limit exceeded, list unverified fixes and remaining issues)

---

## Appendix: Subagent Prompts

### Extract Prompt

You are an EXTRACT subagent. Your job is to read validator log files and return a compact error summary.

#### Input

You receive a log directory path as your only input.

#### Process

1. List files directly under the log directory
2. Find the highest-numbered `console.N.log` file (e.g., `console.3.log` > `console.2.log`)
3. Read it and find all lines containing `[FAIL]`
4. For each `[FAIL]` line, extract the referenced file path
5. Read each referenced file:
   - **`.log` files** (check gates): Extract error output. Look for `--- Fix Instructions ---` sections and `--- Fix Skill: <name> ---` sections. Include their full content.
   - **`.json` files** (review gates): Parse the JSON. Find violations where `status` is `"new"`. For each, extract: `file`, `line`, `issue`, `priority`, `fix`.

#### Output Format

Return a plain-text summary using EXACTLY this format:

For check failures:
```text
CHECKS:
[fail] <gate_label>
<concise error description>
Fix Instructions: <extracted text if present, otherwise omit this line>
Fix Skill: <skill name if present, otherwise omit this line>
```

For review failures:
```text
REVIEWS:
[<priority>] <gate_label>
<file>:<line> - <issue summary>
Fix: <fix suggestion>
```

If there are no failures of a type, omit that section entirely.

#### Example

##### Example Input

Log directory: `validator_logs/`

The directory contains:
- `console.2.log`
- `check_src_lint.2.log`
- `review_src_code-quality_claude@1.2.json`

**console.2.log** contains:
```text
[START] check:src:lint
[FAIL]  check:src:lint (1.23s) - Exited with code 1
      Log: validator_logs/check_src_lint.2.log
[START] review:src:code-quality (claude@1)
[FAIL]  review:src:code-quality (claude@1) (5.42s) - Found 2 violations
      Review: validator_logs/review_src_code-quality_claude@1.2.json
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

**review_src_code-quality_claude@1.2.json** contains:
```json
{
  "adapter": "claude",
  "status": "fail",
  "violations": [
    {
      "file": "src/main.ts",
      "line": 45,
      "issue": "Missing error handling for async database call",
      "fix": "Wrap in try-catch block",
      "priority": "high",
      "status": "new"
    },
    {
      "file": "src/utils.ts",
      "line": 10,
      "issue": "Function exceeds 50 lines",
      "fix": "Extract helper methods",
      "priority": "medium",
      "status": "fixed"
    }
  ]
}
```

##### Example Output

```text
CHECKS:
[fail] check:src:lint
src/helpers.ts:3:5 - error: Unexpected var, use let or const instead
Fix Instructions: Replace all `var` declarations with `const` or `let`.

REVIEWS:
[high] review:src:code-quality (claude@1)
src/main.ts:45 - Missing error handling for async database call
Fix: Wrap in try-catch block
```

Note: The `src/utils.ts:10` violation was omitted because its status is `"fixed"`, not `"new"`.

#### Rules

- Do NOT summarize or editorialize — copy error details verbatim where possible
- Do NOT skip any `[FAIL]` entries
- Keep the output compact — one entry per check failure, one entry per review violation (3 lines each)
- For review violations, only include those with `status: "new"` — skip `"fixed"` and `"skipped"`

### Update Prompt

You are an UPDATE subagent. Your job is to update review JSON files with fix/skip decisions.

#### Input

You receive:
1. A log directory path
2. A list of decisions, each with: `file`, `line`, `issue_prefix`, `status` ("fixed" or "skipped"), and `result` (brief description)

#### Process

For each decision:
1. Find the matching `.json` file in the log directory by scanning for a violation that matches on `file` (exact) AND `line` (exact) AND where `issue` starts with the provided `issue_prefix`. If multiple violations match, use the first unprocessed one (status still `"new"`)
2. Read the JSON file
3. Find the matching violation in the `violations` array
4. Set `"status"` to the provided status value
5. Set `"result"` to the provided result string
6. Write the updated JSON back to the same file path

#### Rules

- Do NOT modify any fields other than `status` and `result`
- Do NOT modify violations that don't match the provided decisions
- Preserve all other JSON structure and key ordering
- If a violation cannot be found, report it in your response but continue with other decisions
- Write the JSON with 2-space indentation

#### Example

##### Example Input

Log directory: `validator_logs/`

Decisions:
- file: `src/main.ts`, line: 45, issue_prefix: `Missing error handling`, status: `fixed`, result: `Added try-catch around database call`
- file: `src/utils.ts`, line: 10, issue_prefix: `Function exceeds`, status: `skipped`, result: `Stylistic preference, function is readable as-is`

The log directory contains `review_src_code-quality_claude@1.2.json`:
```json
{
  "adapter": "claude",
  "status": "fail",
  "violations": [
    {
      "file": "src/main.ts",
      "line": 45,
      "issue": "Missing error handling for async database call",
      "fix": "Wrap in try-catch block",
      "priority": "high",
      "status": "new"
    },
    {
      "file": "src/utils.ts",
      "line": 10,
      "issue": "Function exceeds 50 lines",
      "fix": "Extract helper methods",
      "priority": "medium",
      "status": "new"
    }
  ]
}
```

##### Example Output (what you write to the JSON file)

After updating, `review_src_code-quality_claude@1.2.json` becomes:
```json
{
  "adapter": "claude",
  "status": "fail",
  "violations": [
    {
      "file": "src/main.ts",
      "line": 45,
      "issue": "Missing error handling for async database call",
      "fix": "Wrap in try-catch block",
      "priority": "high",
      "status": "fixed",
      "result": "Added try-catch around database call"
    },
    {
      "file": "src/utils.ts",
      "line": 10,
      "issue": "Function exceeds 50 lines",
      "fix": "Extract helper methods",
      "priority": "medium",
      "status": "skipped",
      "result": "Stylistic preference, function is readable as-is"
    }
  ]
}
```

##### Example Response

```text
Updated 2 violations:
- src/main.ts:45 — set to fixed
- src/utils.ts:10 — set to skipped
```

#### Output

Return a brief confirmation listing each decision applied:
```text
Updated <N> violations:
- <file>:<line> — set to <status>
```

If any decisions could not be matched, add:
```text
Unmatched decisions:
- <file>:<line> — <issue_prefix> (not found in any JSON file)
```
