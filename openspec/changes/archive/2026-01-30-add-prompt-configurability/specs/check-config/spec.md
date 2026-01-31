## MODIFIED Requirements

### Requirement: Checks must be defined in YAML files without a name attribute
The system MUST load checks from `.gauntlet/checks/*.yml`. The identification of the check MUST be derived solely from the filename.

#### Scenario: Valid Check Definition
Given a file `.gauntlet/checks/my-check.yml` with content:
```yaml
command: "echo hello"
```
When the configuration is loaded
Then a check named "my-check" is available in the system
And the check has the command "echo hello"

#### Scenario: Check with Name Attribute (Invalid/Ignored)
Given a file `.gauntlet/checks/legacy.yml` with content:
```yaml
name: "wrong-name"
command: "true"
```
When the configuration is loaded
Then the name attribute is ignored
And the check is identified as "legacy"

#### Scenario: Filename determines Identity
Given a file `.gauntlet/checks/lint-core.yml`
When the check is executed
Then it is reported as "lint-core" in the logs and output

## ADDED Requirements

### Requirement: Checks support fix_instructions_file for fix guidance
The system MUST support a `fix_instructions_file` field in check configurations. This field specifies a file path containing instructions for fixing failures. The deprecated `fix_instructions` field MUST be treated as an alias for `fix_instructions_file`. If both `fix_instructions` and `fix_instructions_file` are specified, the system MUST reject with an error. File paths follow the same resolution rules as review `prompt_file` (absolute with warning, relative from `.gauntlet/`).

#### Scenario: fix_instructions_file loads content
- **GIVEN** a check `.gauntlet/checks/lint.yml` with `fix_instructions_file: fix-guides/lint.md`
- **AND** the file `.gauntlet/fix-guides/lint.md` exists
- **WHEN** the check fails
- **THEN** the fix instructions content is included in the gate result

#### Scenario: Deprecated fix_instructions alias
- **GIVEN** a check `.gauntlet/checks/lint.yml` with `fix_instructions: fix-guides/lint.md`
- **WHEN** the configuration is loaded
- **THEN** the value is treated as `fix_instructions_file`

#### Scenario: Both fix_instructions and fix_instructions_file specified
- **GIVEN** a check with both `fix_instructions` and `fix_instructions_file` fields
- **WHEN** the configuration is loaded
- **THEN** the system MUST reject with a validation error

#### Scenario: fix_instructions_file with relative path
- **GIVEN** a check with `fix_instructions_file: fix-guides/lint.md`
- **AND** the file `.gauntlet/fix-guides/lint.md` exists
- **WHEN** the configuration is loaded
- **THEN** the content is loaded from `.gauntlet/fix-guides/lint.md`

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
- **GIVEN** a check `.gauntlet/checks/test.yml` with `fix_with_skill: fix-tests`
- **WHEN** the check fails
- **THEN** the gate result includes `fixWithSkill: "fix-tests"`

#### Scenario: fix_with_skill and fix_instructions_file are mutually exclusive
- **GIVEN** a check with both `fix_with_skill` and `fix_instructions_file`
- **WHEN** the configuration is loaded
- **THEN** the system MUST reject with a validation error
