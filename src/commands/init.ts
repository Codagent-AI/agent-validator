import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import chalk from "chalk";
import type { Command } from "commander";
import { type CLIAdapter, getAllAdapters } from "../cli-adapters/index.js";
import { exists } from "./shared.js";

const MAX_PROMPT_ATTEMPTS = 10;

function makeQuestion(rl: readline.Interface) {
	return (prompt: string): Promise<string> =>
		new Promise((resolve) =>
			rl.question(prompt, (a) => resolve(a?.trim() ?? "")),
		);
}

// Recommended adapter config: https://github.com/pacaplan/agent-gauntlet/blob/main/docs/eval-results.md
type AdapterCfg = { allow_tool_use: boolean; thinking_budget: string };
const ADAPTER_CONFIG: Record<string, AdapterCfg> = {
	claude: { allow_tool_use: false, thinking_budget: "high" },
	codex: { allow_tool_use: false, thinking_budget: "low" },
	gemini: { allow_tool_use: false, thinking_budget: "low" },
};

// --- Skill content templates ---
// These are used for both skills (Claude) and flat commands (other agents).
// The frontmatter fields (name, disable-model-invocation) are only meaningful
// for skills but are harmless in flat command files.

/**
 * Build gauntlet run/check skill content. Shared structure avoids duplication
 * between the "run" and "check" skills.
 */
function buildGauntletSkillContent(mode: "run" | "check"): string {
	const isRun = mode === "run";
	const name = isRun ? "run" : "check";
	const description = isRun
		? "Run the full verification gauntlet"
		: "Run checks only (no reviews)";
	const command = isRun ? "agent-gauntlet run" : "agent-gauntlet check";
	const heading = isRun
		? "Execute the autonomous verification suite."
		: "Run the gauntlet checks only \u2014 no AI reviews.";

	const frontmatter = `---
name: gauntlet-${name}
description: ${description}
disable-model-invocation: true
allowed-tools: Bash
---`;

	// Common prefix: archive old logs, then run the command
	const steps = [
		`1. Run \`agent-gauntlet clean\` to archive any previous log files`,
		`2. Run \`${command}\``,
	];

	if (isRun) {
		steps.push(
			`3. If it fails:
   - Identify the failed gates from the console output.
   - For CHECK failures: Read the \`.log\` file path provided in the output.
   - For REVIEW failures: Read the \`.json\` file path provided in the "Review: <path>" output.
4. Address the violations:
   - For REVIEW violations: You MUST update the \`"status"\` and \`"result"\` fields in the provided \`.json\` file for EACH violation.
     - Set \`"status": "fixed"\` and add a brief description to \`"result"\` for issues you fix.
     - Set \`"status": "skipped"\` and add a brief reason to \`"result"\` for issues you skip (based on the trust level).
     - Do NOT modify any other attributes (file, line, issue, priority) in the JSON file.
   - Apply the trust level above when deciding whether to act on AI reviewer feedback.
5. Run \`${command}\` again to verify your fixes. Do NOT run \`agent-gauntlet clean\` between retries. The tool detects existing logs and automatically switches to verification mode.
6. Repeat steps 3-5 until one of the following termination conditions is met:
   - "Status: Passed" appears in the output (logs are automatically archived)
   - "Status: Passed with warnings" appears in the output (remaining issues were skipped)
   - "Status: Retry limit exceeded" appears in the output -> Run \`agent-gauntlet clean\` to archive logs for the session record. Do NOT retry after cleaning.
7. Provide a summary of the session:
   - Issues Fixed: (list key fixes)
   - Issues Skipped: (list skipped items and reasons)
   - Outstanding Failures: (if retry limit exceeded, list unverified fixes and remaining issues)`,
		);
	} else {
		steps.push(
			`3. If any checks fail:
   - Read the \`.log\` file path provided in the output for each failed check.
   - Fix the issues found.
4. Run \`${command}\` again to verify your fixes. Do NOT run \`agent-gauntlet clean\` between retries.
5. Repeat steps 3-4 until all checks pass or you've made 3 attempts.
6. Provide a summary of the session:
   - Checks Passed: (list)
   - Checks Failed: (list with brief reason)
   - Fixes Applied: (list key fixes)`,
		);
	}

	if (isRun) {
		return `${frontmatter}
<!--
  REVIEW TRUST LEVEL
  Controls how aggressively the agent acts on AI reviewer feedback.
  Change the trust_level value below to one of: high, medium, low

  - high:   Fix all issues unless you strongly disagree or have low confidence the human wants the change.
  - medium: Fix issues you reasonably agree with or believe the human wants fixed. (DEFAULT)
  - low:    Fix only issues you strongly agree with or are confident the human wants fixed.
-->
<!-- trust_level: medium -->

# /gauntlet-${name}
${heading}

**Review trust level: medium** \u2014 Fix issues you reasonably agree with or believe the human wants to be fixed. Skip issues that are purely stylistic, subjective, or that you believe the human would not want changed. When you skip an issue, briefly state what was skipped and why.

${steps.join("\n")}
`;
	}

	return `${frontmatter}

# /gauntlet-${name}
${heading}

${steps.join("\n")}
`;
}

const GAUNTLET_RUN_SKILL_CONTENT = buildGauntletSkillContent("run");
const GAUNTLET_CHECK_SKILL_CONTENT = buildGauntletSkillContent("check");

const PUSH_PR_SKILL_CONTENT = `---
name: gauntlet-push-pr
description: Commit changes, push to remote, and create or update a pull request
disable-model-invocation: true
allowed-tools: Bash
---

# /gauntlet-push-pr
Commit all changes, push to remote, and create or update a pull request for the current branch.

After the PR is created or updated, verify it exists by running \`gh pr view\`.
`;

const FIX_PR_SKILL_CONTENT = `---
name: gauntlet-fix-pr
description: Fix CI failures or address review comments on a pull request
disable-model-invocation: true
allowed-tools: Bash
---

# /gauntlet-fix-pr
Fix CI failures or address review comments on the current pull request.

1. Check CI status and review comments: \`gh pr checks\` and \`gh pr view --comments\`
2. Fix any failing checks or address reviewer feedback
3. Commit and push your changes
4. After pushing, verify the PR is updated: \`gh pr view\`
`;

const GAUNTLET_STATUS_SKILL_CONTENT = `---
name: gauntlet-status
description: Show a summary of the most recent gauntlet session
disable-model-invocation: true
allowed-tools: Bash, Read
---

# /gauntlet-status
Show a detailed summary of the most recent gauntlet session.

## Step 1: Run the status script

\`\`\`bash
bun .gauntlet/skills/gauntlet/status/scripts/status.ts 2>&1
\`\`\`

The script parses the \`.debug.log\` for session-level data (run count, gate results, pass/fail status) and lists all log files with their paths and sizes.

## Step 2: Read failed gate details

For each gate marked **FAIL** in the Gate Results table, read the corresponding log files to extract failure details:

- **Check failures** (e.g., \`check:src:code-health\`): Read the matching \`check_*.log\` file. Check log formats vary by tool (linters, test runners, code health analyzers) — read the file and extract the relevant error/warning output.
- **Review failures** (e.g., \`review:.:code-quality\`): Read the matching \`review_*.json\` file(s). These contain structured violation data with \`file\`, \`line\`, \`issue\`, \`priority\`, and \`status\` fields.

Use the file paths from the "Log Files" section of the script output. Match gate IDs to file names: \`check:.:lint\` corresponds to \`check_._lint.*.log\`, \`review:.:code-quality\` corresponds to \`review_._code-quality_*.{log,json}\`.

## Step 3: Present the results

Combine the script's session summary with the detailed failure information into a comprehensive report:

1. Session overview (status, iterations, duration, fixed/skipped/failed counts)
2. Gate results table
3. For any failed gates: the specific errors, violations, or test failures from the log files
4. For reviews with violations: list each violation with file, line, issue, priority, and current status (fixed/skipped/outstanding)
`;

/**
 * Build the gauntlet-help skill bundle content.
 * Returns { content, references } for the multi-file skill.
 */
