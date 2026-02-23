## Context

Gauntlet tracks a baseline in `gauntlet_logs/.execution_state` (branch, commit SHA, working tree ref). Each run diffs against this baseline. There's no way to advance the baseline without running the full gate suite, forcing unnecessary verification when changes don't need it.

## Goals / Non-Goals

**Goals:**
- Allow users to advance the gauntlet execution state baseline without running gates
- Archive existing logs when skipping (clean slate, consistent with post-successful-run behavior)
- Follow the existing pattern: CLI command + thin skill wrapper

**Non-Goals:**
- Selective skipping (skip specific gates but run others)
- Undo/rollback of a skip
- Any changes to how `writeExecutionState` or `cleanLogs` work

## Decisions

**Thin CLI command + skill wrapper.** The `agent-gauntlet skip` subcommand calls `cleanLogs()` then `writeExecutionState()`. The `/gauntlet-skip` skill invokes the CLI command. This mirrors how `gauntlet-run` skill calls `agent-gauntlet run`, keeping the CLI as the source of truth for all state operations.

**No flags or options.** The command always operates on the current working tree state. No need for `--base-branch`, `--commit`, etc. — the purpose is to snapshot "now" as the baseline.

**Clean logs before advancing state.** Archiving logs prevents stale log files from triggering rerun mode on the next real run.

## Risks / Trade-offs

- **Misuse risk**: Users could skip verification on code that needs it. Mitigated by: this is an intentional user action, not automated. The skill name makes the intent clear.
- **Lost log context**: Cleaning logs means any in-progress failure context is archived. Acceptable — if you're skipping, you're explicitly saying those failures don't matter for the current baseline.

## Migration Plan

Purely additive. No migration needed. New CLI subcommand and skill; no changes to existing commands or behavior.

## Open Questions

None — design is straightforward.
