# Log Rotation, Auto-Clean on Retry Limit, and Diff Scoping Fixes

## Problem Statement

The gauntlet has three log lifecycle gaps and two pre-existing bugs that affect diff scoping correctness:

**Gaps:**
1. When retry limit is exceeded, logs are NOT auto-archived. The agent (or stop hook) must manually run `agent-gauntlet clean`. This is the only termination state that requires manual cleanup.
2. Log rotation is 1-deep: `cleanLogs()` nukes `previous/` and replaces it. Only one generation of history is ever kept.
3. Manual `clean` deletes execution state, contradicting the spec and breaking post-clean fixBase resolution.

**Bugs:**
1. `shouldAutoClean()` preserves execution state when a merged commit's stash ref still exists in git. The spec says: always delete execution state on merge. This caused a split-brain where the review gate got an 85-file diff while gate selection only saw 2 files.
2. `ChangeDetector.getChangedFiles()` accepts `fixBase` in its options interface but never uses it. Gate selection and diff computation can disagree on the base ref.

**Goals:**
- Auto-archive logs on retry limit exceeded (preserve execution state)
- Configurable N-deep log rotation with logrotate-style naming
- Fix execution state lifecycle to match the spec
- Fix ChangeDetector to use fixBase when provided

## Design

### Auto-Clean on Retry Limit Exceeded

In `run-executor.ts`, the status determination (lines 553-562) already distinguishes `retry_limit_exceeded`. Currently only `status === "passed"` triggers auto-clean at line 565. The change:

- Add `retry_limit_exceeded` to the auto-clean condition
- Do NOT delete execution state — the `working_tree_ref` is still a valid baseline for the next session
- Log the auto-clean reason as `"retry_limit_exceeded"` to the debug log

This single change covers both the `gauntlet-run` skill and stop hook paths since they both flow through `executeRun()`.

The `retry_limit_exceeded` status message (line 214-215) currently says "run `agent-gauntlet clean` to archive and continue." Update to reflect that archiving is now automatic.

**Execution state behavior by termination status:**

| Status | Auto-clean logs? | Delete execution state? |
|--------|-----------------|------------------------|
| `passed` | Yes | No |
| `passed_with_warnings` | No | No |
| `failed` | No | No |
| `retry_limit_exceeded` | Yes (new) | No |

### Configurable Log Rotation

**Config field:** `max_previous_logs: 3` (default: 3) added to `gauntletConfigSchema` in `schema.ts`.

**Directory naming:** logrotate-style within the log directory:
- `previous/` — most recent archived session
- `previous.1/` — one older
- `previous.2/` — two older
- (up to `previous.{N-1}/` where N = `max_previous_logs`)

**Rotation algorithm in `cleanLogs()`:**

1. Delete `previous.{max-1}/` if it exists (evict the oldest)
2. Shift from highest to lowest to avoid clobbering:
   - `previous.{max-2}/` → `previous.{max-1}/`
   - ...
   - `previous.1/` → `previous.2/`
   - `previous/` → `previous.1/`
3. Create fresh `previous/`
4. Move current logs into `previous/`

With default `max_previous_logs: 3`: keep `previous/`, `previous.1/`, `previous.2/`. On clean, evict `previous.2/`, shift the rest, move current into `previous/`.