function buildHelpSkillBundle(): {
	content: string;
	references: Record<string, string>;
} {
	const content = `---
name: gauntlet-help
description: Diagnose and explain gauntlet behavior using runtime evidence
allowed-tools: Bash, Read, Glob, Grep
---

# /gauntlet-help

Evidence-based diagnosis of gauntlet behavior. This skill is **diagnosis-only** — it explains what happened and why, but does not auto-fix issues. It operates from **runtime artifacts and CLI outputs**, not source code.

## Diagnostic Workflow

Follow this order for every diagnostic question:

1. **Resolve \`log_dir\`**: Read \`.gauntlet/config.yml\` and extract the \`log_dir\` field (default: \`gauntlet_logs\`). All log paths below are relative to \`<log_dir>/\`.
2. **Passive evidence first**: Read files before running commands.
   - \`<log_dir>/.debug.log\` — timestamped event log (commands, gate results, state changes, errors)
   - \`<log_dir>/.execution_state\` — JSON with \`last_run_completed_at\`, \`branch\`, \`commit\`, \`working_tree_ref\`, and \`unhealthy_adapters\` (adapter name → \`{marked_at, reason}\`)
   - \`<log_dir>/console.*.log\` — console output per run (highest number = latest)
   - \`<log_dir>/check_*.log\` — check gate output
   - \`<log_dir>/review_*.json\` — review gate results with violations (\`file\`, \`line\`, \`issue\`, \`fix\`, \`priority\`, \`status\`)
   - \`.gauntlet/config.yml\` — project configuration
3. **Active evidence when needed**: Run CLI commands only when passive evidence is insufficient for a confident diagnosis.
4. **Explain with evidence**: Clearly distinguish confirmed findings from inference.

## Evidence Sources

| Source | What It Confirms |
|--------|-----------------|
| \`.gauntlet/config.yml\` | \`log_dir\`, \`base_branch\`, \`entry_points\`, \`cli.default_preference\`, \`stop_hook\` settings, \`max_retries\`, \`rerun_new_issue_threshold\` |
| \`<log_dir>/.debug.log\` | Timestamped event history: commands executed, gate results, state transitions, errors |
| \`<log_dir>/.execution_state\` | Last successful run timestamp, branch/commit at that time, working tree stash ref, unhealthy adapter cooldowns |
| \`<log_dir>/console.*.log\` | Human-readable output from each run iteration |
| \`<log_dir>/check_*.log\` | Raw output from check gate commands (linters, test runners, etc.) |
| \`<log_dir>/review_*.json\` | Structured review violations with file, line, issue, priority, and resolution status |
| \`<log_dir>/.gauntlet-run.lock\` | Lock file (contains PID) — present only during active execution |
| \`<log_dir>/.stop-hook-active\` | Marker file (contains PID) — present only during active stop-hook execution |
| \`<log_dir>/.ci-wait-attempts\` | CI wait attempt counter |

## CLI Command Quick-Reference

Use these only when passive evidence is insufficient:

| Command | When to Use |
|---------|-------------|
| \`agent-gauntlet list\` | See configured gates and entry points |
| \`agent-gauntlet health\` | Check adapter availability and health status |
| \`agent-gauntlet detect\` | See which files changed and which gates would apply |
| \`agent-gauntlet validate\` | Validate config.yml syntax and schema |
| \`agent-gauntlet clean\` | Archive current logs and reset state (destructive — confirm with user first) |

## Routing Logic

Based on the user's question, load the appropriate reference file for detailed guidance:

| Question Domain | Reference File |
|----------------|---------------|
| Stop hook blocked/allowed, hook statuses, recursion, timing | \`references/stop-hook-troubleshooting.md\` |
| Missing config, YAML errors, misconfiguration, init problems | \`references/config-troubleshooting.md\` |
| Check failures, review failures, no_changes, no_applicable_gates, rerun mode | \`references/gate-troubleshooting.md\` |
| Lock conflict, stale locks, parallel runs, cleanup | \`references/lock-troubleshooting.md\` |
| Adapter health, missing tools, usage limits, cooldown | \`references/adapter-troubleshooting.md\` |
| PR push, CI status, auto_push_pr, auto_fix_pr, CI wait | \`references/ci-pr-troubleshooting.md\` |

If the question spans multiple domains, load each relevant reference.

## Output Contract

Every diagnostic response MUST include these sections:

### Diagnosis
What happened and why, stated clearly.

### Evidence
Specific files read, field values observed, and command outputs that support the diagnosis. Quote relevant log lines or config values.

### Confidence
One of:
- **High** — diagnosis is fully supported by direct evidence
- **Medium** — diagnosis is likely but some evidence is missing or ambiguous
- **Low** — diagnosis is inferred; key evidence is unavailable

Downgrade confidence when:
- \`.debug.log\` or \`.execution_state\` is missing or empty
- Log files referenced in output don't exist
- Config values can't be verified
- CLI commands fail or return unexpected output

### Next Steps
Actionable recommendations for the user. If confidence is not high, suggest what additional evidence would confirm the diagnosis.
`;

	const references: Record<string, string> = {
		"stop-hook-troubleshooting.md": `# Stop Hook Troubleshooting

## All Stop-Hook Statuses

### Allowing Statuses (stop is permitted)

| Status | Message | Meaning |
|--------|---------|---------|
| \`passed\` | All gates completed successfully | Every configured check and review gate passed |
| \`passed_with_warnings\` | Passed with warnings (some issues were skipped) | Gates ran but some review violations were skipped rather than fixed |
| \`no_applicable_gates\` | No applicable gates matched current changes | Changed files didn't match any configured entry point |
| \`no_changes\` | No changes detected | No files changed relative to \`base_branch\` |
| \`ci_passed\` | CI passed — all checks completed and no blocking reviews | GitHub CI checks succeeded and no \`CHANGES_REQUESTED\` reviews |
| \`no_config\` | Not a gauntlet project — no \`.gauntlet/config.yml\` found | No gauntlet configuration in this repo |
| \`stop_hook_active\` | Stop hook cycle detected — allowing stop to prevent infinite loop | Recursion prevention triggered |
| \`stop_hook_disabled\` | Stop hook is disabled via configuration | \`stop_hook.enabled: false\` in config or \`GAUNTLET_STOP_HOOK_ENABLED=false\` |
| \`interval_not_elapsed\` | Run interval not elapsed | \`stop_hook.run_interval_minutes\` hasn't elapsed since last run |
| \`invalid_input\` | Invalid hook input — could not parse JSON | Stop-hook couldn't parse stdin JSON from the IDE |
| \`lock_conflict\` | Another gauntlet run is already in progress | Lock file exists with a live PID |
| \`error\` | Stop hook error | Unexpected error during execution |
| \`retry_limit_exceeded\` | Retry limit exceeded | Max retries (default 3) exhausted; requires \`agent-gauntlet clean\` |

### Blocking Statuses (stop is prevented)

| Status | Message | Meaning |
|--------|---------|---------|
| \`failed\` | Issues must be fixed before stopping | One or more gates failed; agent must fix and re-run |
| \`pr_push_required\` | PR needs to be created or updated before stopping | Gates passed but \`auto_push_pr\` is enabled and PR hasn't been pushed |
| \`ci_pending\` | CI checks still running — waiting for completion | Waiting for GitHub CI to finish |
| \`ci_failed\` | CI failed or review changes requested | GitHub CI checks failed or a reviewer requested changes |

## Common Scenarios

### "The hook blocked my stop"
1. Check the status in \`.debug.log\` — search for \`status:\` entries
2. If \`failed\`: Read the gate output files listed in \`.debug.log\` or the latest \`console.*.log\`
3. If \`pr_push_required\`: The agent needs to commit, push, and create a PR
4. If \`ci_pending\`: CI is still running; the hook will re-check on next stop attempt
5. If \`ci_failed\`: Read CI failure details — run \`agent-gauntlet wait-ci\` or check \`gh pr checks\`

### "The hook allowed but shouldn't have"
1. Check if the status was \`no_changes\` — verify \`base_branch\` is correct in \`config.yml\`
2. Check if \`no_applicable_gates\` — run \`agent-gauntlet detect\` to see which files changed and which gates match
3. Check if \`interval_not_elapsed\` — the run was skipped because \`run_interval_minutes\` hadn't elapsed
4. Check if \`stop_hook_disabled\` — verify \`stop_hook.enabled\` in config and \`GAUNTLET_STOP_HOOK_ENABLED\` env var

### "The gauntlet isn't running gates / keeps allowing stops immediately"
This happens when the iteration counter is inherited from a previous session's failures. Symptoms:
1. \`.debug.log\` shows \`RUN_START\` followed immediately by \`RUN_END\` with \`duration=0.0s\`
2. \`iterations\` value is high (e.g., 7, 8, 9) even though the current session hasn't run that many times
3. Stop-hook returns \`retry_limit_exceeded\` without executing any gates
4. \`failed=0\` in \`RUN_END\` (no gates ran, so none failed — but status is still \`fail\`)

**Root cause**: The iteration counter persists in \`.execution_state\` across sessions. If a previous session ended with unresolved failures and hit the retry limit, the counter carries over. The next session enters verification mode and immediately exceeds the limit.

**Fix**: Run \`agent-gauntlet clean\` to reset the state and iteration counter, then re-run.

**Prevention**: Before starting a new task, check if the previous session left failures behind. If \`.debug.log\` shows a recent \`STOP_HOOK decision=block reason=failed\` or \`retry_limit_exceeded\`, clean state first.

### "The hook seems stuck"
1. Check for \`.stop-hook-active\` marker in \`<log_dir>/\` — if present, a stop-hook may be running
2. Check PID in the marker file — is that process alive?
3. The stop-hook has a **5-minute hard timeout** (\`STOP_HOOK_TIMEOUT_MS\`) and will self-terminate
4. Stale marker files older than **10 minutes** are automatically cleaned up on next invocation

## Recursion Prevention

The stop-hook uses three layers to prevent infinite loops:

### Layer 1: Environment Variable
- Variable: \`GAUNTLET_STOP_HOOK_ACTIVE\`
- Set by the parent gauntlet when spawning child CLI processes for reviews
- If \`GAUNTLET_STOP_HOOK_ACTIVE=1\`, the stop-hook exits immediately with \`stop_hook_active\`
- Prevents child review processes from triggering nested gauntlets

### Layer 2: Marker File
- File: \`<log_dir>/.stop-hook-active\` (contains the PID)
- Created before execution, removed after completion (in \`finally\` block)
- If another stop-hook fires during execution and finds a fresh marker (< 10 min old), it exits with \`stop_hook_active\`
- Stale markers (> 10 min) are deleted and execution proceeds
- Needed because Claude Code does NOT pass env vars to hooks

### Layer 3: IDE Input Field
- Claude Code: \`stop_hook_active\` boolean in the stdin JSON
- Cursor: \`loop_count\` field; threshold is 10 (returns \`retry_limit_exceeded\` if exceeded)
- Additional safety net from the IDE itself

## Timing Values

| Timer | Value | Purpose |
|-------|-------|---------|
| Stdin timeout | 5 seconds | Safety net for delayed stdin from IDE |
| Hard timeout | 5 minutes | Self-timeout to prevent zombie processes |
| Stale marker | 10 minutes | Marker files older than this are cleaned up |
| \`run_interval_minutes\` | Configurable (default 0 = always run) | Minimum time between stop-hook runs |

## Environment Variable Overrides

These override project config values (env > project config > global config):

| Variable | Type | Effect |
|----------|------|--------|
| \`GAUNTLET_STOP_HOOK_ENABLED\` | \`true\`/\`1\`/\`false\`/\`0\` | Enable or disable the stop hook entirely |
| \`GAUNTLET_STOP_HOOK_INTERVAL_MINUTES\` | Integer >= 0 | Minutes between runs (0 = always run) |
| \`GAUNTLET_AUTO_PUSH_PR\` | \`true\`/\`1\`/\`false\`/\`0\` | Check PR status after gates pass |
| \`GAUNTLET_AUTO_FIX_PR\` | \`true\`/\`1\`/\`false\`/\`0\` | Enable CI wait workflow after PR created |

## Diagnosing \`stop_hook_disabled\`

This status means the stop hook has been explicitly disabled. Check in order:

1. \`GAUNTLET_STOP_HOOK_ENABLED\` environment variable (highest precedence)
2. \`.gauntlet/config.yml\` → \`stop_hook.enabled\`
3. \`~/.config/agent-gauntlet/config.yml\` → \`stop_hook.enabled\` (global)

To re-enable: remove the env var or set \`stop_hook.enabled: true\` in config.
`,
		"config-troubleshooting.md": `# Config Troubleshooting

## \`no_config\` — Missing Configuration

The stop hook returns \`no_config\` when \`.gauntlet/config.yml\` doesn't exist. This is normal for non-gauntlet projects.

**If it should exist:**
1. Run \`agent-gauntlet init\` to create the configuration
2. Or manually create \`.gauntlet/config.yml\`

## YAML Syntax and Schema Errors

Run \`agent-gauntlet validate\` to check config syntax and schema.

**Common YAML issues:**
- Indentation errors (YAML requires consistent indentation)
- Missing colons after keys
- Unquoted special characters in values

**Schema validation catches:**
- Missing required fields (\`cli.default_preference\`, \`entry_points\`)
- Wrong types (e.g., string where array expected)
- Invalid enum values (e.g., invalid \`rerun_new_issue_threshold\`)

## Common Misconfigurations

### Missing or Empty \`cli.default_preference\`
\`\`\`yaml
# WRONG — missing
cli: {}

# WRONG — empty
cli:
  default_preference: []

# CORRECT
cli:
  default_preference:
    - claude
\`\`\`

### Empty \`entry_points\`
\`\`\`yaml
# WRONG
entry_points: []

# CORRECT
entry_points:
  - path: "."
    reviews:
      - code-quality
\`\`\`

### \`fail_fast\` with \`parallel\`
These are mutually exclusive for check gates. Schema validation rejects this:
\`\`\`yaml
# WRONG — in a check YAML file
parallel: true
fail_fast: true

# CORRECT — fail_fast only works with sequential
parallel: false
fail_fast: true
\`\`\`

### Conflicting Fix Instruction Fields
Check gates support only one fix method. These are mutually exclusive:
- \`fix_instructions\` (inline string)
- \`fix_instructions_file\` (path to file)
- \`fix_with_skill\` (skill name)

### Entry Point References Non-Existent Gate
If an entry point lists a check or review name that doesn't exist in \`.gauntlet/checks/\` or \`.gauntlet/reviews/\`, validation fails.

### Review Gate Uses Tool Not in \`default_preference\`
Review gates can specify \`cli_preference\` but the tools must also appear in \`cli.default_preference\`.

## \`log_dir\` Issues

The \`log_dir\` field (default: \`gauntlet_logs\`) determines where all logs are written.

**Can't find logs:**
1. Check \`config.yml\` for the \`log_dir\` value
2. Verify the directory exists (it's created automatically on first run)
3. Check if a previous \`agent-gauntlet clean\` archived everything to \`previous/\`

**Permissions:**
- The gauntlet needs write access to \`log_dir\`
- On some setups, the directory may not be writable

## \`base_branch\` Misconfiguration

The \`base_branch\` (default: \`origin/main\`) is used for diff calculation. Wrong values cause:
- \`no_changes\` when there are actually changes (wrong base)
- Diff includes too many files (base too far back)

**Verify:**
\`\`\`bash
git log --oneline origin/main..HEAD  # Should show your commits
\`\`\`

If using a different default branch:
\`\`\`yaml
base_branch: origin/develop
\`\`\`

## Config Precedence

Configuration is loaded with this precedence (highest first):
1. **Environment variables** (e.g., \`GAUNTLET_STOP_HOOK_ENABLED\`)
2. **Project config** (\`.gauntlet/config.yml\`)
3. **Global config** (\`~/.config/agent-gauntlet/config.yml\`)
4. **Defaults** (built-in)

## Init Setup Problems

### "\`.gauntlet\` directory already exists"
\`agent-gauntlet init\` won't overwrite an existing \`.gauntlet/\` directory. Delete it first or manually edit.

### Git Not Initialized
Some features require a git repository. Run \`git init\` first.

### No Remote Configured
The \`base_branch\` (e.g., \`origin/main\`) requires a remote. Run \`git remote add origin <url>\`.

## Adapter Configuration

Per-adapter settings are configured under \`cli.adapters\`:
\`\`\`yaml
cli:
  default_preference:
    - claude
  adapters:
    claude:
      allow_tool_use: true
      thinking_budget: medium  # off, low, medium, high
\`\`\`

**\`thinking_budget\` mapping:**
- Claude: off=0, low=8000, medium=16000, high=31999 tokens
- Codex: off=minimal, low=low, medium=medium, high=high
- Gemini: off=0, low=4096, medium=8192, high=24576 tokens

## Debug Logging

Enable detailed logging in config:
\`\`\`yaml
debug_log:
  enabled: true
  max_size_mb: 10
\`\`\`

This creates \`<log_dir>/.debug.log\` with timestamped events.
`,
		"gate-troubleshooting.md": `# Gate Troubleshooting

## Check Gate Failures

Check gates run shell commands (linters, test runners, etc.) and report pass/fail based on exit code.

### Common Failure Modes

| Failure | Cause | Evidence |
|---------|-------|----------|
| Command not found | Binary not installed or not in PATH | Check gate log for "command not found" error |
| Non-zero exit code | Linter/test failures | Read the \`check_*.log\` file for specific errors |
| Timeout | Command exceeded configured timeout | Log shows SIGTERM; check \`timeout\` in check YAML |
| Output truncation | Command output exceeded 10MB buffer | Log may be cut off; increase timeout or reduce output |

### Reading Check Logs
- File pattern: \`<log_dir>/check_<CHECK_NAME>.log\`
- Contains raw stdout/stderr from the check command
- Format depends on the tool (linter output, test runner output, etc.)

### Rerun Commands
Check gates can define a \`rerun_command\` for verification runs. If set, the rerun uses this command instead of the original \`command\`.

## Review Gate Failures

Review gates use AI CLI tools to review code changes.

### Common Failure Modes

| Failure | Cause | Evidence |
|---------|-------|----------|
| No healthy adapters | All configured CLI tools are missing, unhealthy, or in cooldown | Run \`agent-gauntlet health\` |
| JSON parsing error | Adapter returned non-JSON output | Review log shows raw output instead of violations |
| Violations outside diff scope | Reviewer flagged code not in the current diff | Check violation \`file\` and \`line\` against changed files |
| Usage limit | API quota exceeded for the adapter | Look for "usage limit" in review log; adapter enters 1-hour cooldown |

### Reading Review JSON
- File pattern: \`<log_dir>/review_<REVIEW_NAME>_<ADAPTER>@<INDEX>.json\`
- Fields per violation:
  - \`file\`: Source file path
  - \`line\`: Line number
  - \`issue\`: Description of the problem
  - \`fix\`: Suggested fix
  - \`priority\`: \`critical\`, \`high\`, \`medium\`, or \`low\`
  - \`status\`: \`new\`, \`fixed\`, \`skipped\`
- Status \`skipped_prior_pass\` means this review slot passed on a previous run and was skipped for efficiency

### Diff Calculation
- **Local mode**: committed changes (base...HEAD) + uncommitted changes (HEAD) + untracked files
- **CI mode**: \`git diff GITHUB_BASE_REF...GITHUB_SHA\` (falls back to HEAD^...HEAD)
- **Rerun mode**: scoped to changes since last pass using \`working_tree_ref\` from \`.execution_state\`

## \`no_applicable_gates\`

All configured gates were skipped because no changed files matched any entry point path.

**Diagnosis:**
1. Run \`agent-gauntlet detect\` to see which files changed and which gates match
2. Check \`entry_points\` in \`config.yml\` — do the paths cover your changed files?
3. Verify \`base_branch\` — if wrong, the diff may not include your changes

## \`no_changes\`

No files changed relative to \`base_branch\`.

**Diagnosis:**
1. Check \`base_branch\` in \`config.yml\` (default: \`origin/main\`)
2. Run \`git diff origin/main...HEAD --stat\` to verify
3. If working on uncommitted changes, they are included in local mode but may not be in CI mode
4. Check if a recent \`agent-gauntlet clean\` reset the execution state

## Parallel vs Sequential Execution

### Check Gates
- Each check gate has a \`parallel\` setting (default: \`false\`)
- Parallel checks run concurrently; sequential checks run one at a time
- \`allow_parallel\` in \`config.yml\` (default: \`true\`) is the global switch

### \`fail_fast\` Behavior
- Only applies to sequential check gates (\`parallel: false\`)
- When enabled, stops running remaining sequential gates after the first failure
- Cannot be combined with \`parallel: true\` (schema validation rejects this)

### Review Gates
- Each review gate independently controls parallelism for its own adapter dispatch
- When \`parallel: true\` (default) and \`num_reviews > 1\`, reviews run concurrently across adapters
- When \`parallel: false\`, reviews run sequentially

## Rerun / Verification Mode

When the gauntlet detects existing logs in \`<log_dir>/\`, it enters **rerun mode** instead of a fresh run.

### How It Works
1. Previous violations are loaded from existing \`review_*.json\` files
2. Only violations at the configured threshold priority or higher are re-evaluated
3. Check gates re-run their commands (or \`rerun_command\` if configured)
4. Review gates scope their diff to changes since the last pass using \`working_tree_ref\` from \`.execution_state\`

### \`rerun_new_issue_threshold\`
- Config field: \`rerun_new_issue_threshold\` (default: \`medium\`)
- Controls which priority levels are re-evaluated: \`critical\` > \`high\` > \`medium\` > \`low\`
- Violations below the threshold are ignored in reruns

### Passed Slot Optimization
When \`num_reviews > 1\` in rerun mode:
- If all review slots passed previously: only slot 1 re-runs (safety latch)
- If some slots failed: only failed slots re-run; passed slots get \`skipped_prior_pass\`

### Why Violations Aren't Detected on Rerun
- The diff is scoped to changes since the last pass — if the violation is in unchanged code, it won't appear
- The threshold may filter out lower-priority violations
- Passed slots may be skipped entirely

## How to Read Gate Logs

### Console Logs
- Pattern: \`<log_dir>/console.*.log\` (highest number = latest run)
- Contains unified output from all gates for that run iteration
- Shows gate names, pass/fail status, and output file paths

### Debug Log
- File: \`<log_dir>/.debug.log\`
- Timestamped entries for every significant event
- Search for \`gate\`, \`check\`, \`review\`, or specific gate names

### Gate Result Status Values
- Check gates: \`pass\`, \`fail\`, \`error\`
- Review gates: \`pass\`, \`fail\`, \`error\`, \`skipped_prior_pass\`
`,
		"lock-troubleshooting.md": `# Lock Troubleshooting

## \`lock_conflict\` — Another Run in Progress

The gauntlet uses a lock file to prevent concurrent runs from interfering with each other.

### Lock File Details
- **File**: \`<log_dir>/.gauntlet-run.lock\`
- **Content**: PID of the process holding the lock
- **Created**: At the start of a gauntlet run (exclusive write — fails if file exists)
- **Released**: Always in a \`finally\` block (guaranteed cleanup on success, failure, or error)

### Diagnosing Lock Conflicts

1. Check if the lock file exists: \`<log_dir>/.gauntlet-run.lock\`
2. Read the PID from the file
3. Check if that process is alive:
   - If alive: a gauntlet run is genuinely in progress — wait for it to finish
   - If dead: the lock is stale (see below)

## Stale Lock Detection

The gauntlet automatically detects and cleans stale locks:

| Condition | Detection | Action |
|-----------|-----------|--------|
| PID is dead | \`kill(pid, 0)\` fails with ESRCH | Lock removed, retry once |
| PID unparseable, lock > 10 min old | File age check | Lock removed, retry once |
| PID alive | Process exists | Lock kept (genuine conflict) |

**The gauntlet never steals a lock from a live process**, regardless of lock age.

## \`allow_parallel\` Config

The \`allow_parallel\` config setting (default: \`true\`) controls whether gates can run in parallel **within** a single gauntlet run. It does **not** control concurrent gauntlet runs — that's what the lock file prevents.

## Marker Files

### \`.gauntlet-run.lock\`
- **Location**: \`<log_dir>/.gauntlet-run.lock\`
- **Purpose**: Prevent concurrent gauntlet runs
- **Lifecycle**: Created at run start, removed at run end (always in \`finally\`)

### \`.stop-hook-active\`
- **Location**: \`<log_dir>/.stop-hook-active\`
- **Purpose**: Prevent stop-hook recursion (see stop-hook-troubleshooting.md)
- **Content**: PID of the stop-hook process
- **Stale threshold**: 10 minutes
- **Lifecycle**: Created before stop-hook execution, removed after (always in \`finally\`)

## Manual Cleanup

If a lock is stuck and the process is dead:

\`\`\`bash
agent-gauntlet clean
\`\`\`

This command:
1. Archives current logs to \`<log_dir>/previous/\`
2. Removes the lock file
3. Removes the stop-hook marker file
4. Resets execution state

**Confirm with the user before running \`clean\`** — it archives all current logs and resets state, which means the next run starts fresh (no rerun mode).

## Troubleshooting Checklist

1. **Is another run actually in progress?** Check the PID in the lock file.
2. **Is the process alive?** The gauntlet should auto-clean stale locks on retry.
3. **Did a crash leave a stale lock?** Run \`agent-gauntlet clean\` to reset.
4. **Is this happening repeatedly?** Check for processes spawning concurrent gauntlet runs (e.g., multiple IDE hooks firing simultaneously).
`,
		"adapter-troubleshooting.md": `# Adapter Troubleshooting

## \`agent-gauntlet health\` Output

Run \`agent-gauntlet health\` to check adapter status. Each adapter reports one of:

| Status | Meaning |
|--------|---------|
| \`healthy\` | Binary found and available |
| \`missing\` | Binary not found in PATH |
| \`unhealthy\` | Binary found but not functional (auth issue, etc.) |

## Missing CLI Tools

If an adapter reports \`missing\`:
1. Verify the tool is installed
2. Check that it's in your PATH: \`which claude\`, \`which gemini\`, \`which codex\`
3. If installed but not in PATH, add the installation directory to your PATH

Missing adapters are skipped during review gate dispatch with a "Skipping X: Missing" message.

## Authentication Issues

If an adapter reports \`unhealthy\`:
1. Check the tool's authentication: try running the CLI tool directly
2. For Claude: \`claude --version\` (may need \`claude login\`)
3. For Gemini: check Google Cloud authentication
4. For Codex: check OpenAI authentication

## Usage Limits and 1-Hour Cooldown

### How Usage Limits Are Detected
The gauntlet checks adapter output for these keywords:
- "usage limit"
- "quota exceeded"
- "quota will reset"
- "credit balance is too low"
- "out of extra usage"
- "out of usage"

### Cooldown Mechanism
When a usage limit is detected:
1. The adapter is marked **unhealthy** in \`.execution_state\`
2. A **1-hour cooldown** starts (60 minutes)
3. During cooldown, the adapter is skipped for review dispatch
4. After cooldown expires, the adapter is re-probed and cleared if available

### Checking Cooldown Status
Read \`<log_dir>/.execution_state\` and look at the \`unhealthy_adapters\` field:

\`\`\`json
{
  "unhealthy_adapters": {
    "claude": {
      "marked_at": "2025-01-15T10:30:00.000Z",
      "reason": "Usage limit exceeded"
    }
  }
}
\`\`\`

- \`marked_at\`: When the cooldown started (ISO 8601)
- Cooldown expires 60 minutes after \`marked_at\`

### All Adapters in Cooldown
If every configured adapter is in cooldown, review gates will fail with "no healthy adapters". Wait for the cooldown to expire or resolve the usage limit.

## \`cli.default_preference\` and Adapter Selection

The \`cli.default_preference\` array in \`config.yml\` determines:
1. **Which adapters are available** for review dispatch
2. **Selection order** for round-robin assignment

Review gates can override with \`cli_preference\` but those tools must also be in \`default_preference\`.

\`\`\`yaml
cli:
  default_preference:
    - claude
    - gemini
\`\`\`

## \`allow_tool_use\` and \`thinking_budget\` Settings

Per-adapter settings in \`config.yml\`:

\`\`\`yaml
cli:
  adapters:
    claude:
      allow_tool_use: true      # Whether the adapter can use tools during review
      thinking_budget: medium    # off, low, medium, high
\`\`\`

### \`thinking_budget\` Token Mapping

| Level | Claude | Codex | Gemini |
|-------|--------|-------|--------|
| \`off\` | 0 | minimal | 0 |
| \`low\` | 8,000 | low | 4,096 |
| \`medium\` | 16,000 | medium | 8,192 |
| \`high\` | 31,999 | high | 24,576 |

## \`.execution_state\` File

The \`.execution_state\` file in \`<log_dir>/\` tracks run context:

\`\`\`json
{
  "last_run_completed_at": "2025-01-15T10:30:00.000Z",
  "branch": "feature/my-branch",
  "commit": "abc123",
  "working_tree_ref": "def456",
  "unhealthy_adapters": {}
}
\`\`\`

| Field | Purpose |
|-------|---------|
| \`last_run_completed_at\` | When the last successful run finished |
| \`branch\` | Git branch at last completion |
| \`commit\` | HEAD SHA at last completion |
| \`working_tree_ref\` | Stash SHA of working tree (used for rerun diff scoping) |
| \`unhealthy_adapters\` | Map of adapter name to cooldown info |

This file is:
- Written after successful execution
- Preserved across runs
- Auto-cleaned when the branch changes or commit is merged
- Deleted by \`agent-gauntlet clean\`

## Troubleshooting Checklist

1. **Run \`agent-gauntlet health\`** to see overall adapter status
2. **Check \`.execution_state\`** for cooldown entries
3. **Verify \`cli.default_preference\`** includes the adapters you expect
4. **Try the CLI tool directly** (e.g., \`claude --version\`) to isolate the issue
5. **Check for usage limit messages** in review logs (\`review_*.log\`)
`,
		"ci-pr-troubleshooting.md": `# CI/PR Troubleshooting

## \`pr_push_required\`

Gates passed but the stop hook detected that a PR needs to be created or updated.

**When this happens:**
- \`auto_push_pr: true\` is set in \`stop_hook\` config
- Gates have passed
- No PR exists for the current branch, or the PR is out of date

**Resolution:**
1. Commit and push your changes
2. Create a PR: \`gh pr create\` or use \`/gauntlet-push-pr\`
3. The next stop-hook invocation will check PR/CI status instead of re-running gates

## CI Status Values

| Status | Message | Blocking? |
|--------|---------|-----------|
| \`ci_pending\` | CI checks still running | Yes — agent waits |
| \`ci_failed\` | CI failed or review changes requested | Yes — must fix |
| \`ci_passed\` | All checks completed, no blocking reviews | No — stop allowed |
| \`validation_required\` | Changes need validation | Yes — must validate |

## \`auto_push_pr\` and \`auto_fix_pr\` Configuration

\`\`\`yaml
stop_hook:
  auto_push_pr: true    # Check PR status after gates pass
  auto_fix_pr: true     # Wait for CI and enable fix workflow
\`\`\`

**Dependency:** \`auto_fix_pr\` requires \`auto_push_pr\`. If \`auto_fix_pr: true\` but \`auto_push_pr: false\`, \`auto_fix_pr\` is forced to \`false\` with a warning.

**Environment variable overrides:**
- \`GAUNTLET_AUTO_PUSH_PR=true/false\`
- \`GAUNTLET_AUTO_FIX_PR=true/false\`

## CI Wait Mechanism (\`wait-ci\`)

### How It Works
1. After gates pass and PR is pushed, the stop hook enters CI wait mode
2. It polls GitHub CI status using \`gh pr checks\`
3. Polls every **15 seconds** (default)
4. Times out after **270 seconds** (4.5 minutes, default)
5. Up to **3 attempts** total across stop-hook invocations

### Attempt Tracking
- File: \`<log_dir>/.ci-wait-attempts\`
- Incremented on each CI wait invocation
- When attempts >= 3: returns an error and allows the stop

### What \`wait-ci\` Checks

**CI Checks:**
- Runs \`gh pr checks --json name,state,link\`
- Check states: \`PENDING\`, \`QUEUED\`, \`IN_PROGRESS\`, \`SUCCESS\`, \`FAILURE\`
- All checks must reach \`SUCCESS\` for \`ci_passed\`

**Blocking Reviews:**
- Queries \`gh api repos/OWNER/REPO/pulls/PR_NUM/reviews\`
- \`CHANGES_REQUESTED\` state is blocking
- Latest review per author takes precedence (later reviews override earlier)
- If any author's latest review is \`CHANGES_REQUESTED\`: \`ci_failed\`

### Failed Check Logs
- For GitHub Actions: retrieves error output via \`gh run view RUN_ID --log-failed\`
- For external checks (no run ID): no logs available
- Output limited to last 100 lines

## CI Detection Environment Variables

The gauntlet detects CI environments using:

| Variable | Detection |
|----------|-----------|
| \`CI=true\` | Generic CI environment |
| \`GITHUB_ACTIONS=true\` | GitHub Actions specifically |
| \`GITHUB_BASE_REF\` | PR base branch in GitHub Actions (overrides \`base_branch\` for diff) |
| \`GITHUB_SHA\` | Commit SHA in GitHub Actions (used for diff calculation) |

**CI mode differences:**
- Diff uses \`GITHUB_BASE_REF...GITHUB_SHA\` instead of local branch comparison
- Falls back to \`HEAD^...HEAD\` if CI variables are incomplete

## Troubleshooting Checklist

### \`ci_pending\` — CI Still Running
1. Check \`gh pr checks\` to see which checks are still pending
2. Wait and try again — the stop hook will re-poll on next attempt
3. After 3 attempts, it will timeout and allow the stop

### \`ci_failed\` — CI Failed
1. Run \`gh pr checks\` to see failed checks
2. Run \`gh pr view --comments\` to see review feedback
3. Check for \`CHANGES_REQUESTED\` reviews: \`gh api repos/OWNER/REPO/pulls/PR_NUM/reviews\`
4. Fix the issues, commit, and push
5. The stop hook will re-check on next invocation

### PR-Related Issues
- **No PR for branch**: \`gh pr view\` returns an error — create a PR first
- **PR out of date**: Push latest changes before CI can pass
- **\`gh\` CLI not installed**: CI features require the GitHub CLI (\`gh\`)
`,
	};

	return { content, references };
}

