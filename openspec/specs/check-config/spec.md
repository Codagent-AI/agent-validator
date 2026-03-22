# check-config Specification

## Purpose
TBD - created by archiving change remove-check-name-attribute. Update Purpose after archive.
## Requirements
### Requirement: Checks must be defined in YAML files without a name attribute
The system MUST load checks from `.validator/checks/*.yml`. The identification of the check MUST be derived solely from the filename.

#### Scenario: Valid Check Definition
Given a file `.validator/checks/my-check.yml` with content:
```yaml
command: "echo hello"
```
When the configuration is loaded
Then a check named "my-check" is available in the system
And the check has the command "echo hello"

#### Scenario: Check with Name Attribute (Invalid/Ignored)
Given a file `.validator/checks/legacy.yml` with content:
```yaml
name: "wrong-name"
command: "true"
```
When the configuration is loaded
Then the name attribute is ignored
And the check is identified as "legacy"

#### Scenario: Filename determines Identity
Given a file `.validator/checks/lint-core.yml`
When the check is executed
Then it is reported as "lint-core" in the logs and output

### Requirement: Checks support fix_instructions_file for fix guidance
The system MUST support a `fix_instructions_file` field in check configurations. This field specifies a file path containing instructions for fixing failures. The deprecated `fix_instructions` field MUST be treated as an alias for `fix_instructions_file`. If both `fix_instructions` and `fix_instructions_file` are specified, the system MUST reject with an error. File paths follow the same resolution rules as review `prompt_file` (absolute with warning, relative from `.validator/`).

#### Scenario: fix_instructions_file loads content
- **GIVEN** a check `.validator/checks/lint.yml` with `fix_instructions_file: fix-guides/lint.md`
- **AND** the file `.validator/fix-guides/lint.md` exists
- **WHEN** the check fails
- **THEN** the fix instructions content is included in the gate result

#### Scenario: Deprecated fix_instructions alias
- **GIVEN** a check `.validator/checks/lint.yml` with `fix_instructions: fix-guides/lint.md`
- **WHEN** the configuration is loaded
- **THEN** the value is treated as `fix_instructions_file`

#### Scenario: Both fix_instructions and fix_instructions_file specified
- **GIVEN** a check with both `fix_instructions` and `fix_instructions_file` fields
- **WHEN** the configuration is loaded
- **THEN** the system MUST reject with a validation error

#### Scenario: fix_instructions_file with relative path
- **GIVEN** a check with `fix_instructions_file: fix-guides/lint.md`
- **AND** the file `.validator/fix-guides/lint.md` exists
- **WHEN** the configuration is loaded
- **THEN** the content is loaded from `.validator/fix-guides/lint.md`

#### Scenario: fix_instructions_file with absolute path and warning
- **GIVEN** a check with `fix_instructions_file: /shared/fix-guides/lint.md`
- **AND** the file `/shared/fix-guides/lint.md` exists
- **WHEN** the configuration is loaded
- **THEN** the content is loaded from the absolute path
- **AND** a warning is logged about using absolute paths

#### Scenario: fix_instructions_file with missing file
- **GIVEN** a check with `fix_instructions_file: nonexistent.md`
- **WHEN** the configuration is loaded
- **THEN** the system MUST reject with a file-not-found error

### Requirement: Checks support fix_with_skill for skill-based fixing
The system MUST support a `fix_with_skill` field in check configurations. This field specifies a CLI skill name to use for fixing failures. `fix_with_skill` and `fix_instructions_file` are mutually exclusive. When a check fails and `fix_with_skill` is configured, the skill name MUST be included in the gate result.

#### Scenario: fix_with_skill on check failure
- **GIVEN** a check `.validator/checks/test.yml` with `fix_with_skill: fix-tests`
- **WHEN** the check fails
- **THEN** the gate result includes `fixWithSkill: "fix-tests"`

#### Scenario: fix_with_skill and fix_instructions_file are mutually exclusive
- **GIVEN** a check with both `fix_with_skill` and `fix_instructions_file`
- **WHEN** the configuration is loaded
- **THEN** the system MUST reject with a validation error

### Requirement: Checks support rerun_command for alternate rerun execution
The system MUST support an optional `rerun_command` field in check gate configurations. When the system is in rerun mode (log files exist from a previous run AND no explicit `--commit` target is specified) and `rerun_command` is defined, the system SHALL execute `rerun_command` instead of `command`. The `rerun_command` field supports the same variable substitution as `command` (e.g., `${BASE_BRANCH}`). Variable substitution errors in `rerun_command` follow the same behavior as for `command`. When `rerun_command` is not defined, the system SHALL use `command` for both first runs and reruns.

#### Scenario: Rerun with rerun_command defined
- **GIVEN** a check `.validator/checks/code-health.yml` with:
  ```yaml
  command: cs delta ${BASE_BRANCH} --error-on-warnings
  rerun_command: cs delta ${BASE_BRANCH}
  ```
- **AND** the system is in rerun mode (log files exist, no `--commit` flag)
- **WHEN** the check gate executes
- **THEN** the system SHALL execute `cs delta ${BASE_BRANCH}` (the rerun_command)
- **AND** variable substitution SHALL be applied to `rerun_command`

#### Scenario: Rerun without rerun_command defined
- **GIVEN** a check `.validator/checks/lint.yml` with:
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

