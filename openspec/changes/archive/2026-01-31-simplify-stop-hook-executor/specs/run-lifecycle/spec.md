# run-lifecycle Spec Delta

## ADDED Requirements

### Requirement: Run Interval Detection in Executor

The run-executor MUST support optional interval-based run throttling via a `checkInterval` option. When enabled, the executor loads global config and checks the interval internally.

#### Scenario: checkInterval enabled and interval not elapsed
- **GIVEN** `executeRun()` is called with `checkInterval: true`
- **AND** global config has `stop_hook.run_interval_minutes: 10`
- **AND** the `.execution_state` file shows `last_run_completed_at` was 5 minutes ago
- **WHEN** the executor starts
- **THEN** it SHALL return `{ status: "interval_not_elapsed", message: "..." }` immediately
- **AND** it SHALL NOT acquire a lock
- **AND** it SHALL NOT run any gates

#### Scenario: checkInterval enabled and interval elapsed
- **GIVEN** `executeRun()` is called with `checkInterval: true`
- **AND** global config has `stop_hook.run_interval_minutes: 10`
- **AND** the `.execution_state` file shows `last_run_completed_at` was 15 minutes ago
- **WHEN** the executor starts
- **THEN** it SHALL proceed with normal execution (lock acquisition, auto-clean, gates)

#### Scenario: checkInterval not provided (default false)
- **GIVEN** `executeRun()` is called without `checkInterval`
- **WHEN** the executor starts
- **THEN** it SHALL skip interval checking entirely
- **AND** it SHALL NOT load global config for interval purposes
- **AND** it SHALL proceed with normal execution

#### Scenario: No execution state file with checkInterval enabled
- **GIVEN** `executeRun()` is called with `checkInterval: true`
- **AND** no `.execution_state` file exists
- **AND** the system cannot determine when the last run completed
- **WHEN** the executor starts
- **THEN** it SHALL treat this as "interval elapsed"
- **AND** it SHALL proceed with normal execution

#### Scenario: checkInterval enabled, interval elapsed - normal run proceeds
- **GIVEN** `executeRun()` is called with `checkInterval: true`
- **AND** the interval has elapsed
- **WHEN** the executor completes
- **THEN** the result SHALL reflect the actual gate outcomes (passed, failed, etc.)
- **AND** the interval check SHALL have no effect on the final status

### Requirement: CLI Commands Do Not Check Interval

CLI commands (`run`, `check`, `review`) SHALL always execute immediately without interval checking. They do not pass `checkInterval: true` to the executor.

#### Scenario: Run command executes immediately
- **GIVEN** the user runs `agent-gauntlet run`
- **WHEN** the command executes
- **THEN** it SHALL NOT pass `checkInterval: true` to `executeRun()`
- **AND** the gauntlet SHALL run immediately regardless of last run time

#### Scenario: Stop-hook passes checkInterval
- **GIVEN** the stop-hook is invoked
- **WHEN** the stop-hook calls `executeRun()`
- **THEN** it SHALL pass `checkInterval: true` to the executor
- **AND** the executor SHALL load global config to get `run_interval_minutes`

### Requirement: Interval Check Precedes Other Operations

When interval checking is enabled, the executor SHALL check interval before acquiring a lock or running auto-clean.

#### Scenario: Interval check precedes lock acquisition
- **GIVEN** `executeRun()` is called with `checkInterval: true`
- **WHEN** the interval has not elapsed
- **THEN** the executor SHALL return `interval_not_elapsed` immediately
- **AND** it SHALL NOT attempt to acquire the lock
- **AND** it SHALL NOT check for auto-clean conditions
- **AND** no side effects SHALL occur

#### Scenario: Interval check precedes auto-clean
- **GIVEN** `executeRun()` is called with `checkInterval: true`
- **AND** auto-clean would normally trigger (branch changed)
- **WHEN** the interval has not elapsed
- **THEN** the executor SHALL return `interval_not_elapsed`
- **AND** auto-clean SHALL NOT run