const HELP_SKILL_BUNDLE = buildHelpSkillBundle();

/**
 * Skill definitions used by installCommands.
 * Each entry maps a skill action name to its content and metadata.
 */
const SKILL_DEFINITIONS = [
	{ action: "run", content: GAUNTLET_RUN_SKILL_CONTENT },
	{ action: "check", content: GAUNTLET_CHECK_SKILL_CONTENT },
	{ action: "push-pr", content: PUSH_PR_SKILL_CONTENT },
	{ action: "fix-pr", content: FIX_PR_SKILL_CONTENT },
	{ action: "status", content: GAUNTLET_STATUS_SKILL_CONTENT },
	{
		action: "help",
		content: HELP_SKILL_BUNDLE.content,
		references: HELP_SKILL_BUNDLE.references,
		skillsOnly: true,
	},
] as const;

type InstallLevel = "none" | "project" | "user";

interface InitOptions {
	yes?: boolean;
}

interface InitConfig {
	baseBranch: string;
	sourceDir: string;
	lintCmd: string | null; // null means not selected, empty string means selected but blank (TODO)
	testCmd: string | null; // null means not selected, empty string means selected but blank (TODO)
	selectedAdapters: CLIAdapter[];
}

export function registerInitCommand(program: Command): void {
	program
		.command("init")
		.description("Initialize .gauntlet configuration")
		.option(
			"-y, --yes",
			"Skip prompts and use defaults (all available CLIs, source: ., no extra checks)",
		)
		.action(async (options: InitOptions) => {
			const projectRoot = process.cwd();
			const targetDir = path.join(projectRoot, ".gauntlet");

			if (await exists(targetDir)) {
				console.log(chalk.yellow(".gauntlet directory already exists."));
				return;
			}

			// 1. CLI Detection
			console.log("Detecting available CLI agents...");
			const availableAdapters = await detectAvailableCLIs();

			if (availableAdapters.length === 0) {
				console.log();
				console.log(
					chalk.red("Error: No CLI agents found. Install at least one:"),
				);
				console.log(
					"  - Claude: https://docs.anthropic.com/en/docs/claude-code",
				);
				console.log("  - Gemini: https://github.com/google-gemini/gemini-cli");
				console.log("  - Codex: https://github.com/openai/codex");
				console.log();
				return;
			}

			let config: InitConfig;

			if (options.yes) {
				config = {
					baseBranch: "origin/main",
					sourceDir: ".",
					lintCmd: null,
					testCmd: null,
					selectedAdapters: availableAdapters,
				};
			} else {
				config = await promptForConfig(availableAdapters);
			}

			// Create base config structure
			await fs.mkdir(targetDir);
			await fs.mkdir(path.join(targetDir, "checks"));
			await fs.mkdir(path.join(targetDir, "reviews"));

			// 4. Commented Config Templates
			// Generate config.yml
			const configContent = generateConfigYml(config);
			await fs.writeFile(path.join(targetDir, "config.yml"), configContent);
			console.log(chalk.green("Created .gauntlet/config.yml"));

			// Generate check files if selected
			if (config.lintCmd !== null) {
				const lintContent = `name: lint
command: ${config.lintCmd || "# command: TODO - add your lint command (e.g., npm run lint)"}
# parallel: false
# run_in_ci: true
# run_locally: true
# timeout: 300
`;
				await fs.writeFile(
					path.join(targetDir, "checks", "lint.yml"),
					lintContent,
				);
				console.log(chalk.green("Created .gauntlet/checks/lint.yml"));
			}

			if (config.testCmd !== null) {
				const testContent = `name: unit-tests
command: ${config.testCmd || "# command: TODO - add your test command (e.g., npm test)"}
# parallel: false
# run_in_ci: true
# run_locally: true
# timeout: 300
`;
				await fs.writeFile(
					path.join(targetDir, "checks", "unit-tests.yml"),
					testContent,
				);
				console.log(chalk.green("Created .gauntlet/checks/unit-tests.yml"));
			}

			// 5. Default code review (YAML config referencing built-in prompt)
			const reviewYamlContent = `builtin: code-quality\nnum_reviews: 2\n`;
			await fs.writeFile(
				path.join(targetDir, "reviews", "code-quality.yml"),
				reviewYamlContent,
			);
			console.log(chalk.green("Created .gauntlet/reviews/code-quality.yml"));

			// Copy status script bundle into .gauntlet/
			await copyStatusScript(targetDir);

			// Build the commands list from skill definitions
			const commands: SkillCommand[] = SKILL_DEFINITIONS.map((skill) => ({
				action: skill.action,
				content: skill.content,
				...("references" in skill ? { references: skill.references } : {}),
				...("skillsOnly" in skill ? { skillsOnly: skill.skillsOnly } : {}),
			}));

			// Handle command installation
			if (options.yes) {
				// Default: install at project level for all selected agents (if they support it)
				const adaptersToInstall = config.selectedAdapters.filter(
					(a) =>
						a.getProjectCommandDir() !== null ||
						a.getProjectSkillDir() !== null,
				);
				if (adaptersToInstall.length > 0) {
					await installCommands({
						level: "project",
						agentNames: adaptersToInstall.map((a) => a.name),
						projectRoot,
						commands,
					});
				}
			} else {
				// Interactive prompts
				await promptAndInstallCommands({
					projectRoot,
					commands,
					availableAdapters,
				});
			}

			// Handle stop hook installation (only in interactive mode)
			if (!options.yes) {
				await promptAndInstallStopHook(projectRoot);
			}
		});
}

