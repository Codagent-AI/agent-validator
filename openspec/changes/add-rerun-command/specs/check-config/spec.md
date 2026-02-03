## ADDED Requirements
### Requirement: Checks support rerun_command for alternate rerun execution
The system MUST support an optional `rerun_command` field in check gate configurations. When the system is in rerun mode (log files exist from a previous run AND no explicit `--commit` target is specified) and `rerun_command` is defined, the system SHALL execute `rerun_command` instead of `command`. The `rerun_command` field supports the same variable substitution as `command` (e.g., `${BASE_BRANCH}`). Variable substitution errors in `rerun_command` follow the same behavior as for `command`. When `rerun_command` is not defined, the system SHALL use `command` for both first runs and reruns.

#### Scenario: Rerun with rerun_command defined
- **GIVEN** a check `.gauntlet/checks/code-health.yml` with:
  ```yaml
  command: cs delta ${BASE_BRANCH} --error-on-warnings
  rerun_command: cs delta ${BASE_BRANCH}
  ```
- **AND** the system is in rerun mode (log files exist, no `--commit` flag)
- **WHEN** the check gate executes
- **THEN** the system SHALL execute `cs delta ${BASE_BRANCH}` (the rerun_command)
- **AND** variable substitution SHALL be applied to `rerun_command`

#### Scenario: Rerun without rerun_command defined
- **GIVEN** a check `.gauntlet/checks/lint.yml` with:
  ```yaml
  command: biome check src/
  ```
- **AND** no `rerun_command` is specified
- **AND** the system is in rerun mode
- **WHEN** the check gate executes
- **THEN** the system SHALL execute `biome check src/` (the original command)

#### Scenario: First run ignores rerun_command
- **GIVEN** a check with both `command` and `rerun_command` defined
- **AND** the system is in first-run mode (no log files)
- **WHEN** the check gate executes
- **THEN** the system SHALL execute `command` (not `rerun_command`)

#### Scenario: Explicit --commit overrides rerun mode
- **GIVEN** a check with both `command` and `rerun_command` defined
- **AND** log files exist from a previous run
- **AND** the user passes `--commit <sha>`
- **WHEN** the check gate executes
- **THEN** the system SHALL execute `command` (not `rerun_command`)
- **AND** the `--commit` flag takes precedence over rerun detection
