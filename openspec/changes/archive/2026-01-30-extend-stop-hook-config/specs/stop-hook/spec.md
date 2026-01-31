# stop-hook Spec Delta

## MODIFIED Requirements

### Requirement: Global Configuration
The system MUST support a global configuration file at `~/.config/agent-gauntlet/config.yml` for user-level settings that apply across all projects. The `stop_hook` section supports both `enabled` and `run_interval_minutes` settings.

#### Scenario: Global config with stop hook enabled and interval
- **GIVEN** the file `~/.config/agent-gauntlet/config.yml` exists
- **AND** it contains `stop_hook.enabled: true` and `stop_hook.run_interval_minutes: 15`
- **WHEN** the stop-hook command reads configuration
- **THEN** the system SHALL use `enabled: true` and 15 minutes as the run interval

#### Scenario: Global config with stop hook disabled
- **GIVEN** the file `~/.config/agent-gauntlet/config.yml` exists
- **AND** it contains `stop_hook.enabled: false`
- **WHEN** the stop-hook command reads configuration
- **THEN** the system SHALL skip gauntlet execution entirely
- **AND** the system SHALL output `{ "decision": "approve", "status": "stop_hook_disabled", "message": "..." }`

#### Scenario: Global config missing enabled field (backwards compatibility)
- **GIVEN** the file `~/.config/agent-gauntlet/config.yml` exists
- **AND** it contains only `stop_hook.run_interval_minutes: 15` (no `enabled` field)
- **WHEN** the stop-hook command reads configuration
- **THEN** the system SHALL default `enabled` to `true`
- **AND** the system SHALL use 15 minutes as the run interval

#### Scenario: Global config missing
- **GIVEN** the file `~/.config/agent-gauntlet/config.yml` does not exist
- **WHEN** the stop-hook command reads configuration
- **THEN** the system SHALL use defaults: `enabled: true`, `run_interval_minutes: 10`

#### Scenario: Global config invalid
- **GIVEN** the global config file contains invalid YAML
- **WHEN** the stop-hook command reads configuration
- **THEN** the system SHALL log a warning to stderr
- **AND** the system SHALL use default values

### Requirement: Stop Hook Run Interval
The stop-hook command MUST skip gauntlet execution if the stop hook is disabled OR if the configured run interval has not elapsed since the last completed run. Configuration is resolved from three sources with precedence: environment variables > project config > global config.

#### Scenario: Environment variable overrides all other sources
- **GIVEN** `GAUNTLET_STOP_HOOK_ENABLED=false` is set in the environment
- **AND** the project config has `stop_hook.enabled: true`
- **AND** the global config has `stop_hook.enabled: true`
- **WHEN** the stop-hook command reads configuration
- **THEN** the system SHALL use `enabled: false` from the environment variable
- **AND** the system SHALL skip gauntlet execution

#### Scenario: Environment variable for interval
- **GIVEN** `GAUNTLET_STOP_HOOK_INTERVAL_MINUTES=0` is set in the environment
- **AND** the project config has `stop_hook.run_interval_minutes: 10`
- **WHEN** the stop-hook command reads configuration
- **THEN** the system SHALL use `run_interval_minutes: 0` from the environment variable
- **AND** the system SHALL always run the gauntlet (interval 0 means always run)

#### Scenario: Project config overrides global config
- **GIVEN** the project config (`.gauntlet/config.yml`) has `stop_hook.run_interval_minutes: 5`
- **AND** the global config has `stop_hook.run_interval_minutes: 10`
- **AND** no environment variables are set
- **WHEN** the stop-hook command reads configuration
- **THEN** the system SHALL use 5 minutes from the project config

#### Scenario: Interval of zero means always run
- **GIVEN** the resolved config has `enabled: true` and `run_interval_minutes: 0`
- **WHEN** the stop-hook command runs
- **THEN** the system SHALL run the gauntlet immediately without checking elapsed time
- **AND** the system SHALL NOT read or compare against `.execution_state` timestamps for interval purposes

#### Scenario: Stop hook disabled
- **GIVEN** the resolved config has `enabled: false`
- **WHEN** the stop-hook command runs
- **THEN** the system SHALL allow stop by outputting `{ "decision": "approve", "status": "stop_hook_disabled", "message": "..." }`
- **AND** the system SHALL NOT invoke executeRun()
- **AND** the system SHALL log a message indicating the stop hook is disabled

#### Scenario: Interval not elapsed - skip run
- **GIVEN** the resolved config has `enabled: true` and `run_interval_minutes: 10`
- **AND** the `.execution_state` file shows `last_run_completed_at` was 5 minutes ago
- **WHEN** the stop-hook command runs
- **THEN** the system SHALL allow stop by outputting `{ "decision": "approve", "status": "interval_not_elapsed", "message": "..." }`
- **AND** the system SHALL log a message to stderr indicating the interval has not elapsed

#### Scenario: Interval elapsed - run gauntlet
- **GIVEN** the resolved config has `enabled: true` and `run_interval_minutes: 10`
- **AND** the `.execution_state` file shows `last_run_completed_at` was 15 minutes ago
- **WHEN** the stop-hook command runs
- **THEN** the system SHALL run the gauntlet normally

#### Scenario: No execution state - run gauntlet
- **GIVEN** the resolved config has `enabled: true`
- **AND** no `.execution_state` file exists
- **WHEN** the stop-hook command runs
- **THEN** the system SHALL run the gauntlet normally

### Requirement: Status Codes for Approval Scenarios

The system MUST use distinct status codes for different approval scenarios to enable debugging and transparency. Status determination follows a defined precedence order.

#### Scenario: Stop hook disabled via configuration
- **GIVEN** the resolved config has `enabled: false`
- **WHEN** the stop-hook outputs its response
- **THEN** `status` SHALL be `"stop_hook_disabled"`
- **AND** `message` SHALL indicate the stop hook was disabled by configuration
- **AND** `decision` SHALL be `"approve"`

## ADDED Requirements

### Requirement: Stop Hook Configuration Resolution
The system MUST resolve stop hook configuration from three sources with clear precedence: environment variables (highest), project config, global config (lowest). Each field is resolved independently.

#### Scenario: Per-field independent resolution
- **GIVEN** `GAUNTLET_STOP_HOOK_ENABLED=true` is set in the environment
- **AND** the project config has `stop_hook.run_interval_minutes: 5` (no `enabled` field)
- **AND** the global config has `stop_hook.enabled: false` and `stop_hook.run_interval_minutes: 10`
- **WHEN** the stop-hook command resolves configuration
- **THEN** `enabled` SHALL be `true` (from env var)
- **AND** `run_interval_minutes` SHALL be `5` (from project config, since no env var for interval)

#### Scenario: Environment variable parsing for enabled
- **GIVEN** `GAUNTLET_STOP_HOOK_ENABLED` is set in the environment
- **WHEN** the stop-hook command parses the value
- **THEN** the system SHALL accept "true", "1" as truthy values
- **AND** the system SHALL accept "false", "0" as falsy values
- **AND** the system SHALL ignore invalid values and fall through to next source

#### Scenario: Environment variable parsing for interval
- **GIVEN** `GAUNTLET_STOP_HOOK_INTERVAL_MINUTES` is set in the environment
- **WHEN** the stop-hook command parses the value
- **THEN** the system SHALL parse the value as an integer
- **AND** the system SHALL accept non-negative integers (0 or greater)
- **AND** the system SHALL ignore invalid values (non-numeric, negative) and fall through to next source