async function detectAvailableCLIs(): Promise<CLIAdapter[]> {
	const allAdapters = getAllAdapters();
	const available: CLIAdapter[] = [];

	for (const adapter of allAdapters) {
		const isAvailable = await adapter.isAvailable();
		if (isAvailable) {
			console.log(chalk.green(`  \u2713 ${adapter.name}`));
			available.push(adapter);
		} else {
			console.log(chalk.dim(`  \u2717 ${adapter.name} (not installed)`));
		}
	}
	return available;
}

async function promptForConfig(
	availableAdapters: CLIAdapter[],
): Promise<InitConfig> {
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	const question = makeQuestion(rl);

	try {
		// CLI Selection
		console.log();
		console.log("Which CLIs would you like to use?");
		availableAdapters.forEach((adapter, i) => {
			console.log(`  ${i + 1}) ${adapter.name}`);
		});
		console.log(`  ${availableAdapters.length + 1}) All`);

		let selectedAdapters: CLIAdapter[] = [];
		let attempts = 0;
		while (true) {
			attempts++;
			if (attempts > MAX_PROMPT_ATTEMPTS)
				throw new Error("Too many invalid attempts");
			const answer = await question(`(comma-separated, e.g., 1,2): `);
			const selections = answer
				.split(",")
				.map((s) => s.trim())
				.filter((s) => s);

			if (selections.length === 0) {
				selectedAdapters = availableAdapters;
				break;
			}

			const chosen = parseSelections(selections, availableAdapters);
			if (chosen) {
				selectedAdapters = chosen;
				break;
			}
		}

		// Base Branch
		console.log();
		const baseBranchInput = await question(
			"Enter your base branch (e.g., origin/main, origin/develop) [default: origin/main]: ",
		);
		const baseBranch = baseBranchInput || "origin/main";

		// Source Directory
		console.log();
		const sourceDirInput = await question(
			"Enter your source directory (e.g., src, lib, .) [default: .]: ",
		);
		const sourceDir = sourceDirInput || ".";

		// Lint Check
		console.log();
		const addLint = await question(
			"Would you like to add a linting check? [y/N]: ",
		);
		let lintCmd: string | null = null;
		if (addLint.toLowerCase().startsWith("y")) {
			lintCmd = await question("Enter lint command (blank to fill later): ");
		}

		// Unit Test Check
		console.log();
		const addTest = await question(
			"Would you like to add a unit test check? [y/N]: ",
		);
		let testCmd: string | null = null;
		if (addTest.toLowerCase().startsWith("y")) {
			testCmd = await question("Enter test command (blank to fill later): ");
		}

		rl.close();
		return {
			baseBranch,
			sourceDir,
			lintCmd,
			testCmd,
			selectedAdapters,
		};
	} catch (error) {
		rl.close();
		throw error;
	}
}

