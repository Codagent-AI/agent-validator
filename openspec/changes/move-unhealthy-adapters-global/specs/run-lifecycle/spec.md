## RENAMED Requirements
- FROM: `### Requirement: Adapter Health Tracking in Execution State`
- TO: `### Requirement: Adapter Health Tracking in Global State`

## MODIFIED Requirements

### Requirement: Adapter Health Tracking in Global State
The system MUST store unhealthy adapter cooldown state in a global state file located in the global config directory (default: `~/.config/agent-gauntlet/unhealthy_adapters.json`). Each entry is keyed by adapter name and contains the timestamp when the adapter was marked unhealthy and the reason. The global state file SHALL be used to determine adapter cooldown across projects.

#### Scenario: Global unhealthy adapter file structure
- **GIVEN** one or more adapters have been marked unhealthy
- **WHEN** the system writes the global unhealthy adapter state file
- **THEN** the file SHALL contain an `unhealthy_adapters` object
- **AND** each key in `unhealthy_adapters` SHALL be an adapter name (e.g. `"claude"`)
- **AND** each value SHALL contain `marked_at` (ISO 8601 timestamp) and `reason` (string)

#### Scenario: Global state file missing or invalid
- **GIVEN** the global unhealthy adapter state file does not exist or is invalid
- **WHEN** the system reads unhealthy adapter state
- **THEN** all adapters SHALL be considered healthy

#### Scenario: Global state directory override
- **GIVEN** the `GAUNTLET_GLOBAL_STATE_DIR` environment variable is set
- **WHEN** the system resolves the unhealthy adapter state path
- **THEN** it SHALL use that directory instead of the default global config directory

#### Scenario: Manual clean does not clear global adapter state
- **GIVEN** a project `clean` command runs
- **WHEN** the clean operation completes
- **THEN** the global unhealthy adapter state file SHALL remain intact

### Requirement: Runtime Usage Limit Detection
This requirement MUST record unhealthy adapters in the global unhealthy adapter state file rather than `.execution_state`.

The system MUST detect usage limits from actual review adapter output rather than from preflight health probes. When a review adapter returns output or throws an error that matches usage-limit patterns, the system SHALL mark the review as failed with an error status and record the adapter as unhealthy in the global unhealthy adapter state file.

#### Scenario: Usage limit detected in review output
- **GIVEN** an adapter is assigned to a review slot
- **WHEN** the adapter returns output containing usage-limit text (e.g. "usage limit", "quota exceeded")
- **THEN** the review slot SHALL report `status: "error"` with a message indicating the usage limit
- **AND** the adapter SHALL be marked unhealthy in the global unhealthy adapter state file with reason "Usage limit exceeded"
- **AND** the system SHALL log that the adapter was marked unhealthy for 1 hour

#### Scenario: Usage limit detected in adapter exception
- **GIVEN** an adapter is assigned to a review slot
- **WHEN** the adapter throws an error whose message matches usage-limit patterns
- **THEN** the review slot SHALL report `status: "error"` with the usage-limit message
- **AND** the adapter SHALL be marked unhealthy in the global unhealthy adapter state file

#### Scenario: Non-usage-limit error does not mark adapter unhealthy
- **GIVEN** an adapter is assigned to a review slot
- **WHEN** the adapter throws an error that does not match usage-limit patterns (e.g. timeout, parse error)
- **THEN** the review slot SHALL report `status: "error"` as before
- **AND** the adapter SHALL NOT be marked unhealthy

### Requirement: Adapter Cooldown and Recovery
This requirement MUST read and clear cooldown state from the global unhealthy adapter state file rather than `.execution_state`.

Adapters marked as unhealthy SHALL be skipped for a 1-hour cooldown period. After the cooldown expires, the system SHALL attempt to use the adapter again. If the adapter's CLI binary is available, the unhealthy flag SHALL be cleared in the global unhealthy adapter state file.

#### Scenario: Adapter within cooldown period
- **GIVEN** adapter "claude" was marked unhealthy 30 minutes ago
- **WHEN** the system selects adapters for a review gate
- **THEN** "claude" SHALL be skipped (not included in healthy adapter list)
- **AND** the system SHALL log that "claude" is cooling down

#### Scenario: Adapter cooldown expired and binary available
- **GIVEN** adapter "claude" was marked unhealthy 2 hours ago
- **AND** the `claude` CLI binary is available on PATH
- **WHEN** the system selects adapters for a review gate
- **THEN** the system SHALL clear the unhealthy flag for "claude" in the global unhealthy adapter state file
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
