# stop-hook Spec Delta

## REMOVED Requirements

### Requirement: Stop Hook Lock Pre-Check

The stop-hook command previously checked if the lock file exists before invoking the run executor. This requirement is removed.

**Rationale:** Lock checking is now handled entirely by the run-executor. The stop-hook delegates to the executor, which returns `lock_conflict` status if the lock cannot be acquired. This eliminates duplicate lock-checking logic.

**Migration:** Callers now receive `lock_conflict` status from `executeRun()` instead of the stop-hook pre-checking the lock file. No external API changes; internal simplification only.

## MODIFIED Requirements

### Requirement: Infinite Loop Prevention

The command MUST check for infinite loop conditions in a specific order to optimize for fast exit.

#### Scenario: Environment variable check before stdin
- **GIVEN** the stop-hook command starts
- **WHEN** `GAUNTLET_STOP_HOOK_ACTIVE_ENV` environment variable is set
- **THEN** it SHALL output `stop_hook_active` response immediately
- **AND** it SHALL NOT read from stdin
- **AND** it SHALL NOT parse any JSON input
- **AND** this allows child Claude processes to exit without waiting for stdin timeout

#### Scenario: Input flag check after stdin
- **GIVEN** the environment variable is not set
- **AND** the stop-hook parses stdin JSON
- **WHEN** the input has `stop_hook_active: true`
- **THEN** it SHALL output `stop_hook_active` response
- **AND** it SHALL NOT proceed to config detection or gauntlet execution

### Requirement: Gauntlet Execution

The command SHALL invoke the gauntlet run logic directly as a function call, passing `checkInterval: true` to enable interval checking in the executor.

#### Scenario: Direct function invocation with checkInterval
- **GIVEN** the stop-hook determines gauntlet should run
- **WHEN** it executes the gauntlet
- **THEN** it SHALL call `executeRun({ cwd, checkInterval: true })` directly
- **AND** it SHALL NOT load global config (executor does this)
- **AND** it SHALL NOT pre-check lock file (executor handles this)
- **AND** it SHALL NOT pre-check interval (executor handles this)
- **AND** it SHALL receive a structured `RunResult` object

#### Scenario: Executor returns interval_not_elapsed
- **GIVEN** the executor determines interval has not elapsed
- **WHEN** `executeRun()` returns `{ status: "interval_not_elapsed" }`
- **THEN** the stop-hook SHALL output an approve response with that status
- **AND** the stop-hook SHALL NOT contain interval-checking logic itself

#### Scenario: Executor returns lock_conflict
- **GIVEN** the executor cannot acquire the lock
- **WHEN** `executeRun()` returns `{ status: "lock_conflict" }`
- **THEN** the stop-hook SHALL output an approve response with that status
- **AND** the stop-hook SHALL NOT contain lock-checking logic itself

---

## ADDED Requirements

### Requirement: Simplified Stop Hook Flow

The stop-hook command SHALL be a thin adapter that transforms between Claude Code hook protocol and the run-executor. It performs minimal pre-checks before delegating to the executor.

#### Scenario: Execution order
- **GIVEN** the stop-hook receives a stop event
- **WHEN** it processes the event
- **THEN** it SHALL execute checks in this order:
  1. Check `GAUNTLET_STOP_HOOK_ACTIVE_ENV` environment variable
  2. Parse stdin JSON
  3. Check `stop_hook_active` flag from input
  4. Check for `.gauntlet/config.yml` presence
  5. Call `executeRun({ cwd, checkInterval: true })`
- **AND** all other checks (lock, interval) SHALL be delegated to the executor

#### Scenario: No duplicate utility functions
- **GIVEN** the stop-hook implementation
- **WHEN** it needs the console log path for error messages
- **THEN** it SHALL use the value from `RunResult.consoleLogPath` returned by the executor
- **AND** it SHALL NOT define its own `findLatestConsoleLog()` implementation

#### Scenario: No global config loading
- **GIVEN** the stop-hook needs interval checking
- **WHEN** it calls the executor
- **THEN** it SHALL pass `checkInterval: true`
- **AND** it SHALL NOT load global config itself
- **AND** the executor SHALL be responsible for loading global config when needed