/**
 * Parse numeric selections into adapter list. Returns null if any selection is invalid.
 * Used by both CLI selection (returns adapters) and agent selection (caller maps to names).
 */
function parseSelections(
	selections: string[],
	adapters: CLIAdapter[],
): CLIAdapter[] | null {
	const chosen: CLIAdapter[] = [];
	for (const sel of selections) {
		const num = parseInt(sel, 10);
		if (Number.isNaN(num) || num < 1 || num > adapters.length + 1) {
			console.log(chalk.yellow(`Invalid selection: ${sel}`));
			return null;
		}
		if (num === adapters.length + 1) {
			chosen.push(...adapters);
		} else {
			const adapter = adapters[num - 1];
			if (adapter) chosen.push(adapter);
		}
	}
	return [...new Set(chosen)];
}

function buildAdapterSettings(adapters: CLIAdapter[]): string {
	const items = adapters.filter((a) => ADAPTER_CONFIG[a.name]);
	if (items.length === 0) return "";
	const lines = items.map((a) => {
		const c = ADAPTER_CONFIG[a.name];
		return `    ${a.name}:\n      allow_tool_use: ${c?.allow_tool_use}\n      thinking_budget: ${c?.thinking_budget}`;
	});
	return `\n  # Recommended settings (see docs/eval-results.md)\n  adapters:\n${lines.join("\n")}\n`;
}

