## ADDED Requirements

### Requirement: Skip CLI Command

The system MUST provide an `agent-gauntlet skip` CLI subcommand that advances the execution state baseline to the current working tree state without running any verification gates. The command SHALL archive existing logs and write a new `.execution_state` file, producing the same post-run state as a successful `agent-gauntlet run`.

#### Scenario: Skip with no existing state

- **WHEN** the user executes `agent-gauntlet skip`
- **AND** no `.execution_state` file exists in the log directory
- **THEN** the command SHALL create the log directory if it does not exist
- **AND** the command SHALL write a new `.execution_state` file with the current branch, commit SHA, and working tree ref
- **AND** the command SHALL exit with code 0

#### Scenario: Skip with existing state and logs

- **WHEN** the user executes `agent-gauntlet skip`
- **AND** an `.execution_state` file and log files exist in the log directory
- **THEN** the command SHALL archive existing logs via the log clean process
- **AND** the command SHALL overwrite `.execution_state` with the current branch, commit SHA, and working tree ref
- **AND** the command SHALL exit with code 0

#### Scenario: Skip preserves unhealthy adapter state

- **WHEN** the user executes `agent-gauntlet skip`
- **AND** the existing `.execution_state` contains `unhealthy_adapters` entries
- **THEN** the `unhealthy_adapters` entries SHALL be preserved in the updated `.execution_state`

#### Scenario: Skip console output

- **WHEN** the user executes `agent-gauntlet skip`
- **AND** the command completes successfully
- **THEN** the command SHALL print a confirmation message that includes the abbreviated commit SHA

#### Scenario: Skip while another gauntlet process holds the lock

- **WHEN** the user executes `agent-gauntlet skip`
- **AND** another gauntlet process holds the run lock
- **THEN** the command SHALL exit with a non-zero exit code
- **AND** the command SHALL print an error message indicating a run is already in progress
- **AND** the command SHALL NOT modify `.execution_state` or archive logs

#### Scenario: Skip in a non-git directory

- **WHEN** the user executes `agent-gauntlet skip`
- **AND** the current directory is not inside a git repository
- **THEN** the command SHALL exit with a non-zero exit code
- **AND** the command SHALL print an error message

### Requirement: Skip Skill

The system MUST provide a `/gauntlet-skip` skill that invokes the `agent-gauntlet skip` CLI command and reports the result.

#### Scenario: Skill invocation

- **WHEN** a user or agent invokes `/gauntlet-skip`
- **THEN** the skill SHALL execute `agent-gauntlet skip`
- **AND** the skill SHALL report the command output to the user
