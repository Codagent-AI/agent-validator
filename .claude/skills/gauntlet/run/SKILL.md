---
name: run
description: Run the full verification gauntlet
disable-model-invocation: true
allowed-tools: Bash
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

# /gauntlet:run
Execute the autonomous verification suite.

**Review trust level: medium** — Fix issues you reasonably agree with or believe the human wants fixed. Skip issues that are purely stylistic, subjective, or that you believe the human would not want changed. When you skip an issue, briefly state what was skipped and why.

0. Run `bun src/index.ts clean` to archive any previous log files
1. Run `bun src/index.ts run`
2. If it fails:
   - Identify the failed gates from the console output.
   - For CHECK failures: Read the `.log` file path provided in the output.
   - For REVIEW failures: Read the `.json` file path provided in the "Review: <path>" output.
3. Address the violations:
   - For REVIEW violations: You MUST update the `"status"` and `"result"` fields in the provided `.json` file for EACH violation.
     - Set `"status": "fixed"` and add a brief description to `"result"` for issues you fix.
     - Set `"status": "skipped"` and add a brief reason to `"result"` for issues you skip (based on the trust level).
     - Do NOT modify any other attributes (file, line, issue, priority) in the JSON file.
   - Apply the trust level above when deciding whether to act on AI reviewer feedback.
4. Run `bun src/index.ts run` again to verify your fixes. It will detect existing logs and automatically switch to verification mode.
5. Repeat steps 2-4 until one of the following termination conditions is met:
   - "Status: Passed" appears in the output (logs are automatically archived)
   - "Status: Passed with warnings" appears in the output (remaining issues were skipped)
   - "Status: Retry limit exceeded" appears in the output -> Run `agent-gauntlet clean` to archive logs for the session record. Do NOT retry after cleaning.
6. Provide a summary of the session:
   - Issues Fixed: (list key fixes)
   - Issues Skipped: (list skipped items and reasons)
   - Outstanding Failures: (if retry limit exceeded, list unverified fixes and remaining issues)
