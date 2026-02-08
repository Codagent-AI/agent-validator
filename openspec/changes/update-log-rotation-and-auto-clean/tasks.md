## 0. Pre-factoring

No hotspots modified. All affected files score above 8.5:
- `src/commands/shared.ts`: 9.53
- `src/core/run-executor.ts`: 8.67
- `src/core/change-detector.ts`: 10.0
- `src/commands/clean.ts`: 10.0
- `src/config/schema.ts`: 10.0

## 1. Implementation

- [x] 1.1 Add `max_previous_logs` field to `gauntletConfigSchema` in `src/config/schema.ts` (default: 3)
- [x] 1.2 Update `cleanLogs()` in `src/commands/shared.ts` to accept `maxPreviousLogs` parameter and implement logrotate-style rotation (`previous/`, `previous.1/`, `previous.2/`, etc.)
- [x] 1.3 Fix `shouldAutoClean()` in `src/commands/shared.ts`: always return `resetState: true` when commit is merged (remove working_tree_ref validity check)
- [x] 1.4 Fix `clean.ts`: remove `deleteExecutionState()` call, pass `max_previous_logs` from config to `cleanLogs()`
- [x] 1.5 Add auto-clean on `retry_limit_exceeded` in `run-executor.ts` (preserve execution state, pass `max_previous_logs` to `cleanLogs()`)
- [x] 1.6 Update `retry_limit_exceeded` status message in `run-executor.ts` to reflect automatic archiving
- [x] 1.7 Pass `max_previous_logs` from config to `cleanLogs()` at the existing `passed` auto-clean call site in `run-executor.ts`
- [x] 1.8 Fix `ChangeDetector.getChangedFiles()` in `src/core/change-detector.ts`: add `fixBase` code path after `commit`/`uncommitted` checks but before CI detection / base branch diff (priority: commit > uncommitted > fixBase > default)
- [x] 1.9 Verify post-clean fixBase resolution logic in `run-executor.ts` handles all fallback paths: valid `working_tree_ref`, garbage-collected `working_tree_ref` (fall back to `commit`), merged commit (no fixBase), and no execution state (first-run mode). This logic already exists via `resolveFixBase()` — verify it matches the updated spec.
- [x] 1.10 Verify `resolveFixBase()` in `execution-state.ts` uses `git cat-file -t <sha>` for git object existence checks (already implemented — confirm alignment with spec)

## 2. Tests

- [x] 2.1 Test `cleanLogs()` rotation: verifies shift/evict with `max_previous_logs: 3`
- [x] 2.2 Test `cleanLogs()` with `max_previous_logs: 0` (no archiving, delete current logs)
- [x] 2.3 Test `cleanLogs()` with `max_previous_logs: 1` (single `previous/` directory, pre-existing behavior)
- [x] 2.4 Test `cleanLogs()` with missing intermediate directories (skip rename, no error)
- [x] 2.5 Test `shouldAutoClean()` always returns `resetState: true` on commit merged
- [x] 2.6 Test `ChangeDetector.getChangedFiles()` uses fixBase when provided (no explicit commit/uncommitted)
- [x] 2.7 Test `ChangeDetector.getChangedFiles()` explicit `commit` flag overrides fixBase
- [x] 2.8 Test `ChangeDetector.getChangedFiles()` explicit `uncommitted` flag overrides fixBase
- [x] 2.9 Test `executeRun` calls `cleanLogs` with configured `max_previous_logs` on `retry_limit_exceeded` and preserves `.execution_state`
- [x] 2.10 Test manual clean (`clean.ts`) preserves `.execution_state` after removing `deleteExecutionState()` call
- [x] 2.11 Test post-clean fixBase fallback: valid `working_tree_ref` is used as fixBase
- [x] 2.12 Test post-clean fixBase fallback: garbage-collected `working_tree_ref` falls back to `commit` with console warning
- [x] 2.13 Test post-clean fixBase fallback: merged commit results in no fixBase (base branch diff)

## 3. Docs and Skills

- [ ] 3.1 Update `gauntlet-run/SKILL.md`: remove manual clean on retry limit exceeded
- [ ] 3.2 Update `gauntlet-status/SKILL.md`: document `previous.N/` directories
- [ ] 3.3 Update `gauntlet-help/SKILL.md`: add `previous.N/` to evidence sources, add `max_previous_logs` to config reference
- [ ] 3.4 Update `docs/config-reference.md`: add `max_previous_logs` field and update example
- [ ] 3.5 Update `docs/user-guide.md`: update `agent-gauntlet clean` description for rotation
- [ ] 3.6 Update `docs/stop-hook-guide.md`: remove "requires clean" from retry limit references
- [ ] 3.7 Update `docs/skills-guide.md`: update gauntlet-run description

## 4. Validation

If there is a "Manual Verification" section above, complete all verification steps before marking the task complete.

### Manual Verification

- [ ] 4.1 Run `bun src/index.ts clean` three times with `max_previous_logs: 3` and verify `previous/`, `previous.1/`, `previous.2/` directories are created with correct rotation (oldest evicted, others shifted)
- [ ] 4.2 Trigger `retry_limit_exceeded` (set `max_retries: 0` temporarily) and verify logs are auto-archived and `.execution_state` is preserved
- [ ] 4.3 Run `bun src/index.ts clean` manually and verify `.execution_state` is preserved (not deleted)
- [ ] 4.4 Verify fixBase scoping: after a clean with valid execution state, confirm gate selection and diff computation both use the same fixBase ref

When work is completed, a stop hook should execute the full gauntlet of verification tasks and give direction on what needs to be fixed.