function generateConfigYml(config: InitConfig): string {
	const cliList = config.selectedAdapters
		.map((a) => `    - ${a.name}`)
		.join("\n");
	const adapterSettings = buildAdapterSettings(config.selectedAdapters);
	let entryPoints = "";
	if (config.lintCmd !== null || config.testCmd !== null) {
		entryPoints += `  - path: "${config.sourceDir}"\n    checks:\n`;
		if (config.lintCmd !== null) entryPoints += `      - lint\n`;
		if (config.testCmd !== null) entryPoints += `      - unit-tests\n`;
	}
	entryPoints += `  - path: "."
    reviews:
      - code-quality`;

	return `base_branch: ${config.baseBranch}
log_dir: gauntlet_logs

# Run gates in parallel when possible (default: true)
# allow_parallel: true

cli:
  default_preference:
${cliList}
${adapterSettings}
entry_points:
${entryPoints}
`;
}

/**
 * Copy the status script bundle into .gauntlet/skills/gauntlet/status/scripts/.
 * The script is sourced from the package's src/scripts/status.ts.
 */
async function copyStatusScript(targetDir: string): Promise<void> {
	const statusScriptDir = path.join(
		targetDir,
		"skills",
		"gauntlet",
		"status",
		"scripts",
	);
	const statusScriptPath = path.join(statusScriptDir, "status.ts");
	await fs.mkdir(statusScriptDir, { recursive: true });

	if (await exists(statusScriptPath)) return;

	const bundledScript = path.join(
		path.dirname(new URL(import.meta.url).pathname),
		"..",
		"scripts",
		"status.ts",
	);
	if (await exists(bundledScript)) {
		await fs.copyFile(bundledScript, statusScriptPath);
		console.log(
			chalk.green("Created .gauntlet/skills/gauntlet/status/scripts/status.ts"),
		);
	} else {
		console.log(
			chalk.yellow(
				"Warning: bundled status script not found; /gauntlet-status may fail.",
			),
		);
	}
}

