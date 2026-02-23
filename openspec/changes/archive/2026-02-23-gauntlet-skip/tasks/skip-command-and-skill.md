# Task: Skip CLI command and skill

## Goal

Add an `agent-gauntlet skip` CLI subcommand and a `/gauntlet-skip` skill that advance the gauntlet execution state baseline to the current working tree without running any verification gates. This lets users acknowledge current changes so the next `agent-gauntlet run` only diffs against changes made after the skip.

## Background

You MUST read these files before starting:
- `design.md` for the full design rationale and decisions
- `specs/skip-command/spec.md` for all acceptance criteria

Gauntlet tracks a baseline in `gauntlet_logs/.execution_state` (branch, commit SHA, working tree ref via `git stash create`). Each run diffs against this baseline. The skip command advances this baseline without running gates — same end state as a successful run.

**Key files to modify:**
- `src/commands/skip.ts` — create new file, following the pattern in `src/commands/clean.ts`
- `src/commands/index.ts` — add `registerSkipCommand` export
- `src/index.ts` — import and call `registerSkipCommand(program)`
- `skills/gauntlet-skip/SKILL.md` — create new skill file, following the pattern in `skills/gauntlet-status/SKILL.md`

**Key files to understand (read-only):**
- `src/commands/clean.ts` — the closest existing command pattern to follow (config loading, debug logger init, lock acquisition, `cleanLogs()` call)
- `src/utils/execution-state.ts` — `writeExecutionState(logDir)` writes `.execution_state` with current branch/commit/working-tree-ref and preserves `unhealthy_adapters`; `getCurrentCommit()` returns the full SHA
- `src/commands/shared.ts` — `cleanLogs(logDir, maxPreviousLogs)` archives log files; `acquireLock(logDir)` / `releaseLock(logDir)` prevent concurrent execution

**Implementation details:**
- The `skip.ts` command handler should: load config, init debug logger, acquire lock, call `cleanLogs()`, call `writeExecutionState()`, print confirmation with abbreviated commit SHA (first 7 chars of `getCurrentCommit()`), release lock, exit 0.
- On error: release lock if acquired, print error message, exit 1.
- No flags or options — the command always snapshots "now".
- The skill SKILL.md should be minimal: run `agent-gauntlet skip` and report the output. Set `disable-model-invocation: true` and `allowed-tools: Bash`.

## Done When

- `agent-gauntlet skip` creates the log directory and writes `.execution_state` when no prior state exists (exit 0)
- `agent-gauntlet skip` archives existing logs and overwrites `.execution_state` when prior state and logs exist (exit 0)
- `agent-gauntlet skip` preserves `unhealthy_adapters` entries from existing `.execution_state`
- `agent-gauntlet skip` prints a confirmation message including the abbreviated commit SHA
- `agent-gauntlet skip` exits non-zero with an error message when another gauntlet process holds the lock, without modifying state or logs
- `agent-gauntlet skip` exits non-zero with an error message when run outside a git repository
- `/gauntlet-skip` skill executes `agent-gauntlet skip` and reports the command output
