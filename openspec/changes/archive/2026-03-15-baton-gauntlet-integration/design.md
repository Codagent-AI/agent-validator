## Context

Agent-gauntlet currently writes all console output to stderr (to keep stdout clean for the stop-hook JSON protocol). When orchestrated by baton, shell step capture only captures stdout, so the gauntlet output is empty. The fix agent also needs structured failure data and clear instructions to act autonomously within a retry loop.

The current gauntlet-run skill uses LLM subagents to parse log files and update review JSON. These operations are deterministic and should be CLI commands instead.

## Goals / Non-Goals

**Goals:**
- `--report` flag on `agent-gauntlet run` that writes a plain-text failure report to stdout
- `agent-gauntlet update-review list|fix|skip` commands for managing review violations by numeric ID
- Updated `run-gauntlet.yaml` baton workflow that uses these features
- Report written to file as fallback for environments where stdout is lost

**Non-Goals:**
- Changing existing stderr output or ConsoleReporter behavior
- Adding `--report` to `check` or `review` commands
- Changing exit code semantics
- Parsing check log error output into the report (agent reads logs directly)

## Decisions

### Report generation happens inside executeRun

The `--report` flag is passed through `ExecuteRunOptions`. Report generation happens in `buildRunResult` before log cleanup (which archives logs on pass/retry_limit_exceeded). The report string is stored in `RunResult.reportText` and `run.ts` writes it to stdout.

This avoids the timing problem where logs are archived before the report can read them.

### Check failures include metadata only, not parsed errors

The report includes the gate label, command, working directory, fix instructions, fix skill, and log file path. It does NOT parse or summarize error output from check logs. The agent reads the full log file directly when it needs error details. This keeps the report generator simple and avoids lossy summarization of arbitrary tool output.

Command and working directory need to be available from `GateResult` at report generation time. Two options:
- Add `command` and `workingDirectory` fields to `GateResult` (set during check execution)
- Parse them from the log file using regex on the structured markers gauntlet writes

Adding fields to `GateResult` is cleaner — the data is available at execution time and avoids re-reading files.

### Review violations are enumerated deterministically

A shared `enumerateViolations(logDir)` function scans JSON files (sorted by filename), collects violations with `status: "new"`, assigns sequential IDs from 1. This function is used by both the report generator and `update-review` commands, ensuring ID consistency.

### update-review is a new top-level command

Separate from the existing `review` command (which runs review gates). Registered as `update-review` with `list`, `fix`, `skip` subcommands via commander.

### Report output is plain text with no ANSI codes

Consistent with the convention that stdout is for machine-readable output. Uses `process.stdout.write()` directly, no chalk.

### Agent instructions live in the baton workflow, not in the report

The report is pure data. The baton workflow prompt provides the static instructions (medium-trust guidance, how to use `update-review`, instruction to re-run check commands). This avoids regenerating instructions every run and keeps them in the highest-attention position of the prompt.

## File Changes

### New files
- `src/utils/violation-enumerator.ts` — shared enumeration: scan JSON files, assign IDs to `status: "new"` violations
- `src/output/report.ts` — report generator: takes `GateResult[]` + log dir, produces plain text string
- `src/commands/update-review.ts` — `update-review list|fix|skip` command registration

### Modified files
- `src/commands/run.ts` — add `--report` option, write `result.reportText` to stdout
- `src/commands/index.ts` — register `update-review` command
- `src/core/run-executor.ts` — add `report` to `ExecuteRunOptions`
- `src/core/run-executor-helpers.ts` — in `buildRunResult`, generate report before cleanup when `options.report` is true, write `report.txt` to log dir, include in `RunResult`
- `src/types/gauntlet-status.ts` — add `reportText?: string` to `RunResult`
- `src/gates/result.ts` — add `command?: string` and `workingDirectory?: string` to `GateResult`
- `src/gates/check.ts` — populate `command` and `workingDirectory` on `GateResult`

### Baton project (separate repo)
- `workflows/run-gauntlet.yaml` — updated workflow with `--report` flag and fix-violations prompt

## Data Flow

```
run.ts --report
  → executeRun({ report: true })
    → runner.run(jobs) → GateResult[] (with command/workingDirectory on checks)
    → buildRunResult()
      → generateReport(gateResults, logDir)
        → enumerateViolations(logDir)  // shared with update-review
        → format plain text from GateResult fields + enumerated violations
      → write report.txt to logDir
      → cleanLogs() if applicable
      → return RunResult { reportText }
  → process.stdout.write(result.reportText)
  → process.exit(code)
```

## Risks / Trade-offs

- **RunResult coupling**: Adding `reportText` to `RunResult` mixes output concerns with result data. Acceptable — it's optional and only populated when `--report` is set.
- **Report size**: A review with many violations could produce a large report that inflates the agent's prompt. Mitigated by the baton workflow's retry loop (violations get fixed/skipped each iteration) and the fact that review adapters typically produce bounded violation counts.
- **ID stability**: Numeric IDs are stable only within a log session (between runs). If the agent calls `update-review fix 3` after a gauntlet re-run has changed the JSON files, the ID may point to a different violation. Mitigated by the baton workflow structure: `update-review` is called in the same loop iteration as the report, before re-running gauntlet.

## Migration Plan

No migration needed. The `--report` flag is additive (off by default). The `update-review` command is new. The baton workflow is a new file. No breaking changes to existing behavior.

## Open Questions

None — all architectural decisions resolved during design conversation.