interface PromptAndInstallOptions {
	projectRoot: string;
	commands: SkillCommand[];
	availableAdapters: CLIAdapter[];
}

/**
 * Prompt the user to select an install level (none, project, user).
 */
async function promptInstallLevel(
	questionFn: (prompt: string) => Promise<string>,
): Promise<InstallLevel> {
	console.log("Where would you like to install the /gauntlet command?");
	console.log("  1) Don't install commands");
	console.log(
		"  2) Project level (in this repo's .claude/skills, .gemini/commands, etc.)",
	);
	console.log(
		"  3) User level (in ~/.claude/skills, ~/.gemini/commands, etc.)",
	);
	console.log();

	let answer = await questionFn("Select option [1-3]: ");
	let attempts = 0;

	while (true) {
		attempts++;
		if (attempts > MAX_PROMPT_ATTEMPTS)
			throw new Error("Too many invalid attempts");

		if (answer === "1") return "none";
		if (answer === "2") return "project";
		if (answer === "3") return "user";

		console.log(chalk.yellow("Please enter 1, 2, or 3"));
		answer = await questionFn("Select option [1-3]: ");
	}
}

/**
 * Prompt the user to select which agents to install commands for.
 * Returns the selected agent names (deduplicated).
 */
async function promptAgentSelection(
	questionFn: (prompt: string) => Promise<string>,
	installableAdapters: CLIAdapter[],
): Promise<string[]> {
	console.log();
	console.log("Which CLI agents would you like to install the command for?");
	installableAdapters.forEach((adapter, i) => {
		console.log(`  ${i + 1}) ${adapter.name}`);
	});
	console.log(`  ${installableAdapters.length + 1}) All of the above`);
	console.log();

	const promptText = `Select options (comma-separated, e.g., 1,2 or ${installableAdapters.length + 1} for all): `;
	let answer = await questionFn(promptText);
	let attempts = 0;

	while (true) {
		attempts++;
		if (attempts > MAX_PROMPT_ATTEMPTS)
			throw new Error("Too many invalid attempts");

		const selections = answer
			.split(",")
			.map((s) => s.trim())
			.filter((s) => s);

		if (selections.length === 0) {
			console.log(chalk.yellow("Please select at least one option"));
			answer = await questionFn(promptText);
			continue;
		}

		const chosen = parseSelections(selections, installableAdapters);
		if (chosen) return chosen.map((a) => a.name);

		answer = await questionFn(promptText);
	}
}

async function promptAndInstallCommands(
	options: PromptAndInstallOptions,
): Promise<void> {
	const { projectRoot, commands, availableAdapters } = options;
	if (availableAdapters.length === 0) return;

	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	const question = makeQuestion(rl);

	try {
		console.log();
		console.log(chalk.bold("CLI Agent Command Setup"));
		console.log(
			chalk.dim(
				"The gauntlet command can be installed for CLI agents so you can run /gauntlet directly.",
			),
		);
		console.log();

		const installLevel = await promptInstallLevel(question);

		if (installLevel === "none") {
			console.log(chalk.dim("\nSkipping command installation."));
			rl.close();
			return;
		}

		const installableAdapters =
			installLevel === "project"
				? availableAdapters.filter(
						(a) =>
							a.getProjectCommandDir() !== null ||
							a.getProjectSkillDir() !== null,
					)
				: availableAdapters.filter(
						(a) =>
							a.getUserCommandDir() !== null || a.getUserSkillDir() !== null,
					);

		if (installableAdapters.length === 0) {
			console.log(
				chalk.yellow(
					`No available agents support ${installLevel}-level commands.`,
				),
			);
			rl.close();
			return;
		}

		const selectedAgents = await promptAgentSelection(
			question,
			installableAdapters,
		);

		rl.close();

		await installCommands({
			level: installLevel,
			agentNames: selectedAgents,
			projectRoot,
			commands,
		});
	} catch (error: unknown) {
		rl.close();
		throw error;
	}
}

/**
 * A skill/command to be installed.
 */
interface SkillCommand {
	/** The skill action name (e.g., "run", "check", "push-pr"). */
	action: string;
	/** The Markdown content (with YAML frontmatter). */
	content: string;
	/** Optional reference files to install alongside SKILL.md (skills-only). */
	references?: Record<string, string>;
	/** If true, this skill is only installed for skills-capable adapters (not flat commands). */
	skillsOnly?: boolean;
}

