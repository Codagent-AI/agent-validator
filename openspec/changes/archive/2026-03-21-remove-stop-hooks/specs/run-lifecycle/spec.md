## REMOVED Requirements

### Requirement: Run Interval Detection in Executor
**Reason**: Run interval checking existed solely to throttle the stop hook. With the stop hook removed, CLI commands always execute immediately (which was already the behavior for `run`, `check`, `review`).
**Migration**: N/A. The `checkInterval` option on `executeRun()` is removed. CLI commands were already not using it.

### Requirement: Interval Check Precedes Other Operations
**Reason**: Interval checking removed along with stop hook feature.
**Migration**: N/A.

## MODIFIED Requirements

### Requirement: CLI Commands Do Not Check Interval

CLI commands (`run`, `check`, `review`) SHALL always execute immediately without interval checking.

#### Scenario: Run command executes immediately
- **GIVEN** the user runs `agent-gauntlet run`
- **WHEN** the command executes
- **THEN** the gauntlet SHALL run immediately regardless of last run time
