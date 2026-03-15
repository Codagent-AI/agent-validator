## Why

Agent-gauntlet's current output is designed for an LLM skill running inside the same Claude session — it writes human-readable summaries to stderr and relies on subagents to parse log files and update review JSON. This doesn't work when gauntlet is orchestrated externally by baton, where the output is captured from a shell step and passed as text to a separate headless agent. The captured output is empty (stderr vs stdout mismatch), lacks failure details, and the receiving agent has no instructions for how to act on it.

## What Changes

- Add `--report` flag to `agent-gauntlet run` that writes a self-contained, agent-actionable failure report to stdout (stderr continues unchanged for human watchers)
- Add `agent-gauntlet update-review list` subcommand to enumerate pending review violations with stable numeric IDs
- Add `agent-gauntlet update-review fix <id> "reason"` subcommand to mark a violation as fixed
- Add `agent-gauntlet update-review skip <id> "reason"` subcommand to mark a violation as skipped
- Update the `run-gauntlet.yaml` baton workflow with the new flags and an effective fix-violations prompt

## Capabilities

### New Capabilities

- `report-flag`: `--report` flag on `agent-gauntlet run` that writes a failure report to stdout containing check metadata (gate label, command, working directory, fix instructions, log path) and review violations with numeric IDs. The report does not parse check log error output (the agent reads logs directly) and does not include agent instructions (those live in the baton workflow prompt).
- `review-decisions`: `agent-gauntlet update-review list|fix|skip` subcommands for deterministically enumerating and updating review violation status by numeric ID, replacing the current LLM subagent approach

### Modified Capabilities

- `run-lifecycle`: The `run` command gains the `--report` flag; no changes to existing behavior when the flag is absent

## Impact

- `src/commands/run.ts` — add `--report` option
- New `src/commands/update-review.ts` — `update-review list|fix|skip` subcommands (separate from existing `review` gate runner command)
- New `src/output/report.ts` — report generator producing plain text from GateResult data and enumerated violations
- `src/gates/result.ts` — add `command` and `workingDirectory` fields to `GateResult`
- `src/gates/check.ts` — populate `command` and `workingDirectory` on `GateResult` during execution
- New `src/utils/violation-enumerator.ts` — shared enumeration logic for assigning stable numeric IDs to review violations across JSON files
- `workflows/run-gauntlet.yaml` in the baton project — updated to use `--report` and the new prompt
