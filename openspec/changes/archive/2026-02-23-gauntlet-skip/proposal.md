## Why

Gauntlet tracks a baseline (branch, commit, working tree) and diffs all changes since its last successful run. When making changes that don't need verification — docs, config tweaks, WIP code, or skill edits — there's no way to advance the baseline without running the full gate suite. This forces unnecessary verification cycles and causes future runs to accumulate stale diffs, wasting time and producing noise.

## What Changes

- Add an `agent-gauntlet skip` CLI subcommand that advances the execution state baseline to current HEAD + working tree without running any gates
- Add a `gauntlet-skip` skill (invocable as `/gauntlet-skip`) that calls the CLI command
- The skip command writes the same `.execution_state` file that a successful run would, so the next `agent-gauntlet run` only diffs against changes made after the skip

## Capabilities

### New Capabilities

- `skip-command`: CLI subcommand and skill that advances the gauntlet execution state baseline without running verification gates

### Modified Capabilities

_(none — this uses the existing `writeExecutionState()` mechanism without changing its behavior)_

## Impact

- **Code**: New subcommand handler in `src/commands/`, new skill in `skills/gauntlet-skip/`
- **Execution state**: No schema changes — reuses existing `writeExecutionState()` from `src/utils/execution-state.ts`
- **Existing behavior**: No changes to `run`, `clean`, or any other command. The skip command is purely additive.
