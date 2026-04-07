## MODIFIED Requirements

### Requirement: Checks must be defined in YAML files without a name attribute
The system MUST load checks from `.validator/checks/*.yml`. The identification of the check MUST be derived solely from the filename. Checks MAY also be defined inline in `config.yml` under the top-level `checks` map (see inline-check-config capability). File-based checks and inline checks are merged; a name present in both sources MUST cause a validation error.

#### Scenario: Valid Check Definition
- **WHEN** a file `.validator/checks/my-check.yml` exists with `command: "echo hello"`
- **AND** the configuration is loaded
- **THEN** a check named "my-check" is available in the system
- **AND** the check has the command "echo hello"

#### Scenario: Check with Name Attribute (Invalid/Ignored)
- **WHEN** a file `.validator/checks/legacy.yml` contains a `name` field
- **AND** the configuration is loaded
- **THEN** the name attribute is ignored
- **AND** the check is identified as "legacy"

#### Scenario: Filename determines Identity
- **WHEN** a file `.validator/checks/lint-core.yml` exists
- **AND** the check executes
- **THEN** it is reported as "lint-core" in the logs and output