interface InstallContext {
	isUserLevel: boolean;
	projectRoot: string;
}

interface InstallCommandsOptions {
	level: InstallLevel;
	agentNames: string[];
	projectRoot: string;
	commands: SkillCommand[];
}

/**
 * Install a single skill for Claude as a SKILL.md in a nested directory.
 */
async function installSkill(
	skillDir: string,
	ctx: InstallContext,
	command: SkillCommand,
): Promise<void> {
	const actionDir = path.join(skillDir, `gauntlet-${command.action}`);
	const skillPath = path.join(actionDir, "SKILL.md");

	await fs.mkdir(actionDir, { recursive: true });

	if (await exists(skillPath)) {
		const relPath = ctx.isUserLevel
			? skillPath
			: path.relative(ctx.projectRoot, skillPath);
		console.log(chalk.dim(`  claude: ${relPath} already exists, skipping`));
		return;
	}

	await fs.writeFile(skillPath, command.content);
	const relPath = ctx.isUserLevel
		? skillPath
		: path.relative(ctx.projectRoot, skillPath);
	console.log(chalk.green(`Created ${relPath}`));

	// Install reference files if present
	if (command.references) {
		const refsDir = path.join(actionDir, "references");
		await fs.mkdir(refsDir, { recursive: true });
		for (const [fileName, fileContent] of Object.entries(command.references)) {
			const refPath = path.join(refsDir, fileName);
			if (await exists(refPath)) continue;
			await fs.writeFile(refPath, fileContent);
			const refRelPath = ctx.isUserLevel
				? refPath
				: path.relative(ctx.projectRoot, refPath);
			console.log(chalk.green(`Created ${refRelPath}`));
		}
	}
}

/**
 * Install a single flat command file for a non-Claude adapter.
 * Uses the "gauntlet" name prefix for non-namespaced agents.
 */
async function installFlatCommand(
	adapter: CLIAdapter,
	commandDir: string,
	ctx: InstallContext,
	command: SkillCommand,
): Promise<void> {
	// Non-Claude agents get flat files named "gauntlet" (for run) or the action name
	const name = command.action === "run" ? "gauntlet" : command.action;
	const fileName = `${name}${adapter.getCommandExtension()}`;
	const filePath = path.join(commandDir, fileName);

	if (await exists(filePath)) {
		const relPath = ctx.isUserLevel
			? filePath
			: path.relative(ctx.projectRoot, filePath);
		console.log(
			chalk.dim(`  ${adapter.name}: ${relPath} already exists, skipping`),
		);
		return;
	}

	const transformedContent = adapter.transformCommand(command.content);
	await fs.writeFile(filePath, transformedContent);
	const relPath = ctx.isUserLevel
		? filePath
		: path.relative(ctx.projectRoot, filePath);
	console.log(chalk.green(`Created ${relPath}`));
}

/**
 * Install skills for a skills-capable adapter (e.g., Claude).
 */
async function installSkillsForAdapter(
	adapter: CLIAdapter,
	skillDir: string,
	ctx: InstallContext,
	commands: SkillCommand[],
): Promise<void> {
	const resolvedSkillDir = ctx.isUserLevel
		? skillDir
		: path.join(ctx.projectRoot, skillDir);
	try {
		for (const command of commands) {
			await installSkill(resolvedSkillDir, ctx, command);
		}
	} catch (error: unknown) {
		const err = error as { message?: string };
		console.log(
			chalk.yellow(
				`  ${adapter.name}: Could not create skill - ${err.message}`,
			),
		);
	}
}

/**
 * Install flat command files for a non-skills adapter.
 */
async function installFlatCommandsForAdapter(
	adapter: CLIAdapter,
	commandDir: string,
	ctx: InstallContext,
	commands: SkillCommand[],
): Promise<void> {
	const resolvedCommandDir = ctx.isUserLevel
		? commandDir
		: path.join(ctx.projectRoot, commandDir);
	try {
		await fs.mkdir(resolvedCommandDir, { recursive: true });
		// Non-Claude agents only get run, push-pr, and fix-pr (not check/status/help)
		const flatCommands = commands.filter(
			(c) => c.action !== "check" && c.action !== "status" && !c.skillsOnly,
		);
		for (const command of flatCommands) {
			await installFlatCommand(adapter, resolvedCommandDir, ctx, command);
		}
	} catch (error: unknown) {
		const err = error as { message?: string };
		console.log(
			chalk.yellow(
				`  ${adapter.name}: Could not create command - ${err.message}`,
			),
		);
	}
}

async function installCommands(options: InstallCommandsOptions): Promise<void> {
	const { level, agentNames, projectRoot, commands } = options;
	if (level === "none" || agentNames.length === 0) return;

	console.log();
	const allAdapters = getAllAdapters();

	const isUserLevel = level === "user";
	const ctx: InstallContext = { isUserLevel, projectRoot };

	for (const agentName of agentNames) {
		const adapter = allAdapters.find((a) => a.name === agentName);
		if (!adapter) continue;

		const skillDir = isUserLevel
			? adapter.getUserSkillDir()
			: adapter.getProjectSkillDir();

		if (skillDir) {
			await installSkillsForAdapter(adapter, skillDir, ctx, commands);
			continue;
		}

		const commandDir = isUserLevel
			? adapter.getUserCommandDir()
			: adapter.getProjectCommandDir();
		if (!commandDir) continue;

		await installFlatCommandsForAdapter(adapter, commandDir, ctx, commands);
	}
}

/**
 * The stop hook configuration for Claude Code.
 */
const STOP_HOOK_CONFIG = {
	hooks: {
		Stop: [
			{
				hooks: [
					{
						type: "command",
						command: "agent-gauntlet stop-hook",
						timeout: 300,
					},
				],
			},
		],
	},
};

/**
 * Check if running in an interactive TTY environment.
 */
function isInteractive(): boolean {
	return Boolean(process.stdin.isTTY);
}

/**
 * Prompt user to install the Claude Code stop hook.
 */
async function promptAndInstallStopHook(projectRoot: string): Promise<void> {
	// Skip in non-interactive mode
	if (!isInteractive()) {
		return;
	}

	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	const question = makeQuestion(rl);

	try {
		console.log();
		const answer = await question("Install Claude Code stop hook? (y/n): ");

		const shouldInstall =
			answer.toLowerCase() === "y" || answer.toLowerCase() === "yes";

		if (!shouldInstall) {
			rl.close();
			return;
		}

		rl.close();
		await installStopHook(projectRoot);
	} catch (error: unknown) {
		rl.close();
		throw error;
	}
}

/**
 * Install the stop hook configuration to .claude/settings.local.json.
 */
export async function installStopHook(projectRoot: string): Promise<void> {
	const claudeDir = path.join(projectRoot, ".claude");
	const settingsPath = path.join(claudeDir, "settings.local.json");

	// Ensure .claude directory exists
	await fs.mkdir(claudeDir, { recursive: true });

	let existingSettings: Record<string, unknown> = {};

	// Check if settings.local.json already exists
	if (await exists(settingsPath)) {
		try {
			const content = await fs.readFile(settingsPath, "utf-8");
			existingSettings = JSON.parse(content);
		} catch {
			// If parsing fails, start fresh
			existingSettings = {};
		}
	}

	// Merge hooks configuration
	const existingHooks =
		(existingSettings.hooks as Record<string, unknown>) || {};
	const existingStopHooks = Array.isArray(existingHooks.Stop)
		? existingHooks.Stop
		: [];

	// Check if stop hook already exists to avoid duplicates
	const hookExists = existingStopHooks.some((hook: unknown) =>
		(hook as { hooks?: { command?: string }[] })?.hooks?.some?.(
			(h) => h?.command === "agent-gauntlet stop-hook",
		),
	);
	if (hookExists) {
		console.log(chalk.dim("Stop hook already installed"));
		return;
	}

	// Add our stop hook to the existing Stop hooks
	const newStopHooks = [...existingStopHooks, ...STOP_HOOK_CONFIG.hooks.Stop];

	const mergedSettings = {
		...existingSettings,
		hooks: {
			...existingHooks,
			Stop: newStopHooks,
		},
	};

	// Write with pretty formatting
	await fs.writeFile(
		settingsPath,
		`${JSON.stringify(mergedSettings, null, 2)}\n`,
	);

	console.log(
		chalk.green(
			"Stop hook installed - gauntlet will run automatically when agent stops",
		),
	);
}
