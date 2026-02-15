# Change: Log Rotation, Auto-Clean on Retry Limit, and Diff Scoping Fixes

## Why

The gauntlet has three log lifecycle gaps and two pre-existing bugs that affect diff scoping correctness:

1. When retry limit is exceeded, logs are NOT auto-archived. The agent (or stop hook) must manually run `agent-gauntlet clean`. This is the only termination state that requires manual cleanup.
2. Log rotation is 1-deep: `cleanLogs()` nukes `previous/` and replaces it. Only one generation of history is ever kept.
3. Manual `clean` deletes execution state, contradicting the spec and breaking post-clean fixBase resolution.
4. `shouldAutoClean()` preserves execution state when a merged commit's stash ref still exists in git. The spec says: always delete execution state on merge. This caused a split-brain where the review gate got an 85-file diff while gate selection only saw 2 files.
5. `ChangeDetector.getChangedFiles()` accepts `fixBase` in its options interface but never uses it. Gate selection and diff computation can disagree on the base ref.

## What Changes

- **Auto-clean on retry limit exceeded**: Add auto-clean in `run-executor.ts` when status is `retry_limit_exceeded`. Preserve execution state (don't delete it). Covers both `gauntlet-run` skill and stop hook paths since they both flow through `executeRun()`.
- **Configurable log rotation**: Add `max_previous_logs` config field (default: 3). Implement logrotate-style rotation: `previous/`, `previous.1/`, `previous.2/`, etc. Oldest beyond the configured count is evicted.
- **Bug fix: execution state not deleted on merge**: Fix `shouldAutoClean()` to always set `resetState: true` when commit is merged. Remove the conditional that preserves state when stash ref exists.
- **Bug fix: manual clean deletes execution state**: Remove `deleteExecutionState()` call from `clean.ts`. Spec says clean SHALL preserve execution state.
- **Bug fix: ChangeDetector ignores fixBase**: Add `fixBase` code path in `getChangedFiles()` so gate selection and diff computation agree on the same base ref.

## Alternatives Considered

- **Separate change packages**: The two features (auto-clean on retry limit, configurable rotation) and three bug fixes could be split into independent changes. Bundling was chosen because they share the same code paths (`cleanLogs()`, `performAutoClean()`, `shouldAutoClean()`) and the bug fixes are prerequisites for the features to work correctly (e.g., auto-clean on retry limit would preserve stale execution state without the merge-state fix).
- **Time-based log eviction**: Evict archived sessions older than N days instead of keeping a fixed count. Rejected because the gauntlet's session frequency varies widely (minutes during active development, weeks during idle periods), making count-based rotation more predictable and easier to reason about.
- **Symlink-based rotation**: Use a `current` symlink pointing to the active log directory, rotating by creating new directories and updating the symlink. Rejected because it adds filesystem complexity for no clear benefit — the current approach of moving files into `previous/` is simpler and already established.

## Impact

- Affected specs: `log-management`, `run-lifecycle`
- Affected code:
  - `src/core/run-executor.ts` — auto-clean on retry limit
  - `src/commands/shared.ts` — log rotation, merge state fix
  - `src/commands/clean.ts` — pass rotation count, remove state deletion
  - `src/config/schema.ts` — add `max_previous_logs` field
  - `src/core/change-detector.ts` — fixBase code path
- Affected skills: `gauntlet-run`, `gauntlet-status`, `gauntlet-help`
- Affected docs: `config-reference.md`, `user-guide.md`, `stop-hook-guide.md`, `skills-guide.md`
