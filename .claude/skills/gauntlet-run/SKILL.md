---
name: gauntlet-run
description: >-
  Run the full verification gauntlet. Use this as the final step after
  completing a coding task — verifies quality, runs checks, and ensures all
  gates pass. Must be run before committing, pushing, or creating PRs.
disable-model-invocation: false
allowed-tools: Bash
---
<!--
  REVIEW TRUST LEVEL
  Controls how aggressively the agent acts on AI reviewer feedback.
  Change the trust_level value below to one of: high, medium, low

  - high:   Fix all issues unless you strongly disagree or have low confidence the human wants the change.
  - medium: Fix issues you reasonably agree with or believe the human wants to be fixed. (DEFAULT)
  - low:    Fix only issues you strongly agree with or are confident the human wants to be fixed.
-->
<!-- trust_level: medium -->

# /gauntlet-run
Execute the autonomous verification suite.

**Review trust level: medium** — Fix issues you reasonably agree with or believe the human wants to be fixed. Skip issues that are purely stylistic, subjective, or that you believe the human would not want changed. When you skip an issue, briefly state what was skipped and why.

1. Run `bun src/index.ts clean` to archive any previous log files
2. Run `bun src/index.ts run`
3. If it fails:
   - Identify the failed gates from the console output.
   - For CHECK failures: Read the `.log` file path provided in the output. If the log contains a `--- Fix Instructions ---` section, follow those instructions to fix the issue. If it contains a `--- Fix Skill: <name> ---` section, invoke that skill.
   - For REVIEW failures: Read the `.json` file path provided in the "Review: <path>" output.
4. Address the violations:
   - For REVIEW violations: You MUST update the `"status"` and `"result"` fields in the provided `.json` file for EACH violation.
     - Set `"status": "fixed"` and add a brief description to `"result"` for issues you fix.
     - Set `"status": "skipped"` and add a brief reason to `"result"` for issues you skip (based on the trust level).
     - Do NOT modify any other attributes (file, line, issue, priority) in the JSON file.
   - Apply the trust level above when deciding whether to act on AI reviewer feedback.
5. Run `bun src/index.ts run` again to verify your fixes. Do NOT run `bun src/index.ts clean` between retries. The tool detects existing logs and automatically switches to verification mode.
6. Repeat steps 3-5 until one of the following termination conditions is met:
   - "Status: Passed" appears in the output (logs are automatically archived)
   - "Status: Passed with warnings" appears in the output (remaining issues were skipped)
   - "Status: Retry limit exceeded" appears in the output (logs are automatically archived). Do NOT retry.
7. Provide a summary of the session:
   - Issues Fixed: (list key fixes)
   - Issues Skipped: (list skipped items and reasons)
   - Outstanding Failures: (if retry limit exceeded, list unverified fixes and remaining issues)
