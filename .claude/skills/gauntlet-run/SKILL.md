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

**SAFETY: When using the Task tool for subagent calls, NEVER use `run_in_background: true`. All subagent calls MUST be synchronous.**

1. Run `agent-gauntlet clean` to archive any previous log files
2. Run `agent-gauntlet run`
3. If it fails:
   - Infer the log directory from the file paths in the console output (e.g., if output references `gauntlet_logs/check_._lint.1.log`, the log directory is `gauntlet_logs/`)
   - Read `extract-prompt.md` from this skill's directory
   - **Extract log failures** using the first available strategy:
     a. **Task tool** (Claude Code): `Task` with `subagent_type="general-purpose"`, `model="haiku"`, `prompt=` extract-prompt content + `"\n\nLog directory: <inferred path>"`. NEVER use `run_in_background: true`.
     b. **Subagent delegation**: If your environment supports delegating work to a subagent but not the Task tool, delegate the extract-prompt instructions with the log directory to a subagent for processing.
     c. **Inline fallback**: If no subagent capability is available, follow the extract-prompt instructions yourself to read the log files and produce the compact failure summary.
4. Fix code based on the compact summary:
   - CHECK failures with Fix Skill: invoke the named skill
   - CHECK failures with Fix Instructions: follow the instructions
   - REVIEW violations: apply the trust level above, fix or skip
5. For REVIEW violations you addressed:
   - Read `update-prompt.md` from this skill's directory
   - **Update review decisions** using the first available strategy (same as step 3):
     a. **Task tool** (Claude Code): `Task` with `subagent_type="general-purpose"`, `model="haiku"`, `prompt=` update-prompt content + log directory + decisions list. NEVER use `run_in_background: true`.
     b. **Subagent delegation**: Delegate the update-prompt instructions with the log directory and decisions to a subagent.
     c. **Inline fallback**: Follow the update-prompt instructions yourself to update the review JSON files.
6. Run `agent-gauntlet run` again to verify your fixes. Do NOT run `agent-gauntlet clean` between retries. The tool detects existing logs and automatically switches to verification mode.
7. Repeat steps 3-6 until one of the following termination conditions is met:
   - "Status: Passed" appears in the output (logs are automatically archived)
   - "Status: Passed with warnings" appears in the output (remaining issues were skipped)
   - "Status: Retry limit exceeded" appears in the output -> Run `agent-gauntlet clean` to archive logs for the session record. Do NOT retry after cleaning.
8. Provide a summary of the session:
   - Issues Fixed: (list key fixes)
   - Issues Skipped: (list skipped items and reasons)
   - Outstanding Failures: (if retry limit exceeded, list unverified fixes and remaining issues)
