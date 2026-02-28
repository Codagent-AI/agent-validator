---
name: gauntlet-help
description: Diagnose and explain gauntlet behavior using runtime evidence
allowed-tools: Bash, Read, Glob, Grep
---

# /gauntlet-help

Evidence-based diagnosis of gauntlet behavior. This skill is **diagnosis-only** — it explains what happened and why, but does not auto-fix issues. It operates from **runtime artifacts and CLI outputs**, not source code.

## Diagnostic Workflow

Follow this order for every diagnostic question:

1. **Resolve `log_dir`**: Read `.gauntlet/config.yml` and extract the `log_dir` field (default: `gauntlet_logs`). All log paths below are relative to `<log_dir>/`.
2. **Passive evidence first**: Read files before running commands.
   - `<log_dir>/.debug.log` — timestamped event log (commands, gate results, state changes, errors)
   - `<log_dir>/.execution_state` — JSON with `last_run_completed_at`, `branch`, `commit`, `working_tree_ref`, and `unhealthy_adapters` (adapter name → `{marked_at, reason}`)
   - `<log_dir>/console.*.log` — console output per run (highest number = latest)
   - `<log_dir>/check_*.log` — check gate output
   - `<log_dir>/review_*.json` — review gate results with violations (`file`, `line`, `issue`, `fix`, `priority`, `status`)
   - `.gauntlet/config.yml` — project configuration
3. **Active evidence when needed**: Run CLI commands only when passive evidence is insufficient for a confident diagnosis.
4. **Explain with evidence**: Clearly distinguish confirmed findings from inference.

## Evidence Sources

| Source | What It Confirms |
|--------|-----------------|
| `.gauntlet/config.yml` | `log_dir`, `base_branch`, `entry_points`, `cli.default_preference`, `stop_hook` settings, `max_retries`, `rerun_new_issue_threshold` |
| `<log_dir>/.debug.log` | Timestamped event history: commands executed, gate results, state transitions, errors |
| `<log_dir>/.execution_state` | Last successful run timestamp, branch/commit at that time, working tree stash ref, unhealthy adapter cooldowns |
| `<log_dir>/console.*.log` | Human-readable output from each run iteration |
| `<log_dir>/check_*.log` | Raw output from check gate commands (linters, test runners, etc.) |
| `<log_dir>/review_*.json` | Structured review violations with file, line, issue, priority, and resolution status |
| `<log_dir>/.gauntlet-run.lock` | Lock file (contains PID) — present only during active execution |
| `<log_dir>/.stop-hook-active` | Marker file (contains PID) — present only during active stop-hook execution |
| `<log_dir>/.ci-wait-attempts` | CI wait attempt counter |

## CLI Command Quick-Reference

Use these only when passive evidence is insufficient:

| Command | When to Use |
|---------|-------------|
| `agent-gauntlet list` | See configured gates and entry points |
| `agent-gauntlet health` | Check adapter availability and health status |
| `agent-gauntlet detect` | See which files changed and which gates would apply |
| `agent-gauntlet validate` | Validate config.yml syntax and schema |
| `agent-gauntlet clean` | Archive current logs and reset state (destructive — confirm with user first) |

## Routing Logic

Based on the user's question, load the appropriate reference file for detailed guidance:

| Question Domain | Reference File |
|----------------|---------------|
| Stop hook blocked/allowed, hook statuses, recursion, timing | `references/stop-hook-troubleshooting.md` |
| Missing config, YAML errors, misconfiguration, init problems | `references/config-troubleshooting.md` |
| Check failures, review failures, no_changes, no_applicable_gates, rerun mode | `references/gate-troubleshooting.md` |
| Lock conflict, stale locks, parallel runs, cleanup | `references/lock-troubleshooting.md` |
| Adapter health, missing tools, usage limits, cooldown | `references/adapter-troubleshooting.md` |

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
- `.debug.log` or `.execution_state` is missing or empty
- Log files referenced in output don't exist
- Config values can't be verified
- CLI commands fail or return unexpected output

### Next Steps
Actionable recommendations for the user. If confidence is not high, suggest what additional evidence would confirm the diagnosis.

## Bug Filing

After completing your diagnosis, apply the following routing logic to determine whether to file a GitHub issue:

- **High confidence + bug indicated** (evidence points to a defect in agent-gauntlet, not a configuration issue, user error, or expected behavior): Automatically invoke `gauntlet-issue` with `--auto-file <diagnosis summary>` as arguments. This passes the diagnosis summary as the bug description and skips the interactive confirmation — the issue is filed immediately after showing the draft.
- **High confidence + not a bug** (diagnosis concludes configuration issue, user error, or expected behavior): Do nothing. Do not invoke `gauntlet-issue`.
- **Medium confidence + possible bug** (evidence suggests a possible gauntlet defect but is not conclusive): Ask the user: "This may be a gauntlet bug. Want me to file a GitHub issue?" If the user confirms, invoke `gauntlet-issue` with the diagnosis summary as the bug description. If the user declines, exit without filing.
- **Low confidence**: Do nothing. Do not prompt the user and do not invoke `gauntlet-issue`.
