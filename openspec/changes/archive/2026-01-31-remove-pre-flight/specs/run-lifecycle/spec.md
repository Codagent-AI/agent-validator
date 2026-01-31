## ADDED Requirements

### Requirement: Adapter Health Tracking in Execution State
The execution state file (`.execution_state`) MUST support an optional `unhealthy_adapters` field that records adapters which have hit usage limits or other runtime failures. Each entry is keyed by adapter name and contains the timestamp when the adapter was marked unhealthy and the reason. This field is used to skip unhealthy adapters with a 1-hour cooldown.

#### Scenario: Execution state structure with unhealthy adapters
- **GIVEN** one or more adapters have been marked unhealthy during the current or a previous run
- **WHEN** the system writes `.execution_state` with unhealthy adapter data
- **THEN** the file SHALL contain the existing fields (`last_run_completed_at`, `branch`, `commit`, `working_tree_ref`) plus an `unhealthy_adapters` object
- **AND** each key in `unhealthy_adapters` SHALL be an adapter name (e.g. `"claude"`)
- **AND** each value SHALL contain `marked_at` (ISO 8601 timestamp) and `reason` (string)

#### Scenario: No unhealthy adapters
- **GIVEN** no adapters have been marked unhealthy
- **WHEN** the system reads `.execution_state`
- **THEN** the `unhealthy_adapters` field SHALL be absent or an empty object
- **AND** all adapters SHALL be considered healthy

#### Scenario: Reading legacy execution state without unhealthy_adapters
- **GIVEN** an `.execution_state` file written by a previous version (no `unhealthy_adapters` field)
- **WHEN** the system reads the file
- **THEN** the system SHALL treat all adapters as healthy
- **AND** the file SHALL be parsed successfully (backward compatible)

### Requirement: Runtime Usage Limit Detection
The system MUST detect usage limits from actual review adapter output rather than from preflight health probes. When a review adapter returns output or throws an error that matches usage-limit patterns, the system SHALL mark the review as failed with an error status and record the adapter as unhealthy in `.execution_state`.

#### Scenario: Usage limit detected in review output
- **GIVEN** an adapter is assigned to a review slot
- **WHEN** the adapter returns output containing usage-limit text (e.g. "usage limit", "quota exceeded")
- **THEN** the review slot SHALL report `status: "error"` with a message indicating the usage limit
- **AND** the adapter SHALL be marked unhealthy in `.execution_state` with reason "Usage limit exceeded"
- **AND** the system SHALL log that the adapter was marked unhealthy for 1 hour

#### Scenario: Usage limit detected in adapter exception
- **GIVEN** an adapter is assigned to a review slot
- **WHEN** the adapter throws an error whose message matches usage-limit patterns
- **THEN** the review slot SHALL report `status: "error"` with the usage-limit message
- **AND** the adapter SHALL be marked unhealthy in `.execution_state`

#### Scenario: Non-usage-limit error does not mark adapter unhealthy
- **GIVEN** an adapter is assigned to a review slot
- **WHEN** the adapter throws an error that does not match usage-limit patterns (e.g. timeout, parse error)
- **THEN** the review slot SHALL report `status: "error"` as before
- **AND** the adapter SHALL NOT be marked unhealthy

### Requirement: Adapter Cooldown and Recovery
Adapters marked as unhealthy SHALL be skipped for a 1-hour cooldown period. After the cooldown expires, the system SHALL attempt to use the adapter again. If the adapter's CLI binary is available, the unhealthy flag SHALL be cleared.

#### Scenario: Adapter within cooldown period
- **GIVEN** adapter "claude" was marked unhealthy 30 minutes ago
- **WHEN** the system selects adapters for a review gate
- **THEN** "claude" SHALL be skipped (not included in healthy adapter list)
- **AND** the system SHALL log that "claude" is cooling down

#### Scenario: Adapter cooldown expired and binary available
- **GIVEN** adapter "claude" was marked unhealthy 2 hours ago
- **AND** the `claude` CLI binary is available on PATH
- **WHEN** the system selects adapters for a review gate
- **THEN** the system SHALL clear the unhealthy flag for "claude" in `.execution_state`
- **AND** "claude" SHALL be included in the healthy adapter list

#### Scenario: Adapter cooldown expired but binary missing
- **GIVEN** adapter "claude" was marked unhealthy 2 hours ago
- **AND** the `claude` CLI binary is NOT available on PATH
- **WHEN** the system selects adapters for a review gate
- **THEN** "claude" SHALL remain excluded from the healthy adapter list
- **AND** the unhealthy flag SHALL NOT be cleared (binary missing is a separate issue)

#### Scenario: All adapters cooling down
- **GIVEN** all configured adapters are within their cooldown period
- **WHEN** the system selects adapters for a review gate
- **THEN** the gate SHALL return an error status with message including "no healthy adapters"
