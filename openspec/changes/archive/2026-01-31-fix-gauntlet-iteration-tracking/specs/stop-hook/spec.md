## ADDED Requirements

### Requirement: Debug Logging for Iteration Statistics

The debug logger's RUN_END entry MUST include accurate iteration statistics calculated from the actual run outcome, not hardcoded zeros.

#### Scenario: RUN_END logs accurate fixed count
- **GIVEN** a gauntlet run completes with some violations resolved
- **WHEN** the RUN_END entry is written to debug log
- **THEN** the `fixed` count SHALL reflect the actual number of violations that were fixed
- **AND** the count SHALL be calculated by comparing current violations against previous run's violations

#### Scenario: RUN_END logs accurate skipped count
- **GIVEN** a gauntlet run completes with some violations marked as skipped
- **WHEN** the RUN_END entry is written to debug log
- **THEN** the `skipped` count SHALL reflect the actual number of violations with status "skipped"
- **AND** the count SHALL be extracted from violation status fields in gate results

#### Scenario: RUN_END logs accurate failed count
- **GIVEN** a gauntlet run completes with remaining active violations
- **WHEN** the RUN_END entry is written to debug log
- **THEN** the `failed` count SHALL reflect the actual number of violations with status "new" or no status
- **AND** the count SHALL exclude violations marked as "fixed" or "skipped"

## ADDED Requirements

### Requirement: Stop Hook Stdout Purity

When the stop-hook command invokes `executeRun()`, all gauntlet log output MUST go to stderr (not stdout) to ensure stdout contains ONLY the JSON hook response. Any log output to stdout corrupts the hook protocol and prevents Claude Code from parsing the block decision.

#### Scenario: Log output uses stderr not stdout
- **GIVEN** the stop-hook command calls `executeRun()`
- **WHEN** the gauntlet runs gates and produces log output
- **THEN** all log messages SHALL be written to stderr via `console.error()`
- **AND** no log messages SHALL be written to stdout via `console.log()`
- **AND** log output SHALL still be captured to console.N.log file (console-log.ts captures both stdout and stderr)

#### Scenario: JSON-only stdout for hook response
- **GIVEN** the gauntlet completes (pass or fail)
- **WHEN** the stop-hook outputs its response
- **THEN** stdout SHALL contain ONLY valid JSON
- **AND** the JSON SHALL be parseable by Claude Code without pre-processing
- **AND** the first character of stdout SHALL be `{` (the start of JSON)

#### Scenario: Block decision is honored by Claude Code
- **GIVEN** stdout contains valid JSON with `decision: "block"`
- **WHEN** Claude Code reads the hook response
- **THEN** Claude Code SHALL block the stop and feed `reason` back as the next prompt
- **AND** the user SHALL see the hook is running/blocking

### Requirement: Diff Stats Scoped to Working Tree Reference

The `computeDiffStats()` function MUST respect the `fixBase` option to compute diff statistics scoped to changes since a specific git reference (stash or commit), rather than all uncommitted changes.

#### Scenario: fixBase option used for diff stats
- **GIVEN** the `fixBase` option is provided to `computeDiffStats()`
- **WHEN** diff statistics are computed
- **THEN** the system SHALL compute `git diff --numstat <fixBase>` for line counts
- **AND** the system SHALL compute `git diff --name-status <fixBase>` for file categorization
- **AND** the baseRef in the result SHALL be set to the fixBase value

#### Scenario: Untracked files scoped to fixBase snapshot
- **GIVEN** the `fixBase` option is provided
- **AND** there are untracked files in the working tree
- **WHEN** diff statistics are computed
- **THEN** the system SHALL compare current untracked files against files in the fixBase snapshot
- **AND** only files that are NEW since the fixBase SHALL be counted as new files

#### Scenario: Subsequent iteration shows incremental changes
- **GIVEN** iteration N completed and saved a working_tree_ref
- **AND** agent made fixes (let's say 20 lines changed)
- **WHEN** iteration N+1 starts with fixBase set to that working_tree_ref
- **THEN** the `lines_added` in RUN_START SHALL reflect only the 20 new lines
- **AND** the diff SHALL NOT include the original changes that existed at the end of iteration N

### Requirement: Child Process Debug Logging Suppression

Stop hook invocations from child Claude processes (indicated by GAUNTLET_STOP_HOOK_ACTIVE environment variable) MUST NOT write STOP_HOOK entries to the debug log.

#### Scenario: Child process skips debug logging
- **GIVEN** the GAUNTLET_STOP_HOOK_ACTIVE environment variable is set
- **WHEN** the stop-hook command executes
- **THEN** no STOP_HOOK entry SHALL be written to the debug log
- **AND** the command SHALL return "stop_hook_active" status immediately
- **AND** the rationale is that child process stop-hooks are redundant noise in the debug log