**Edge cases:**
- `max_previous_logs: 0` — delete current logs on clean, no archiving at all
- `max_previous_logs: 1` — single `previous/` directory (pre-existing behavior)
- Missing intermediate directories (e.g., `previous.1/` doesn't exist but `previous.2/` does) — skip the rename, no error

**Callers to update:**
- `cleanLogs()` signature: add `maxPreviousLogs` parameter (default 3)
- `clean.ts`: pass `config.project.max_previous_logs` to `cleanLogs()`
- `run-executor.ts`: pass `config.project.max_previous_logs` to both auto-clean call sites (passed, retry_limit_exceeded)

### Bug Fix: Execution State Not Deleted on Merge

In `shouldAutoClean()` (shared.ts lines 54-67), the "commit merged" branch currently checks whether `working_tree_ref` still exists in git. If it does, it sets `resetState: false`, preserving stale execution state. This contradicts the spec (run-lifecycle lines 426-431).

Fix: Always return `{ clean: true, reason: "commit merged", resetState: true }` when the commit is merged. Remove the `working_tree_ref` validity check entirely. The stash ref existing in git is irrelevant — after a merge, `baseBranch...HEAD` is the correct diff scope.

### Bug Fix: Manual Clean Deletes Execution State

In `clean.ts` line 41, `deleteExecutionState()` is called after `cleanLogs()`. The spec (run-lifecycle lines 413-417) says clean SHALL preserve execution state. This breaks post-clean fixBase resolution — the next run falls back to a full base branch diff instead of scoping to net-new changes.

Fix: Remove the `deleteExecutionState()` call from `clean.ts`. Execution state is only deleted by `performAutoClean()` when `resetState: true` (branch changed or commit merged).

### Bug Fix: ChangeDetector Ignores fixBase

In `change-detector.ts`, `getChangedFiles()` (lines 18-37) has no code path for `this.options.fixBase`. The `fixBase` field is declared in the interface (line 9) but never checked. This means gate selection uses `baseBranch...HEAD` while review gates use fixBase for their diff — a split brain.

Fix: Add a `fixBase` code path in `getChangedFiles()`, after the `commit` and `uncommitted` checks but before CI detection / local base branch diff. When `fixBase` is set and neither `commit` nor `uncommitted` is explicitly provided, diff against `fixBase` to get changed files. This ensures gate selection and diff computation agree.

The priority order in `getChangedFiles()` becomes:
1. `commit` (explicit CLI flag)
2. `uncommitted` (explicit CLI flag)
3. `fixBase` (from execution state — scopes to net-new changes)
4. CI detection / local base branch diff (default)

## Downstream Updates

### Skills

`gauntlet-run/SKILL.md` (line 39): Remove "Run `bun src/index.ts clean` to archive logs" from the retry limit exceeded bullet. Replace with: logs are auto-archived, do not retry.

`gauntlet-status/SKILL.md`: Add note that previous sessions are available in `previous/`, `previous.1/`, etc. within the log directory.

`gauntlet-help/SKILL.md`: Add `previous.N/` directories to the evidence sources table. Update config reference to include `max_previous_logs`. Update the `agent-gauntlet clean` CLI description to mention rotation.

### Specs

`run-lifecycle/spec.md`:
- Update "Beyond retry limit" scenario (line 109-115): Remove suggestion to run `agent-gauntlet clean`. Add scenario for auto-clean on retry limit exceeded with execution state preservation.
- Update "Auto-clean resets execution state on commit merged" scenario (line 426-431): Clarify that this is unconditional (no stash validity check).

`log-management/spec.md`:
- Update "Log Clean Process" requirement (lines 63-94): Add rotation behavior, `max_previous_logs` config, directory naming convention.
- Update "Clean with existing previous logs" scenario: Describe shift/evict instead of delete-all.

### Docs

`docs/config-reference.md`: Add `max_previous_logs` field with description and default. Add to example config.

`docs/user-guide.md`: Update `agent-gauntlet clean` description (line 188-190) to describe rotation into `previous/`, `previous.1/`, etc. with configurable depth.

`docs/stop-hook-guide.md`: Update three references to "requires `agent-gauntlet clean`" for retry limit exceeded (lines 163, 167, 283). Now auto-archived.

`docs/skills-guide.md`: Update gauntlet-run description (lines 60, 63) to reflect auto-archive on retry limit and remove manual clean step.

## Files Changed

| Category | Files |
|----------|-------|
| Feature: Auto-clean on retry limit | `src/core/run-executor.ts` |
| Feature: Log rotation | `src/config/schema.ts`, `src/commands/shared.ts`, `src/commands/clean.ts` |
| Bug fix: State not deleted on merge | `src/commands/shared.ts` |
| Bug fix: Manual clean deletes state | `src/commands/clean.ts` |
| Bug fix: ChangeDetector ignores fixBase | `src/core/change-detector.ts` |
| Skills | `.claude/skills/gauntlet-run/SKILL.md`, `.claude/skills/gauntlet-status/SKILL.md`, `.claude/skills/gauntlet-help/SKILL.md` |
| Specs | `openspec/specs/run-lifecycle/spec.md`, `openspec/specs/log-management/spec.md` |
| Docs | `docs/config-reference.md`, `docs/user-guide.md`, `docs/stop-hook-guide.md`, `docs/skills-guide.md` |
